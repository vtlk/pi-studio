import { t } from '../../shared/i18n/index.ts';
import { ContinuationCancelled } from './RunTypes.ts';
import type { TeamSupport } from '../team-mcp/TeamSupport.ts';
import { RunHost } from './RunHost.ts';
import { buildRunContext } from './ContextBuilder.ts';
import { stableId } from '../storage/validation.ts';
import type { Connection } from '../../shared/connections.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { Agent } from '../../shared/studio.ts';
import type { Resource } from '../../shared/resources.ts';
import { nextEnabledStage, nextStageMessage } from './stageChain.ts';
import { productionTools } from './RunChannel.ts';
import type { ReferenceFiles } from './ReferenceFiles.ts';
import { resolveAgentLaunchConfig } from './resolveAgentLaunchConfig.ts';
import type { openSessionTerminal } from './terminal.ts';
import type { ImageGeneration } from '../images/ImageGeneration.ts';
import type { McpSecrets } from './McpSecrets.ts';
import type { RunDependencies } from './RunTypes.ts';
import type { BrowserSupport } from '../browser/BrowserSupport.ts';
import type { ProjectActivity } from './ProjectActivity.ts';
import type { ComputerSupport } from '../computer/ComputerSupport.ts';
import { hasBuiltinMcp } from '../../shared/builtinAssignments.ts';
import { createAdministration, type AdministrationOptions } from './createAdministration.ts';
import { currentBuiltinAccess } from './currentBuiltinAccess.ts';
import { setupTools } from './setupTools.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import { randomUUID } from 'node:crypto';
import { agentRefreshSignature } from './agentRefreshSignature.ts';

interface Options extends AdministrationOptions {
  team?: TeamSupport;
  bootstraps: string;
  bridge: string;
  catalog: string;
  piPath: () => string;
  references?: ReferenceFiles;
  images?: ImageGeneration;
  browser?: BrowserSupport;
  computer?: ComputerSupport;
  activity?: ProjectActivity;
  mcpSecrets?: McpSecrets;
  headless?: boolean;
  embedded?: boolean;
  chatChanged?: RunDependencies['chatChanged'];
  captureTerminal?: RunDependencies['captureTerminal'];
  failureChanged?: RunDependencies['failureChanged'];
  openTerminal?: typeof openSessionTerminal;
}
export function createStudioRunHost(service: StudioService, options: Options) {
  const administration = createAdministration(service, options);
  const administrativeTools = setupTools.filter(
    (tool) => !productionTools.some((existing) => existing.name === tool.name),
  );
  const permissions = new WeakMap<PreparedRun, (id: string) => Promise<boolean>>();
  const chatScopes = new WeakMap<PreparedRun, { folder: string; imageInput: boolean }>();
  const host: RunHost = new RunHost({
    mcpGroups: (run) => [
      ...(options.computer?.groups(run) ?? []),
      ...(options.team?.groups(run) ?? []),
    ],
    observed: (run, event) => options.team?.event(run, event) ?? Promise.resolve(),
    tools: (run) => [
      ...productionTools,
      ...(options.images?.tools(run) ?? []),
      ...(hasBuiltinMcp(run.agent.profile, 'pistudio-administration') ? administrativeTools : []),
    ],
    closed: (run) => {
      options.activity?.set(run, false);
      options.images?.cancel(run);
      options.browser?.release(run);
      options.computer?.release(run);
    },
    capabilities: (run, extensions) => options.images?.runtime(run, extensions),
    runtimeCapabilities: (run) => ({
      imageGeneration: options.images?.availability(run) ?? {
        available: false,
        reason: 'not-initialized',
      },
    }),
    activityChanged: (run, working) => options.activity?.set(run, working),
    accounting: (run, sample) =>
      service.serialize(async () => {
        await (await service.load()).accounting.record(run, sample);
      }),
    accountingLost: (run) =>
      service.serialize(async () => {
        await (await service.load()).accounting.lost(run);
      }),
    tool: async (run, name, args, signal) => {
      if (administrativeTools.some((tool) => tool.name === name)) {
        if (
          !hasBuiltinMcp(run.agent.profile, 'pistudio-administration') ||
          !(await permissions.get(run)?.('pistudio-administration'))
        )
          throw new Error(t('builtin.assignmentDisabled'));
        return administration.call(run, name, args, signal);
      }
      if (['generate_image', 'get_image_operation'].includes(name) && options.images)
        return options.images.tool(run, name, args);
      throw new Error(t('error.createStudioRunHost.unknownProjectTool'));
    },
    bootstraps: options.bootstraps,
    bridge: options.bridge,
    headless: options.headless,
    embedded: options.embedded,
    chatChanged: options.chatChanged,
    chatAttachments: (run, ids) =>
      service.serialize(async () => {
        const scope = chatScopes.get(run),
          store = await service.load();
        if (
          !scope ||
          scope.folder !== store.folder ||
          !options.references ||
          (await store.projects.directory(run.project.id)) !== run.projectRoot
        )
          throw new Error(t('Chat.attachmentsUnavailable'));
        // Each send owns its input directory; a failed copy cannot remove earlier inputs.
        const inputRun = {
          ...run,
          record: { ...run.record, runId: randomUUID(), attachments: undefined },
        };
        await options.references.attach(inputRun, ids, scope.folder, scope.imageInput);
        return inputRun.record.attachments ?? [];
      }),
    captureTerminal: options.captureTerminal,
    beforeAutomaticClose: (run) => options.images?.assertRunIdle(run),
    failureChanged: options.failureChanged,
    openTerminal: options.openTerminal,
    prepare: (request) =>
      service.serialize(async () => {
        stableId(request.projectId);
        stableId(request.agentId);
        if (
          typeof request.autoContinue !== 'boolean' ||
          (request.firstMessage !== undefined && typeof request.firstMessage !== 'string')
        )
          throw new Error(t('error.createStudioRunHost.invalidLaunchRequest'));
        const store = await service.load();
        let project = store.projects.snapshot(request.projectId);
        const savedAgent = project.agents.find((item) => item.profile.id === request.agentId);
        if (!savedAgent) throw new Error(t('error.createStudioRunHost.agentMissingFromTheProject'));
        if (!savedAgent.profile.enabled) throw new Error(t('session.agentDisabled'));
        const sections = store.bootstrap().sections;
        const current = (sections.agents as Agent[]).find((agent) => agent.id === request.agentId);
        if (!current) throw new Error(t('error.createStudioRunHost.theAgentProfileWasDeleted'));
        const profile = current;
        if (
          project.agents.find((item) => item.profile.id === request.agentId)?.session &&
          request.attachments?.length
        )
          throw new Error(t('error.createStudioRunHost.resumingADialogueDoesNot'));
        const piPath = String(sections.piPath ?? '') || options.piPath();
        const { model, selectedModel, modelAuth, thinkingLevel, piCheck } =
          await resolveAgentLaunchConfig(profile.model, sections.connections as Connection[], {
            ...options,
            folder: store.folder,
            piPath,
          });
        if (request.attachments?.length && !options.references)
          throw new Error(t('error.createStudioRunHost.referenceTransferUnavailable'));
        options.references?.validate(
          request.attachments ?? [],
          store.folder,
          selectedModel.imageInput,
        );
        project = await store.projects.prepareAgentSessions(project.id, request.agentId);
        // Resolve only this project's stable source team; deleted teams retain the saved mode.
        const sourceTeam = store
          .agentCatalog()
          .teams.find((team) => team.id === project.sourceTeamId);
        if (sourceTeam)
          project = await store.projects.applyWorkspaceMode(
            project.id,
            sourceTeam.workspaceMode ?? 'per-agent',
          );
        project = await store.projects.applyAgentModel(project.id, request.agentId, model);
        const run = await buildRunContext(
          await store.projects.directory(project.id),
          project,
          request.agentId,
          sections.agents as Agent[],
          sections.resources as Resource[],
          options.mcpSecrets?.resolver(store.folder, piPath),
          thinkingLevel,
        );
        permissions.set(run, (id) =>
          currentBuiltinAccess(service, store.folder, run.agent.profile.id, id),
        );
        await options.references?.attach(
          run,
          request.attachments ?? [],
          store.folder,
          selectedModel.imageInput,
        );
        options.images?.bind(run, store.folder, selectedModel);
        await options.browser?.bind(run, store.folder, piPath, selectedModel.imageInput);
        await store.accounting.begin(run);
        await options.computer?.bind(run, selectedModel.imageInput, () =>
          permissions.get(run)!('pistudio-computer'),
        );
        run.modelAuth = modelAuth;
        run.refreshSignature = agentRefreshSignature(
          project.agents.find((agent) => agent.profile.id === request.agentId)!.profile,
          profile,
          sections.resources as Resource[],
        );
        chatScopes.set(run, { folder: store.folder, imageInput: selectedModel.imageInput });
        return { run, piPath, piCheck };
      }),
    update: (run, status, session, failure) =>
      service.serialize(async () => {
        const store = await service.load();
        if ((await store.projects.directory(run.project.id)) !== run.projectRoot)
          throw new Error(t('error.createStudioRunHost.theStudioFolderChangedWhile'));
        return store.accounting.enrich(
          await store.projects.updateRuntime(
            run.project.id,
            run.agent.profile.id,
            status,
            session,
            failure,
          ),
        );
      }),
    read: async (run) => {
      const store = service.peek();
      if (!store || store.projects.location(run.project.id) !== run.projectRoot)
        throw new Error(t('error.createStudioRunHost.theStudioFolderChangedWhile'));
      return store.accounting.enrich(store.projects.snapshot(run.project.id));
    },
    completed: async (run, outputs, message) => {
      const sequence = run.requestSequence;
      const continueStage = host.continuation(run);
      if (!continueStage) return;
      try {
        const project = await service.serialize(async () =>
          (await service.load()).projects.snapshot(run.project.id),
        );
        const next = nextEnabledStage(project, run.agent.profile.id);
        await host.closeCompleted(run, sequence!, continueStage.check);
        if (!next) {
          continueStage.finish();
          return;
        }
        await continueStage(
          { projectId: project.id, agentId: next.profile.id, autoContinue: true },
          nextStageMessage(run, outputs, message),
        );
      } catch (error) {
        if (error instanceof ContinuationCancelled) return;
        continueStage.pause();
        throw error;
      }
    },
  });
  options.team?.attach(host);
  return host;
}
