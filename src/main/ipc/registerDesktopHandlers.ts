import { handleDesktopInvoke } from './desktopInvoke.ts';
import { registerTeamMessageHandlers } from '../team-mcp/registerTeamMessageHandlers';
import { TeamSupport } from '../team-mcp/TeamSupport';
import { outputMediaUrl } from '../../shared/outputPaths';
import { app, BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { desktopChannels, type DesktopInfo } from '../../shared/contracts';
import type { FileRequest, StorageSection, SectionEdit } from '../../shared/storage';
import { StudioService } from '../storage/StudioStore';
import { loadOutput } from '../storage/outputs';
import { registerProjectCommands } from '../storage/registerProjectCommands';
import { registerProjectActions } from '../storage/registerProjectActions';
import { registerProjectQueries } from '../storage/registerProjectQueries';
import { UsageRecovery } from '../accounting/UsageRecovery';
import { withReadDeadline } from '../storage/files';
import { checkPi } from '../pi/checkPi';
import { importSkill, inspectSkill } from '../storage/skills';
import type { Resource } from '../../shared/resources';
import { BrowserAuth } from '../pi/BrowserAuth';
import { Startup } from '../pi/Startup';
import { createStudioRunHost } from '../pi/createStudioRunHost';
import type { LaunchAgentRequest } from '../../shared/runtime';
import { createSetupAssistant } from '../pi/createSetupAssistant';
import { readVideoProject } from '../video/readVideoProject';
import { StudioResources } from '../pi/StudioResources';
import type { SystemAgent } from '../../shared/systemAgents';
import packageInfo from '../../../package.json';
import { ReferenceFiles } from '../pi/ReferenceFiles';
import { registerReferenceHandlers } from '../pi/registerReferenceHandlers';
import { referenceImage } from '../pi/referenceImage';
import { createImageServices, registerImageHandlers } from '../images/registerImageHandlers';
import { registerModelConnectionHandlers } from '../pi/registerModelConnectionHandlers';
import { registerMcpSecretHandlers } from '../pi/registerMcpSecretHandlers';
import { notifyRunFailure as failureChanged } from '../pi/notifyRunFailure';
import { saveManagedSkill } from '../storage/managedSkills';
import type { SkillWriteRequest } from '../../shared/resources';
import { BrowserSupport } from '../browser/BrowserSupport';
import { ProjectActivity } from '../pi/ProjectActivity';
import { registerResourceHandlers } from '../pi/registerResourceHandlers';
import { registerGracefulQuit } from './registerGracefulQuit';
import { ComputerSupport } from '../computer/ComputerSupport';
import { registerComputerHandlers } from '../computer/registerComputerHandlers';
import { createTeamImportTools } from '../teams/createTeamImportTools';
import { registerTeamHandlers } from '../teams/registerTeamHandlers';
import { registerNativeUpdates } from '../updates/registerNativeUpdates';
import type { NativeUpdates } from '../updates/NativeUpdates';
import type { UpdateStartup } from '../updates/UpdateStartup';
import { createStudioWindow, setUpdateQuitGuard } from '../windows/createStudioWindow';
import type { ThemePreferences } from '../appearance/ThemePreferences';
import { registerAppearance } from '../appearance/registerAppearance';

export function registerDesktopHandlers(
  options: {
    appearance?: ThemePreferences;
    startup?: UpdateStartup;
    updates?: (updates: NativeUpdates) => void;
  } = {},
): StudioService {
  if (options.appearance) registerAppearance(options.appearance, caller);
  const service = new StudioService(
    join(app.getPath('userData'), 'workspace.json'),
    join(app.getPath('videos'), 'Pi Studio'),
  );
  const browserAuth = new BrowserAuth(join(__dirname, '../../bundled/pi-bridge/login.mjs'), (url) =>
    shell.openExternal(url),
  );
  const startup = new Startup({
    root: join(app.getPath('userData'), 'runtime/pi'),
    bundled: join(__dirname, '../../bundled/pi-runtime'),
    configuredPath: async () => {
      try {
        return await service.serialize(async () =>
          String((await service.load()).bootstrap().sections.piPath ?? ''),
        );
      } catch {
        return '';
      }
    },
  });
  const modelConnections = registerModelConnectionHandlers(
    service,
    join(app.getPath('userData'), 'model-auth'),
    join(__dirname, '../../bundled/pi-bridge'),
    () => startup.path,
    browserAuth,
    caller,
  );
  const references = new ReferenceFiles(referenceImage);
  const computer = new ComputerSupport();
  registerComputerHandlers(computer, caller);
  const activity = new ProjectActivity();
  const usageRecovery = new UsageRecovery(
    service,
    join(__dirname, '../../bundled/pi-bridge/accounting/read-usage.mjs'),
    () => startup.path,
  );
  const mcpSecrets = registerMcpSecretHandlers(service, caller, () => startup.path);
  const { connections: imageConnections, images } = createImageServices(service);
  const browser = new BrowserSupport(
    join(app.getPath('userData'), 'runtime/browser'),
    join(__dirname, '../../bundled/pi-bridge/browser/server.mjs'),
  );
  const team = new TeamSupport(service, (folder, connectionId) =>
    modelConnections.status({ folder, connectionId }),
  );
  registerTeamMessageHandlers(team, caller);
  const productionResources = {
    team,
    computer,
    references,
    images,
    mcpSecrets,
    browser,
  };
  const runs = createStudioRunHost(service, {
    activity,
    ...productionResources,
    failureChanged,
    bootstraps: join(app.getPath('userData'), 'session-bootstraps'),
    bridge: join(__dirname, '../../bundled/pi-bridge/session.mjs'),
    catalog: join(__dirname, '../../bundled/pi-bridge/catalog.mjs'),
    piPath: () => startup.path,
  });
  const resources = new StudioResources(service, {
    computer,
    browser,
    mcpSecrets,
    browserAuth,
    script: join(__dirname, '../../bundled/pi-bridge/resources.mjs'),
    piPath: () => startup.path,
  });
  const teamImports = createTeamImportTools(service, resources, {
    userData: app.getPath('userData'),
    bridgeDirectory: join(__dirname, '../../bundled/pi-bridge'),
    piPath: () => startup.path,
  });
  const setup = createSetupAssistant(service, {
    team,
    teamImports,
    computer,
    browser,
    failureChanged,
    bootstraps: join(app.getPath('userData'), 'setup-bootstraps'),
    bridge: join(__dirname, '../../bundled/pi-bridge/session.mjs'),
    catalog: join(__dirname, '../../bundled/pi-bridge/catalog.mjs'),
    piPath: () => startup.path,
    resources,
    mcpSecrets,
  });
  const updates = registerNativeUpdates({
    service,
    startup,
    boot: options.startup,
    runs: [runs.updates, setup.updates],
    images,
    team,
    auth: browserAuth,
    browser,
    accounting: usageRecovery,
    caller,
  });
  options.updates?.(updates);
  setUpdateQuitGuard(() => {
    if (updates.installing) {
      updates.quitPrevented();
      return true;
    }
    const phase = options.startup?.read().phase;
    return !!phase && !['committed', 'restored'].includes(phase);
  });
  registerGracefulQuit(
    [team, runs, setup, computer],
    [
      browserAuth,
      startup,
      runs,
      setup,
      browser,
      usageRecovery,
      team,
      ...(options.appearance ? [options.appearance] : []),
    ],
    {
      close: () => updates.close(),
      failed: () => {
        createStudioWindow();
      },
    },
  );
  function caller(event: IpcMainInvokeEvent) {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Unknown desktop API caller');
    }
    return window;
  }
  function handle(
    channel: string,
    action: (event: IpcMainInvokeEvent, ...args: never[]) => unknown,
  ) {
    handleDesktopInvoke(channel, (event, ...args) => {
      caller(event);
      return service.serialize(() => Promise.resolve(action(event, ...(args as never[]))));
    });
  }
  registerReferenceHandlers(service, references, caller);
  registerImageHandlers(imageConnections, caller);
  handleDesktopInvoke(desktopChannels.launchAgent, (event, request: LaunchAgentRequest) => {
    caller(event);
    return runs.launch(request);
  });
  handleDesktopInvoke(desktopChannels.openSetupAssistant, async (event) => {
    caller(event);
    const id = await service.serialize(
      async () =>
        ((await service.load()).bootstrap().sections.systemAgents as SystemAgent[]).find(
          (agent) => agent.systemRole === 'assistant',
        )!.id,
    );
    await setup.launch({ projectId: 'pi-setup-assistant', agentId: id, autoContinue: false });
  });
  registerResourceHandlers(resources, caller);
  registerTeamHandlers(service, setup, caller);
  registerProjectQueries(service, activity, caller, (store) => usageRecovery.schedule(store));
  handle(
    desktopChannels.getInfo,
    () =>
      ({
        platform: process.platform === 'win32' ? 'win32' : 'darwin',
        version: packageInfo.version,
        runtimeConnected: runs.connected,
      }) satisfies DesktopInfo,
  );
  handleDesktopInvoke(desktopChannels.getStartup, (event) => {
    caller(event);
    return startup.read();
  });
  handleDesktopInvoke(desktopChannels.retryStartup, (event) => {
    caller(event);
    return startup.retry();
  });
  handleDesktopInvoke(desktopChannels.skipStartup, (event) => {
    caller(event);
    return startup.skip();
  });
  handleDesktopInvoke(desktopChannels.chooseStartupPi, async (event) => {
    const result = await dialog.showOpenDialog(caller(event), {
      title: 'Выберите установленный Pi',
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const state = await startup.choose(result.filePaths[0]);
    await service.serialize(async () =>
      (await service.load()).saveSection('piPath', state.pi!.path),
    );
    return state;
  });
  handle(desktopChannels.checkPi, (_event, path: string) => checkPi(path || startup.path));
  handle(desktopChannels.chooseSkill, async (event) => {
    const result = await dialog.showOpenDialog(caller(event), {
      title: 'Папка skill или SKILL.md',
      properties: ['openDirectory', 'openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const store = await service.load();
    const existing = (store.bootstrap().sections.resources ?? []) as Resource[];
    const skill = await importSkill(result.filePaths[0], existing);
    await store.saveSection('resources', [
      skill,
      ...existing.filter((item) => item.id !== skill.id),
    ]);
    return skill;
  });
  handle(desktopChannels.readSkill, async (_event, id: string) => {
    const resources = (await service.load()).bootstrap().sections.resources as
      Resource[] | undefined;
    const resource = resources?.find(
      (item) => item.id === id && item.kind === 'skills' && item.localSkill,
    );
    if (!resource) throw new Error('Локальный skill не найден в каталоге.');
    return inspectSkill(resource.source);
  });
  handle(desktopChannels.saveSkill, async (_event, request: SkillWriteRequest) =>
    saveManagedSkill(await service.load(), request),
  );
  handle(desktopChannels.loadStudio, async () => (await service.load()).bootstrap());
  handle(desktopChannels.openStudio, (_event, folder: string) => {
    runs.assertIdle();
    setup.assertIdle();
    images.assertIdle();
    return service.open(folder);
  });
  handle(desktopChannels.chooseStudio, async (event) => {
    let defaultPath = app.getPath('documents');
    try {
      defaultPath = (await service.load()).folder;
    } catch {
      /* Let the user recover by explicitly choosing another studio. */
    }
    const result = await dialog.showOpenDialog(caller(event), {
      title: 'Папка Pi Studio',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    runs.assertIdle();
    setup.assertIdle();
    images.assertIdle();
    return service.open(result.filePaths[0]);
  });
  handle(
    desktopChannels.saveSection,
    async (_event, section: StorageSection, value: unknown, edit: SectionEdit) =>
      (await service.load()).editSection(section, value, edit),
  );
  registerProjectCommands(service, runs, images, caller);
  handle(desktopChannels.readOutput, async (_event, request: FileRequest) => {
    const file = await withReadDeadline(async () =>
      loadOutput(await (await service.load()).projects.directory(request.projectId), request.path),
    );
    if (['image', 'audio', 'video'].includes(file.format))
      file.src = outputMediaUrl(request.projectId, request.path, file.fingerprint);
    return file;
  });
  handle(desktopChannels.inspectVideoProject, async (_event, request: FileRequest) => {
    try {
      const root = await (await service.load()).projects.directory(request.projectId);
      return {
        ok: true,
        document: await withReadDeadline(() =>
          readVideoProject(root, request.projectId, request.path),
        ),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Не удалось прочитать монтаж.',
      };
    }
  });
  registerProjectActions(service, caller, {
    change: (projectId, action) => {
      images.assertIdle(projectId);
      return runs.withProjectChange(projectId, false, action);
    },
    stopSession: (projectId, agentId) => runs.stopAgent(projectId, agentId),
    cleared: (projectId, agentId) => runs.outputsCleared(projectId, agentId),
  });
  return service;
}
