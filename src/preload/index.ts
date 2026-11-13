import { contextBridge, ipcRenderer } from 'electron';
import { desktopChannels, type DesktopApi } from '../shared/contracts';

const desktopApi: DesktopApi = {
  getInfo: () => ipcRenderer.invoke(desktopChannels.getInfo),
  loadStudio: () => ipcRenderer.invoke(desktopChannels.loadStudio),
  chooseStudio: () => ipcRenderer.invoke(desktopChannels.chooseStudio),
  openStudio: (folder) => ipcRenderer.invoke(desktopChannels.openStudio, folder),
  saveSection: (section, value) => ipcRenderer.invoke(desktopChannels.saveSection, section, value),
  projectCommand: (command) => ipcRenderer.invoke(desktopChannels.projectCommand, command),
  readProject: (id) => ipcRenderer.invoke(desktopChannels.readProject, id),
  readOutput: (request) => ipcRenderer.invoke(desktopChannels.readOutput, request),
  revealOutput: (request) => ipcRenderer.invoke(desktopChannels.revealOutput, request),
  checkPi: (path) => ipcRenderer.invoke(desktopChannels.checkPi, path),
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
  getModelCatalog: () => ipcRenderer.invoke(desktopChannels.getModelCatalog),
  launchAgent: (request) => ipcRenderer.invoke(desktopChannels.launchAgent, request),
};
contextBridge.exposeInMainWorld('studio', desktopApi);
