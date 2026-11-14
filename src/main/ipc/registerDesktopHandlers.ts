import { rasterizePreview } from '../library/rasterizePreview';
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { desktopChannels, type DesktopInfo } from '../../shared/contracts';
import type {
  FileRequest,
  ProjectCommand,
  StorageSection,
  SectionEdit,
} from '../../shared/storage';
import { StudioService, type StudioStore } from '../storage/StudioStore';
import { snapshotAgent } from '../storage/validation';
import { loadOutput } from '../storage/outputs';
import { registerProjectActions } from '../storage/registerProjectActions';
import { withReadDeadline } from '../storage/files';
import { checkPi } from '../pi/checkPi';
import { importSkill, inspectSkill } from '../storage/skills';
import type { Resource } from '../../shared/resources';
import { BrowserAuth } from '../pi/BrowserAuth';
import { Startup } from '../pi/Startup';
import { createStudioRunHost } from '../pi/createStudioRunHost';
import type { LaunchAgentRequest } from '../../shared/runtime';
import { createSetupAssistant } from '../pi/createSetupAssistant';
import type { Agent } from '../../shared/studio';
import { readVideoProject } from '../video/readVideoProject';
import { StudioResources } from '../pi/StudioResources';
import type { SystemAgent } from '../../shared/systemAgents';
import packageInfo from '../../../package.json';
import { ReferenceFiles } from '../pi/ReferenceFiles';
import { referenceImage } from '../pi/referenceImage';
import { createLibraryRunHost } from '../pi/createLibraryRunHost';
import { registerLibraryHandlers } from '../library/registerLibraryHandlers';
import { createImageServices, registerImageHandlers } from '../images/registerImageHandlers';
import { registerModelConnectionHandlers } from '../pi/registerModelConnectionHandlers';
import { registerMcpSecretHandlers } from '../pi/registerMcpSecretHandlers';
import type { RunDependencies } from '../pi/RunTypes';
import { saveManagedSkill } from '../storage/managedSkills';
import type { SkillWriteRequest } from '../../shared/resources';

export function registerDesktopHandlers(): StudioService {
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
  registerModelConnectionHandlers(
    service,
    join(app.getPath('userData'), 'model-auth'),
    join(__dirname, '../../bundled/pi-bridge'),
    () => startup.path,
    browserAuth,
    caller,
  );
  const references = new ReferenceFiles(referenceImage);
  const mcpSecrets = registerMcpSecretHandlers(service, caller, () => startup.path);
  const { connections: imageConnections, images } = createImageServices(service);
  const failureChanged: RunDependencies['failureChanged'] = (run, failure) => {
    const notice = {
      projectRoot: run.projectRoot,
      projectId: run.project.id,
      agentId: run.agent.profile.id,
      agentName: run.agent.profile.name,
      failure,
    };
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send(desktopChannels.runFailure, notice);
  };
  const productionResources = { references, images, mcpSecrets, libraryPreview: rasterizePreview };
  const runs = createStudioRunHost(service, {
    ...productionResources,
    failureChanged,
    bootstraps: join(app.getPath('userData'), 'session-bootstraps'),
    bridge: join(__dirname, '../../bundled/pi-bridge/session.mjs'),
    catalog: join(__dirname, '../../bundled/pi-bridge/catalog.mjs'),
    piPath: () => startup.path,
  });
  const resources = new StudioResources(service, {
    mcpSecrets,
    browserAuth,
    script: join(__dirname, '../../bundled/pi-bridge/resources.mjs'),
    piPath: () => startup.path,
  });
  const setup = createSetupAssistant(service, {
    failureChanged,
    bootstraps: join(app.getPath('userData'), 'setup-bootstraps'),
    bridge: join(__dirname, '../../bundled/pi-bridge/session.mjs'),
    catalog: join(__dirname, '../../bundled/pi-bridge/catalog.mjs'),
    piPath: () => startup.path,
    resources,
    mcpSecrets,
  });
  const generators = createLibraryRunHost(service, {
    ...productionResources,
    failureChanged,
    bootstraps: join(app.getPath('userData'), 'library-bootstraps'),
    bridge: join(__dirname, '../../bundled/pi-bridge/session.mjs'),
    catalog: join(__dirname, '../../bundled/pi-bridge/catalog.mjs'),
    piPath: () => startup.path,
  });
  app.on('before-quit', () => {
    for (const controller of [browserAuth, startup, runs, setup, generators]) controller.close();
  });
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
    ipcMain.handle(channel, (event, ...args) => {
      caller(event);
      return service.serialize(() => Promise.resolve(action(event, ...(args as never[]))));
    });
  }
  registerLibraryHandlers(service, references, generators, caller);
  registerImageHandlers(imageConnections, caller);
  ipcMain.handle(desktopChannels.launchAgent, (event, request: LaunchAgentRequest) => {
    caller(event);
    return runs.launch(request);
  });
  ipcMain.handle(desktopChannels.openSetupAssistant, async (event) => {
    caller(event);
    const id = await service.serialize(
      async () =>
        ((await service.load()).bootstrap().sections.systemAgents as SystemAgent[]).find(
          (agent) => agent.systemRole === 'assistant',
        )!.id,
    );
    await setup.launch({ projectId: 'pi-setup-assistant', agentId: id, autoContinue: false });
  });
  ipcMain.handle(desktopChannels.checkResource, (event, id: string) => {
    caller(event);
    return resources.check(id);
  });
  ipcMain.handle(desktopChannels.installResource, (event, id: string) => {
    caller(event);
    return resources.install(id);
  });
  ipcMain.handle(desktopChannels.openResourceLogin, (event, id: string) => {
    caller(event);
    return resources.login(id);
  });
  ipcMain.handle(desktopChannels.readAuthLogin, (event, id: string) => {
    caller(event);
    return browserAuth.read(id);
  });
  ipcMain.handle(desktopChannels.cancelAuthLogin, (event, id: string) => {
    caller(event);
    browserAuth.cancel(id);
  });
  ipcMain.handle(
    desktopChannels.answerAuthLogin,
    (event, id: string, promptId: string, answer: string) => {
      caller(event);
      browserAuth.answer(id, promptId, answer);
    },
  );
  handle(
    desktopChannels.getInfo,
    () =>
      ({
        platform: 'darwin',
        version: packageInfo.version,
        runtimeConnected: runs.connected,
      }) satisfies DesktopInfo,
  );
  ipcMain.handle(desktopChannels.getStartup, (event) => {
    caller(event);
    return startup.read();
  });
  ipcMain.handle(desktopChannels.retryStartup, (event) => {
    caller(event);
    return startup.retry();
  });
  ipcMain.handle(desktopChannels.skipStartup, (event) => {
    caller(event);
    return startup.skip();
  });
  ipcMain.handle(desktopChannels.chooseStartupPi, async (event) => {
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
    generators.assertIdle();
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
    generators.assertIdle();
    images.assertIdle();
    return service.open(result.filePaths[0]);
  });
  handle(
    desktopChannels.saveSection,
    async (_event, section: StorageSection, value: unknown, edit: SectionEdit) =>
      (await service.load()).editSection(section, value, edit),
  );
  ipcMain.handle(desktopChannels.projectCommand, async (event, command: ProjectCommand) => {
    caller(event);
    const templates = (store: StudioStore) => {
      const current = store.bootstrap().sections.agents as Agent[];
      if (
        command.kind === 'update-agents' &&
        JSON.stringify(current.map((agent) => snapshotAgent(agent).profile)) !==
          JSON.stringify(command.agents.map((agent) => snapshotAgent(agent).profile))
      )
        throw new Error(
          'Общий список агентов изменился. Перечитайте настройки и откройте сравнение заново.',
        );
      return current;
    };
    if (command.kind === 'remove-agent') await runs.stopAgent(command.projectId, command.agentId);
    else if ('projectId' in command) {
      runs.assertIdle(command.projectId);
      images.assertIdle(command.projectId);
    }
    if (command.kind === 'update-agents') {
      const removed = await service.serialize(async () => {
        const store = await service.load();
        const ids = new Set(templates(store).map((agent) => agent.id));
        return (await store.projects.read(command.projectId)).agents
          .filter((agent) => !ids.has(agent.profile.id))
          .map((agent) => agent.profile.id);
      });
      for (const id of removed) await runs.stopAgent(command.projectId, id);
    }
    const apply = () =>
      service.serialize(async () => {
        const store = await service.load();
        return store.command(
          command.kind === 'create' || command.kind === 'update-agents'
            ? { ...command, agents: templates(store) }
            : command,
        );
      });
    return command.kind === 'clone' || command.kind === 'rename' || command.kind === 'remove'
      ? runs.withProjectChange(command.projectId, command.kind !== 'clone', apply)
      : apply();
  });
  handle(desktopChannels.readProject, async (_event, id: string) =>
    withReadDeadline(async () => (await service.load()).projects.read(id)),
  );
  handle(desktopChannels.readOutput, async (_event, request: FileRequest) => {
    const file = await withReadDeadline(async () =>
      loadOutput(await (await service.load()).projects.directory(request.projectId), request.path),
    );
    if (['image', 'audio', 'video'].includes(file.format))
      file.src = `studio-media://output/${encodeURIComponent(request.projectId)}/${request.path.split('/').map(encodeURIComponent).join('/')}?v=${encodeURIComponent(file.fingerprint ?? '')}`;
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
