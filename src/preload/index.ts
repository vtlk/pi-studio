import { contextBridge, ipcRenderer } from 'electron';
import { desktopChannels, type DesktopApi } from '../shared/contracts';
import { runFailure } from '../shared/runFailure';

const desktopApi: DesktopApi = {
  onRunFailure: (listener) => {
    const receive = (_event: unknown, notice: unknown) => {
      if (!notice || typeof notice !== 'object') return;
      const data = notice as Record<string, unknown>;
      if (
        !['projectRoot', 'projectId', 'agentId', 'agentName'].every(
          (key) => typeof data[key] === 'string' && (data[key] as string).length <= 4000,
        )
      )
        return;
      listener({
        projectRoot: data.projectRoot as string,
        projectId: data.projectId as string,
        agentId: data.agentId as string,
        agentName: data.agentName as string,
        failure: data.failure === undefined ? undefined : runFailure(data.failure),
      });
    };
    ipcRenderer.on(desktopChannels.runFailure, receive);
    return () => ipcRenderer.removeListener(desktopChannels.runFailure, receive);
  },
  readMcpSecretStatus: (request) =>
    ipcRenderer.invoke(desktopChannels.readMcpSecretStatus, request),
  saveMcpSecrets: (request) => ipcRenderer.invoke(desktopChannels.saveMcpSecrets, request),
  removeMcpSecrets: (request) => ipcRenderer.invoke(desktopChannels.removeMcpSecrets, request),
  readImageConnection: (request) =>
    ipcRenderer.invoke(desktopChannels.readImageConnection, request),
  saveImageKey: (request) => ipcRenderer.invoke(desktopChannels.saveImageKey, request),
  removeImageKey: (request) => ipcRenderer.invoke(desktopChannels.removeImageKey, request),
  checkImageConnection: (request) =>
    ipcRenderer.invoke(desktopChannels.checkImageConnection, request),
  readLibraryCharacter: (id, version, revision) =>
    ipcRenderer.invoke(desktopChannels.readLibraryCharacter, id, version, revision),
  chooseReferenceFiles: () => ipcRenderer.invoke(desktopChannels.chooseReferenceFiles),
  createLibraryAsset: (request) => ipcRenderer.invoke(desktopChannels.createLibraryAsset, request),
  saveSkill: (request) => ipcRenderer.invoke(desktopChannels.saveSkill, request),
  deleteAgentData: (request) => ipcRenderer.invoke(desktopChannels.deleteAgentData, request),
  listLibrary: () => ipcRenderer.invoke(desktopChannels.listLibrary),
  getInfo: () => ipcRenderer.invoke(desktopChannels.getInfo),
  loadStudio: () => ipcRenderer.invoke(desktopChannels.loadStudio),
  chooseStudio: () => ipcRenderer.invoke(desktopChannels.chooseStudio),
  openStudio: (folder) => ipcRenderer.invoke(desktopChannels.openStudio, folder),
  saveSection: (section, value, edit) =>
    ipcRenderer.invoke(desktopChannels.saveSection, section, value, edit),
  projectCommand: (command) => ipcRenderer.invoke(desktopChannels.projectCommand, command),
  readProject: (id) => ipcRenderer.invoke(desktopChannels.readProject, id),
  readOutput: (request) => ipcRenderer.invoke(desktopChannels.readOutput, request),
  inspectVideoProject: (request) =>
    ipcRenderer.invoke(desktopChannels.inspectVideoProject, request),
  revealAgentOutput: (request) => ipcRenderer.invoke(desktopChannels.revealAgentOutput, request),
  revealOutput: (request) => ipcRenderer.invoke(desktopChannels.revealOutput, request),
  checkPi: (path) => ipcRenderer.invoke(desktopChannels.checkPi, path),
  getConnectionStatus: (request) =>
    ipcRenderer.invoke(desktopChannels.getConnectionStatus, request),
  beginConnectionLogin: (request) =>
    ipcRenderer.invoke(desktopChannels.beginConnectionLogin, request),
  removeConnectionLogin: (request) =>
    ipcRenderer.invoke(desktopChannels.removeConnectionLogin, request),
  getProviderStatus: (provider) => ipcRenderer.invoke(desktopChannels.getProviderStatus, provider),
  openProviderLogin: (provider) => ipcRenderer.invoke(desktopChannels.openProviderLogin, provider),
  chooseSkill: () => ipcRenderer.invoke(desktopChannels.chooseSkill),
  readSkill: (id) => ipcRenderer.invoke(desktopChannels.readSkill, id),
  beginCodexLogin: () => ipcRenderer.invoke(desktopChannels.beginCodexLogin),
  readAuthLogin: (id) => ipcRenderer.invoke(desktopChannels.readAuthLogin, id),
  cancelAuthLogin: (id) => ipcRenderer.invoke(desktopChannels.cancelAuthLogin, id),
  answerAuthLogin: (id, promptId, answer) =>
    ipcRenderer.invoke(desktopChannels.answerAuthLogin, id, promptId, answer),
  getStartup: () => ipcRenderer.invoke(desktopChannels.getStartup),
  retryStartup: () => ipcRenderer.invoke(desktopChannels.retryStartup),
  skipStartup: () => ipcRenderer.invoke(desktopChannels.skipStartup),
  chooseStartupPi: () => ipcRenderer.invoke(desktopChannels.chooseStartupPi),
  getModelCatalog: (request) => ipcRenderer.invoke(desktopChannels.getModelCatalog, request),
  discoverConnectionModels: (request) =>
    ipcRenderer.invoke(desktopChannels.discoverConnectionModels, request),
  launchAgent: (request) => ipcRenderer.invoke(desktopChannels.launchAgent, request),
  openSetupAssistant: () => ipcRenderer.invoke(desktopChannels.openSetupAssistant),
  checkResource: (id) => ipcRenderer.invoke(desktopChannels.checkResource, id),
  installResource: (id) => ipcRenderer.invoke(desktopChannels.installResource, id),
  openResourceLogin: (id) => ipcRenderer.invoke(desktopChannels.openResourceLogin, id),
};
contextBridge.exposeInMainWorld('studio', desktopApi);
