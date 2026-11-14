import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { RunHost } from './RunHost.ts';
import { buildRunContext } from './ContextBuilder.ts';
import { readPiCatalog } from './catalog.ts';
import { resolveAgentLaunchConfig } from './resolveAgentLaunchConfig.ts';
import type { Connection } from '../../shared/connections.ts';
import { SetupAdministration } from './SetupAdministration.ts';
import { setupTools } from './setupTools.ts';
import { atomicJson, readJson, isMissing, safePath } from '../storage/files.ts';
import { parseProject, snapshotAgent } from '../storage/validation.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import type { Resource } from '../../shared/resources.ts';
import { agentDirectory } from '../../shared/agentPaths.ts';
import type { SessionBinding } from '../../shared/project.ts';
import type { openSessionTerminal } from './terminal.ts';
import { StudioResources } from './StudioResources.ts';
import type { McpSecrets } from './McpSecrets.ts';
import type { RunDependencies } from './RunTypes.ts';
import type { BrowserSupport } from '../browser/BrowserSupport.ts';
import type { ComputerSupport } from '../computer/ComputerSupport.ts';

interface Options {
  bootstraps: string;
  bridge: string;
  catalog: string;
  piPath: () => string;
  headless?: boolean;
  failureChanged?: RunDependencies['failureChanged'];
  openTerminal?: typeof openSessionTerminal;
  resources?: StudioResources;
  mcpSecrets?: McpSecrets;
  browser?: BrowserSupport;
  computer?: ComputerSupport;
}
export function createSetupAssistant(service: StudioService, options: Options) {
  const catalog = async () => {
    const location = await service.serialize(async () => {
      const store = await service.load();
      return {
        folder: store.folder,
        piPath: String(store.bootstrap().sections.piPath ?? '') || options.piPath(),
      };
    });
    return readPiCatalog(location.piPath, options.catalog, location.folder);
  };
  const administration = new SetupAdministration(
    service,
    catalog,
    options.resources ??
      new StudioResources(service, {
        script: join(dirname(options.catalog), 'resources.mjs'),
        piPath: options.piPath,
        mcpSecrets: options.mcpSecrets,
      }),
  );
  return new RunHost({
    mcpGroups: (run) => options.computer?.groups(run) ?? [],
    bootstraps: options.bootstraps,
    bridge: options.bridge,
    serviceAgent: true,
    headless: options.headless,
    failureChanged: options.failureChanged,
    openTerminal: options.openTerminal,
    tools: setupTools,
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
          throw new Error('Некорректное открытие помощника.');
        const store = await service.load();
        const sections = store.bootstrap().sections;
        const agent = (sections.systemAgents as SystemAgent[]).find(
          (agent) => agent.systemRole === 'assistant',
        );
        if (!agent || request.agentId !== agent.id)
          throw new Error('Системный помощник не найден.');
        if (!agent.enabled)
          throw new Error('Системный помощник выключен. Включите его в конструкторе.');
        const path = String(sections.piPath ?? '') || options.piPath();
        const { selectedModel, modelAuth, thinkingLevel } = await resolveAgentLaunchConfig(
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
            throw new Error('Неподдерживаемая версия истории помощника.');
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
        const project = parseProject({
          schemaVersion: 1,
          id: 'pi-setup-assistant',
          name: agent.name,
          createdAt: 0,
          agents: [{ profile, outputPath, ...(session ? { session } : {}) }],
        });
        for (const sub of ['output', 'sessions'])
          await mkdir(await safePath(root, `${agentDirectory(outputPath)}/${sub}`, true), {
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
        return { run, piPath: path };
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
    tool: (run, name, args) => administration.call(run, name, args),
  });
}
