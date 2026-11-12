import { contextBridge, ipcRenderer } from 'electron';
import { desktopChannels, type DesktopApi } from '../shared/contracts';

const desktopApi: DesktopApi = {
  getInfo: () => ipcRenderer.invoke(desktopChannels.getInfo),
};
contextBridge.exposeInMainWorld('studio', desktopApi);
