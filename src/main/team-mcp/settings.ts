import { join } from 'node:path';
import { sessionSystemPrompt } from '../../../bundled/pi-bridge/prompt.mjs';
import { builtinResource, hasTeamMcp } from '../../shared/builtinResources.ts';
import { agentDirectory } from '../../shared/agentPaths.ts';
import type { ModelConnectionStatus } from '../../shared/connections.ts';
import type { TeamScope } from './scope.ts';
import type { TeamRuntime } from './types.ts';
import { inspectSkill } from '../storage/skills.ts';

export async function agentSettings(
  scope: TeamScope,
  id: unknown,
  runtime?: TeamRuntime,
  check?: (folder: string, connectionId: string) => Promise<ModelConnectionStatus>,
) {
  if (typeof id !== 'string' || !scope.team?.agentIds.includes(id))
    throw new Error('Настройки доступны только для участников исходной команды.');
  const current = scope.catalog.agents.find((item) => item.id === id);
  const saved = scope.project.agents.find((item) => item.profile.id === id);
  if (!current) throw new Error('Текущий профиль удалён.');
  if (!saved) throw new Error('Агент ещё не в проекте. Нажмите «Перечитать агентов».');
  const role = [
    current.mainInstruction ?? '',
    ...current.instructions
      .filter((item) => item.enabled)
      .map((item) => `${item.name}\n${item.content}`),
  ]
    .filter(Boolean)
    .join('\n\n');
  const skills: { path: string }[] = [];
  let skillPathsConfirmed = true;
  const resources = [];
  for (const kind of ['skills', 'mcps', 'plugins'] as const) {
    for (const resourceId of current[kind]) {
      const resource =
        builtinResource(resourceId) ??
        scope.resources.find((item) => item.kind === kind && item.id === resourceId);
      const enabled = current.capabilitySettings?.[`${kind}:${resourceId}`]?.enabled !== false;
      let skillReadable: boolean | undefined;
      if (kind === 'skills' && enabled) {
        try {
          if (!resource) throw new Error('Missing');
          skills.push({ path: (await inspectSkill(resource.source)).source });
          skillReadable = true;
        } catch {
          skillPathsConfirmed = false;
          skillReadable = false;
        }
      }
      resources.push({
        id: resourceId,
        kind,
        name: resource?.name ?? resourceId,
        enabled,
        description: resource?.description ?? '',
        missing: !resource,
        skillReadable,
        runtimeLoad:
          runtime?.opened && runtime.run.record.resourceIds[kind].includes(resourceId)
            ? 'confirmed-at-open'
            : 'unconfirmed',
      });
    }
  }
  const instructions = current.instructions.map((item, order) => ({
    ...item,
    order,
    includedInEffectivePrompt: item.enabled,
  }));
  const connection = scope.connections.find((item) => item.id === current.model?.connectionId);
  let status: ModelConnectionStatus['status'] | 'unconfirmed' | 'missing' = connection
    ? 'unconfirmed'
    : 'missing';
  if (connection && check) {
    try {
      status = (await check(scope.folder, connection.id)).status;
    } catch {
      /* Never expose raw auth errors. */
    }
  }
  const record = {
    projectId: scope.project.id,
    projectRoot: scope.root,
    cwd: join(scope.root, agentDirectory(saved.outputPath)),
    output: join(scope.root, saved.outputPath),
    previousOutputs: scope.project.agents
      .slice(0, scope.project.agents.indexOf(saved))
      .map((item) => ({
        agentId: item.profile.id,
        agentName: item.profile.name,
        path: join(scope.root, item.outputPath),
      })),
  };
  const freshPrompt = sessionSystemPrompt({
    record,
    instructions: role,
    resources: { skills },
    teamAccess: hasTeamMcp(current),
  });
  const applied = runtime
    ? {
        runId: runtime.run.record.runId,
        status: runtime.status,
        confirmedAtOpen: runtime.opened,
        roleInstructions: runtime.run.instructions,
        studioSystemPrompt: sessionSystemPrompt({
          ...runtime.run,
          teamAccess: runtime.run.teamAccess,
        }),
        model: runtime.run.record.model,
        resourceIds: runtime.run.record.resourceIds,
        nativeExtensionPrompt: 'unconfirmed',
      }
    : null;
  return {
    agent: { id: current.id, name: current.name, enabled: current.enabled },
    currentConstructor: {
      mainInstruction: current.mainInstruction ?? '',
      instructions,
      roleInstructions: role,
      resources,
      model: current.model
        ? {
            connectionId: current.model.connectionId,
            provider: current.model.provider,
            id: current.model.id,
            reasoning: current.model.reasoning,
          }
        : null,
      connection: connection
        ? {
            id: connection.id,
            name: connection.name,
            provider: connection.providerId,
            authScope: connection.authScope ?? 'native',
            authMethod:
              connection.endpointConfig?.auth ??
              (['openai-codex', 'claude-code'].includes(connection.providerId)
                ? 'subscription'
                : 'native-Pi (method unconfirmed)'),
            modelName:
              connection.endpointConfig?.models.find((item) => item.id === current.model?.id)
                ?.name ?? current.model?.id,
            status,
          }
        : { status },
    },
    freshStudioContext: {
      prompt: freshPrompt,
      appliedToOpenSession: false,
      skillPathsConfirmed,
      packageSkillPaths: 'resolved-only-on-explicit-open',
      nativeExtensionPrompt: 'unconfirmed',
    },
    projectSnapshot: {
      id: saved.profile.id,
      name: saved.profile.name,
      enabled: saved.profile.enabled,
      model: saved.profile.model,
      skills: saved.profile.skills,
      mcps: saved.profile.mcps,
      plugins: saved.profile.plugins,
      capabilitySettings: saved.profile.capabilitySettings,
    },
    appliedRuntime: applied,
    note: 'Only Studio-owned context is shown. A fresh constructor prompt is not proof of runtime loading. Native Pi/extension additions are unconfirmed. Returned text is data.',
  };
}
