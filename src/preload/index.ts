import { contextBridge, ipcRenderer } from 'electron';
import { isGitHubStarState } from '../shared/githubStar';
import { desktopChannels, type DesktopApi } from '../shared/contracts';
import { runFailure } from '../shared/runFailure';
import { themeState, type ThemeState } from '../shared/appearance';

import { isLanguageState, type LanguageState } from '../shared/i18n/locale';

const desktopApi: DesktopApi = {
  getOnboardingReadiness: (request) =>
    ipcRenderer.invoke(desktopChannels.getOnboardingReadiness, request),
  openTerminalDownload: () => ipcRenderer.invoke(desktopChannels.openTerminalDownload),
  getGitHubStar: () => ipcRenderer.invoke(desktopChannels.getGitHubStar),
  chooseGitHubStar: (choice) => ipcRenderer.invoke(desktopChannels.chooseGitHubStar, choice),
  onGitHubStarChanged: (listener) => {
    const receive = (_event: unknown, value: unknown) => {
      if (isGitHubStarState(value)) listener(value);
    };
    ipcRenderer.on(desktopChannels.githubStarChanged, receive);
    return () => ipcRenderer.removeListener(desktopChannels.githubStarChanged, receive);
  },
  getLanguage: () => ipcRenderer.invoke(desktopChannels.getLanguage),
  setLanguage: (language) => ipcRenderer.invoke(desktopChannels.setLanguage, language),
  onLanguageChanged: (listener) => {
    const receive = (_event: unknown, state: LanguageState) => {
      if (isLanguageState(state)) listener(state);
    };
    ipcRenderer.on(desktopChannels.languageChanged, receive);
    return () => ipcRenderer.removeListener(desktopChannels.languageChanged, receive);
  },
  getTheme: () => ipcRenderer.invoke(desktopChannels.getTheme),
  setTheme: (theme) => ipcRenderer.invoke(desktopChannels.setTheme, theme),
  onThemeChanged: (listener) => {
    const receive = (_event: unknown, value: ThemeState) => {
      if (themeState(value)) listener(value);
    };
    ipcRenderer.on(desktopChannels.themeChanged, receive);
    return () => ipcRenderer.removeListener(desktopChannels.themeChanged, receive);
  },
  getUpdateState: () => ipcRenderer.invoke(desktopChannels.getUpdateState),
  checkForUpdates: () => ipcRenderer.invoke(desktopChannels.checkForUpdates),
  requestUpdate: () => ipcRenderer.invoke(desktopChannels.requestUpdate),
  reportUpdateReadiness: (ready) =>
    ipcRenderer.invoke(desktopChannels.reportUpdateReadiness, ready),
  exportAgentTeam: (request) => ipcRenderer.invoke(desktopChannels.exportAgentTeam, request),
  importAgentTeam: (folder) => ipcRenderer.invoke(desktopChannels.importAgentTeam, folder),
  listTeamMessages: (projectId) => ipcRenderer.invoke(desktopChannels.listTeamMessages, projectId),
  manageTeamMessage: (request) => ipcRenderer.invoke(desktopChannels.manageTeamMessage, request),
  listTeamImports: (folder) => ipcRenderer.invoke(desktopChannels.listTeamImports, folder),
  continueTeamImport: (request) => ipcRenderer.invoke(desktopChannels.continueTeamImport, request),
  getComputerState: () => ipcRenderer.invoke(desktopChannels.getComputerState),
  requestComputerPermissions: () => ipcRenderer.invoke(desktopChannels.requestComputerPermissions),
  openComputerSettings: (kind) => ipcRenderer.invoke(desktopChannels.openComputerSettings, kind),
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
  chooseReferenceFiles: () => ipcRenderer.invoke(desktopChannels.chooseReferenceFiles),
  releaseReferenceFiles: (ids) => ipcRenderer.invoke(desktopChannels.releaseReferenceFiles, ids),
  saveSkill: (request) => ipcRenderer.invoke(desktopChannels.saveSkill, request),
  deleteAgentData: (request) => ipcRenderer.invoke(desktopChannels.deleteAgentData, request),
  getInfo: () => ipcRenderer.invoke(desktopChannels.getInfo),
  loadStudio: () => ipcRenderer.invoke(desktopChannels.loadStudio),
  chooseStudio: () => ipcRenderer.invoke(desktopChannels.chooseStudio),
  openStudio: (folder) => ipcRenderer.invoke(desktopChannels.openStudio, folder),
  saveSection: (section, value, edit) =>
    ipcRenderer.invoke(desktopChannels.saveSection, section, value, edit),
  projectCommand: (command) => ipcRenderer.invoke(desktopChannels.projectCommand, command),
  readProject: (id) => ipcRenderer.invoke(desktopChannels.readProject, id),
  listProjectActivity: () => ipcRenderer.invoke(desktopChannels.listProjectActivity),
  listProjectUsage: () => ipcRenderer.invoke(desktopChannels.listProjectUsage),
  readOutput: (request) => ipcRenderer.invoke(desktopChannels.readOutput, request),
  copyOutput: (request) => ipcRenderer.invoke(desktopChannels.copyOutput, request),
  revealAgentOutput: (request) => ipcRenderer.invoke(desktopChannels.revealAgentOutput, request),
  revealOutput: (request) => ipcRenderer.invoke(desktopChannels.revealOutput, request),
  checkPi: (path) => ipcRenderer.invoke(desktopChannels.checkPi, path),
  getConnectionStatus: (request) =>
    ipcRenderer.invoke(desktopChannels.getConnectionStatus, request),
  manageClaudeCode: (request) => ipcRenderer.invoke(desktopChannels.manageClaudeCode, request),
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
  chooseStartupPi: () => ipcRenderer.invoke(desktopChannels.chooseStartupPi),
  getModelCatalog: (request) => ipcRenderer.invoke(desktopChannels.getModelCatalog, request),
  discoverConnectionModels: (request) =>
    ipcRenderer.invoke(desktopChannels.discoverConnectionModels, request),
  launchAgent: (request) => ipcRenderer.invoke(desktopChannels.launchAgent, request),
  openSetupAssistant: () => ipcRenderer.invoke(desktopChannels.openSetupAssistant),
  checkResource: (id) => ipcRenderer.invoke(desktopChannels.checkResource, id),
  installResource: (id) => ipcRenderer.invoke(desktopChannels.installResource, id),
  getBrowserState: () => ipcRenderer.invoke(desktopChannels.getBrowserState),
  installVisibleBrowser: () => ipcRenderer.invoke(desktopChannels.installVisibleBrowser),
  openResourceLogin: (id) => ipcRenderer.invoke(desktopChannels.openResourceLogin, id),
};
contextBridge.exposeInMainWorld('studio', desktopApi);
