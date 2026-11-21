import { randomUUID } from 'node:crypto';
import type { ReferenceFiles } from './ReferenceFiles';
import type { PreparedRun } from './ContextBuilder';
import { t } from '../../shared/i18n/index.ts';
import type { TeamSupport } from '../team-mcp/TeamSupport.ts';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RunHost } from './RunHost.ts';
import { resetStoredChat } from './resetStoredChat.ts';
import { migrateAgentSessions } from '../storage/migrateAgentSessions.ts';
import { buildRunContext } from './ContextBuilder.ts';
import { resolveAgentLaunchConfig } from './resolveAgentLaunchConfig.ts';
import type { Connection } from '../../shared/connections.ts';
import { createAdministration } from './createAdministration.ts';
import { setupTools } from './setupTools.ts';
import { helperInspectionTools } from './helperInspectionTools.ts';
import { atomicJson, readJson, isMissing, safePath } from '../storage/files.ts';
import { parseProject, snapshotAgent } from '../storage/validation.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import type { Resource } from '../../shared/resources.ts';
import { agentDirectory, agentSessionDirectory } from '../../shared/agentPaths.ts';
import type { SessionBinding } from '../../shared/project.ts';
import type { openSessionTerminal } from './terminal.ts';
import type { StudioResources } from './StudioResources.ts';
import type { McpSecrets } from './McpSecrets.ts';
import type { RunDependencies } from './RunTypes.ts';
import type { BrowserSupport } from '../browser/BrowserSupport.ts';
import type { ComputerSupport } from '../computer/ComputerSupport.ts';
import type { TeamImportTools } from '../teams/TeamImportTools.ts';

interface Options {
  team?: TeamSupport;
  teamImports?: TeamImportTools;
  bootstraps: string;
  bridge: string;
  catalog: string;
  piPath: () => string;
  headless?: boolean;
  embedded?: boolean;
  chatChanged?: RunDependencies['chatChanged'];
  chatOpened?: RunDependencies['chatOpened'];
  failureChanged?: RunDependencies['failureChanged'];
  openTerminal?: typeof openSessionTerminal;
  resources?: StudioResources;
  mcpSecrets?: McpSecrets;
  browser?: BrowserSupport;
  computer?: ComputerSupport;
  references?: ReferenceFiles;
}
export function createSetupAssistant(service: StudioService, options: Options) {
  const chatScopes = new WeakMap<PreparedRun, { folder: string; imageInput: boolean }>();
  const administration = createAdministration(service, options);
  return new RunHost({
    resetSession: (run) => resetStoredChat(service, run),
    mcpGroups: (run) => [
      ...(options.computer?.groups(run) ?? []),
      ...(options.team?.groups(run) ?? []),
    ],
    observed: (run, event) => options.team?.event(run, event) ?? Promise.resolve(),
    bootstraps: options.bootstraps,
    bridge: options.bridge,
    serviceAgent: true,
    headless: options.headless,
    embedded: options.embedded,
    chatChanged: options.chatChanged,
    chatOpened: options.chatOpened,
    chatAttachments: (run, ids) =>
      service.serialize(async () => {
        const store = await service.load();
        const scope = chatScopes.get(run);
        if (
          !options.references ||
          !scope ||
          scope.folder !== store.folder ||
          (await safePath(store.folder, '.pistudio/setup-assistant')) !== run.projectRoot
        )
          throw new Error(t('Chat.attachmentsUnavailable'));
        const inputRun = {
          ...run,
          record: { ...run.record, runId: randomUUID(), attachments: undefined },
        };
        await options.references.attach(inputRun, ids, scope.folder, scope.imageInput);
        return inputRun.record.attachments ?? [];
      }),
    failureChanged: options.failureChanged,
    openTerminal: options.openTerminal,
    tools: [...setupTools, ...helperInspectionTools],
    closed: (run) => {
      options.browser?.release(run);
      options.computer?.release(run);
    },
    prepare: (request) =>
      service.serialize(async () => {
        if (
          request.projectId !== 'pi-setup-assistant' ||
          request.firstMessage !== undefined ||
          request.autoContinue
        )
          throw new Error(t('error.createSetupAssistant.invalidAssistantOpeningRequest'));
        const store = await service.load();
        const sections = store.bootstrap().sections;
        const agent = (sections.systemAgents as SystemAgent[]).find(
          (agent) => agent.systemRole === 'assistant',
        );
        if (!agent || request.agentId !== agent.id)
          throw new Error(t('error.createSetupAssistant.systemAssistantNotFound'));
        if (!agent.enabled)
          throw new Error(t('error.createSetupAssistant.systemAssistantDisabledEnableIt'));
        const path = String(sections.piPath ?? '') || options.piPath();
        const { selectedModel, modelAuth, thinkingLevel, piCheck } = await resolveAgentLaunchConfig(
          agent.model,
          (sections.connections ?? []) as Connection[],
          { ...options, folder: store.folder, piPath: path },
        );
        const root = await safePath(store.folder, '.pistudio/setup-assistant', true);
        await mkdir(root, { recursive: true });
        let session: SessionBinding | undefined;
        let outputPath = snapshotAgent(agent).outputPath;
        try {
          const state = (await readJson(join(root, 'state.json'))) as {
            schemaVersion?: number;
            session?: SessionBinding;
            outputPath?: string;
          };
          if (state.schemaVersion !== 1)
            throw new Error(t('error.createSetupAssistant.unsupportedAssistantHistoryVersion'));
          session = state.session;
          if (state.outputPath) outputPath = state.outputPath;
          else if (session && /^agents\/[a-zA-Z0-9_-]+\/sessions\/.+\.jsonl$/.test(session.path))
            outputPath = session.path.split('/').slice(0, 2).join('/') + '/output';
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        const {
          instructions: _blocks,
          mainInstruction: _main,
          systemRole: _role,
          ...profile
        } = agent;
        let project = parseProject({
          schemaVersion: 1,
          id: 'pi-setup-assistant',
          name: agent.name,
          createdAt: 0,
          agents: [{ profile, outputPath, ...(session ? { session } : {}) }],
        });
        const migrated = await migrateAgentSessions(root, project.agents[0]);
        if (migrated !== project.agents[0]) {
          project = { ...project, agents: [migrated] };
          await atomicJson(join(root, 'state.json'), {
            schemaVersion: 1,
            session: migrated.session,
            outputPath,
          });
        }
        for (const sub of ['output'])
          await mkdir(await safePath(root, `${agentDirectory(outputPath)}/${sub}`, true), {
            recursive: true,
          });
        await mkdir(await safePath(root, agentSessionDirectory(project.agents[0]), true), {
          recursive: true,
        });
        const run = await buildRunContext(
          root,
          project,
          agent.id,
          [agent],
          (sections.resources ?? []) as Resource[],
          options.mcpSecrets?.resolver(store.folder, path),
          thinkingLevel,
        );
        run.modelAuth = modelAuth;
        await options.browser?.bind(run, store.folder, path, selectedModel.imageInput);
        await options.computer?.bind(run, selectedModel.imageInput);
        chatScopes.set(run, { folder: store.folder, imageInput: selectedModel.imageInput });
        return { run, piPath: path, piCheck };
      }),
    update: async (run, status, session, failure) => {
      if (session) {
        await atomicJson(join(run.projectRoot, 'state.json'), {
          schemaVersion: 1,
          session,
          outputPath: run.agent.outputPath,
        });
        run.agent.session = session;
      }
      run.agent.runStatus = status;
      run.agent.runFailure = status === 'error' ? (failure ?? run.agent.runFailure) : undefined;
      return { ...run.project, agents: [run.agent] };
    },
    read: async (run) => ({ ...run.project, agents: [run.agent] }),
    tool: (run, name, args, signal) => administration.call(run, name, args, signal),
  });
}
