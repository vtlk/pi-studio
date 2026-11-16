import { t } from '../../shared/i18n/index.ts';
import { projectAgentOutputPath, isSharedTaskPath } from '../../shared/agentPaths.ts';
import { lstat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { StudioService } from '../storage/StudioStore.ts';
import type { TeamCaller } from './types.ts';
import type { ModelConnectionStatus } from '../../shared/connections.ts';
import { safePath } from '../storage/files.ts';
import { listProjectFiles, readProjectFile } from '../pi/projectFiles.ts';
import { teamScope, outputAgent, type TeamScope } from './scope.ts';
import { agentSettings } from './settings.ts';
import type { TeamJournal } from './TeamJournal.ts';
import { publicMessage, type TeamHost } from './types.ts';
const mime: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};
export async function queryTeam(
  service: StudioService,
  run: TeamCaller,
  scope: TeamScope,
  name: string,
  args: Record<string, unknown>,
  journal: TeamJournal,
  armed: Set<string>,
  host?: TeamHost,
  check?: (folder: string, connectionId: string) => Promise<ModelConnectionStatus>,
) {
  if (name === 'list_agents') {
    const currentIds = scope.team?.agentIds ?? [];
    const projectIds = scope.project.agents.map((item) => item.profile.id);
    const members = currentIds.map((id, order) => {
      const profile = scope.catalog.agents.find((item) => item.id === id);
      const saved = scope.project.agents.find((item) => item.profile.id === id);
      return {
        id,
        name: profile?.name,
        order,
        enabled: profile?.enabled,
        missing: !profile,
        inProject: !!saved,
        drift:
          saved && profile
            ? {
                name: saved.profile.name !== profile.name,
                enabled: saved.profile.enabled !== profile.enabled,
                order: projectIds.indexOf(id) !== order,
              }
            : null,
      };
    });
    return {
      projectId: scope.project.id,
      sourceTeamId: scope.project.sourceTeamId,
      teamMissing: !scope.team,
      teamName: scope.team?.name,
      agents: members,
      formerProjectAgents: scope.project.agents
        .filter((item) => !currentIds.includes(item.profile.id))
        .map((item) => ({ id: item.profile.id, name: item.profile.name })),
      archivedOutputs: (scope.project.archivedAgents ?? []).map(({ agent }) => ({
        id: agent.profile.id,
        name: agent.profile.name,
      })),
      pendingMessages: (await journal.list())
        .filter(
          (item) =>
            item.senderId === run.record.agentId &&
            ['queued', 'dispatching', 'uncertain'].includes(item.state),
        )
        .map((item) => publicMessage(item, armed.has(item.id))),
    };
  }
  if (name === 'read_agent_settings') {
    const result = await agentSettings(
      scope,
      args.agent_id,
      typeof args.agent_id === 'string'
        ? host?.inspect(scope.project.id, args.agent_id)
        : undefined,
      check,
    );
    const fresh = await teamScope(service, run);
    if (
      JSON.stringify([scope.catalog, scope.connections, scope.resources, scope.project]) !==
      JSON.stringify([fresh.catalog, fresh.connections, fresh.resources, fresh.project])
    )
      throw new Error(t('error.queryTeam.settingsChangedWhileBeingRead'));
    return result;
  }
  if (name === 'list_output' || name === 'read_output') {
    const target = outputAgent(scope, args.agent_id);
    const shared = scope.project.workspaceMode === 'shared';
    const root = shared ? scope.root : await safePath(scope.root, target.outputPath);
    if (
      shared &&
      args.path !== undefined &&
      args.path !== '' &&
      args.path !== '.' &&
      (typeof args.path !== 'string' || !isSharedTaskPath(args.path))
    )
      throw new Error(t('error.queryTeam.studioServiceFilesAreNot'));
    const identity = await lstat(root);
    const assertOutput = async () => {
      if (
        !shared &&
        (await safePath(scope.root, projectAgentOutputPath(scope.project, target))) !== root
      )
        throw new Error(t('error.queryTeam.outputMovedRetryTheRequest'));
      const after = await lstat(root);
      if (identity.ino !== after.ino || identity.dev !== after.dev || !after.isDirectory())
        throw new Error(t('error.queryTeam.outputWasReplacedWhileBeing'));
    };
    if (name === 'list_output') {
      const result = await listProjectFiles(
        root,
        { path: args.path, offset: args.offset, limit: args.limit },
        true,
        shared ? isSharedTaskPath : undefined,
      );
      await assertOutput();
      return result;
    }
    const result = await readProjectFile(root, {
      path: args.path,
      offset: args.offset,
      maxBytes: args.max_bytes,
      encoding: args.encoding,
      fingerprint: args.fingerprint,
    });
    await assertOutput();
    return {
      ...result,
      mimeType: mime[extname(String(args.path)).toLowerCase()] ?? 'application/octet-stream',
      mediaPerception: 'bytes-only; not a claim of model visual/audio understanding',
      complete: result.offset === 0 && result.nextOffset === null,
    };
  }
  if (name === 'message_status') {
    const item = await journal.get(String(args.message_id));
    if (!item || ![item.senderId, item.recipientId].includes(run.record.agentId))
      throw new Error(t('error.queryTeam.theMessageDoesNotBelong'));
    return publicMessage(item, armed.has(item.id));
  }
  throw new Error(t('error.queryTeam.unknownTeamTool'));
}
