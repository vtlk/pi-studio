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
  readStandard: (skill, file) => ipcRenderer.invoke(desktopChannels.readStandard, skill, file),
  saveStandard: (skill, file, content) =>
    ipcRenderer.invoke(desktopChannels.saveStandard, skill, file, content),
  resetStandard: (skill, file) => ipcRenderer.invoke(desktopChannels.resetStandard, skill, file),
  getProviderStatus: (provider) => ipcRenderer.invoke(desktopChannels.getProviderStatus, provider),
  openProviderLogin: (provider) => ipcRenderer.invoke(desktopChannels.openProviderLogin, provider),
};
contextBridge.exposeInMainWorld('studio', desktopApi);
