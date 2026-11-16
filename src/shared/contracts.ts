import type { OutputFile, WorkspaceProject } from './project';
import type {
  FileRequest,
  ProjectCommand,
  ProjectCommandResult,
  StorageSection,
  StudioBootstrap,
  SectionEdit,
  SectionSaveResult,
} from './storage';
import type { Resource, ResourceCheck, SkillDocument } from './resources';
import type { AuthLoginState } from './auth';
import type { StartupState } from './startup';
import type { PiModelCatalog } from './models';
import type { RunFailureNotice } from './runFailure';
import type { LaunchAgentRequest, LaunchAgentResult } from './runtime';
import type { VideoProjectInspection } from './video';
import type { ReferenceFile } from './attachments';
import type {
  ModelConnectionRequest,
  ModelConnectionStatus,
  ModelLoginRequest,
  ImageConnectionRequest,
  ImageConnectionStatus,
} from './connections';
import type { McpSecretRequest, McpSecretEdit, McpSecretStatus } from './mcpSecrets';
import type { ProjectActivity } from './projectActivity';
import type { ProjectUsage } from './projectUsage';
import type { ComputerState } from './computer';

/** Only explicit, typed desktop capabilities may cross the preload boundary. */
export interface DesktopInfo {
  platform: 'darwin' | 'win32';
  version: string;
  runtimeConnected: boolean;
}

export interface DesktopApi {
  getTheme(): Promise<import('./appearance').ThemeState>;
  setTheme(theme: import('./appearance').ThemeChoice): Promise<import('./appearance').ThemeState>;
  onThemeChanged(listener: (state: import('./appearance').ThemeState) => void): () => void;
  getUpdateState(): Promise<import('./updates').UpdateState>;
  checkForUpdates(): Promise<import('./updates').UpdateState>;
  requestUpdate(): Promise<void>;
  reportUpdateReadiness(ready: import('./updates').UpdateReadiness): Promise<void>;
  listTeamMessages(projectId: string): Promise<import('./teamMessages').TeamMessageInfo[]>;
  manageTeamMessage(request: import('./teamMessages').TeamMessageAction): Promise<void>;
  exportAgentTeam(
    request: import('./teamPackage').TeamPackageRequest,
  ): Promise<{ requirements: string[] } | null>;
  importAgentTeam(folder: string): Promise<import('./teamPackage').TeamSetupResult | null>;
  listTeamImports(folder: string): Promise<import('./teamPackage').TeamImportReport[]>;
  continueTeamImport(request: {
    folder: string;
    id: string;
  }): Promise<import('./teamPackage').TeamSetupResult>;
  getComputerState(): Promise<ComputerState>;
  requestComputerPermissions(): Promise<ComputerState>;
  openComputerSettings(kind: 'accessibility' | 'screen-recording'): Promise<void>;
  readMcpSecretStatus(request: McpSecretRequest): Promise<McpSecretStatus>;
  saveMcpSecrets(
    request: McpSecretEdit & { values: Record<string, string> },
  ): Promise<McpSecretStatus>;
  removeMcpSecrets(request: McpSecretEdit): Promise<McpSecretStatus>;
  readImageConnection(request: ImageConnectionRequest): Promise<ImageConnectionStatus>;
  saveImageKey(request: ImageConnectionRequest & { key: string }): Promise<ImageConnectionStatus>;
  removeImageKey(request: ImageConnectionRequest): Promise<ImageConnectionStatus>;
  checkImageConnection(request: ImageConnectionRequest): Promise<ImageConnectionStatus>;
  getInfo(): Promise<DesktopInfo>;
  loadStudio(): Promise<StudioBootstrap>;
  chooseStudio(): Promise<StudioBootstrap | null>;
  openStudio(folder: string): Promise<StudioBootstrap>;
  saveSection(
    section: StorageSection,
    value: unknown,
    edit: SectionEdit,
  ): Promise<SectionSaveResult>;
  projectCommand(command: ProjectCommand): Promise<ProjectCommandResult>;
  readProject(projectId: string): Promise<WorkspaceProject>;
  listProjectActivity(): Promise<ProjectActivity[]>;
  listProjectUsage(): Promise<ProjectUsage[]>;
  readOutput(request: FileRequest): Promise<OutputFile>;
  copyOutput(request: import('./storage').CopyOutputRequest): Promise<void>;
  inspectVideoProject(request: FileRequest): Promise<VideoProjectInspection>;
  revealOutput(request: FileRequest): Promise<void>;
  revealAgentOutput(request: { projectId: string; agentId: string }): Promise<void>;
  deleteAgentData(request: import('./storage').DeleteAgentDataRequest): Promise<WorkspaceProject>;
  checkPi(path: string): Promise<PiCheck>;
  getProviderStatus(provider: string): Promise<ProviderStatus>;
  getConnectionStatus(request: ModelConnectionRequest): Promise<ModelConnectionStatus>;
  manageClaudeCode(
    request: ModelConnectionRequest & { action: 'install' | 'login' | 'logout' },
  ): Promise<void>;
  beginConnectionLogin(request: ModelLoginRequest): Promise<AuthLoginState>;
  removeConnectionLogin(request: ModelConnectionRequest): Promise<void>;
  openProviderLogin(provider: string): Promise<void>;
  chooseSkill(): Promise<Resource | null>;
  readSkill(resourceId: string): Promise<SkillDocument>;
  saveSkill(request: import('./resources').SkillWriteRequest): Promise<Resource>;
  beginCodexLogin(): Promise<AuthLoginState>;
  readAuthLogin(id: string): Promise<AuthLoginState>;
  cancelAuthLogin(id: string): Promise<void>;
  answerAuthLogin(id: string, promptId: string, answer: string): Promise<void>;
  getStartup(): Promise<StartupState>;
  retryStartup(): Promise<StartupState>;
  skipStartup(): Promise<StartupState>;
  chooseStartupPi(): Promise<StartupState | null>;
  getModelCatalog(request?: ModelConnectionRequest): Promise<PiModelCatalog>;
  discoverConnectionModels(request: ModelConnectionRequest): Promise<string[]>;
  launchAgent(request: LaunchAgentRequest): Promise<LaunchAgentResult>;
  onRunFailure(listener: (notice: RunFailureNotice) => void): () => void;
  openSetupAssistant(): Promise<void>;
  chooseReferenceFiles(): Promise<ReferenceFile[]>;
  releaseReferenceFiles(ids: string[]): Promise<void>;
  checkResource(resourceId: string): Promise<ResourceCheck>;
  installResource(resourceId: string): Promise<Resource>;
  openResourceLogin(
    resourceId: string,
  ): Promise<{ opened: boolean; authorized: boolean; next: string; loginId?: string }>;
}

export interface ProviderStatus {
  provider: string;
  status: 'ready' | 'not_ready' | 'invalid';
  detail?: string;
}

export interface PiCheck {
  path: string;
  version: string;
  supported: boolean;
  nativeMcp: boolean;
  exactSessions: boolean;
}

export const desktopChannels = {
  getTheme: 'studio:theme',
  setTheme: 'studio:theme-set',
  themeChanged: 'studio:theme-changed',
  getUpdateState: 'studio:update-state',
  checkForUpdates: 'studio:update-check',
  requestUpdate: 'studio:update-request',
  reportUpdateReadiness: 'studio:update-readiness',
  listTeamMessages: 'studio:list-team-messages',
  manageTeamMessage: 'studio:manage-team-message',
  exportAgentTeam: 'studio:export-agent-team',
  importAgentTeam: 'studio:import-agent-team',
  listTeamImports: 'studio:list-team-imports',
  continueTeamImport: 'studio:continue-team-import',
  getComputerState: 'studio:computer-state',
  requestComputerPermissions: 'studio:computer-permissions',
  openComputerSettings: 'studio:computer-settings',
  readMcpSecretStatus: 'studio:mcp-secrets-status',
  saveMcpSecrets: 'studio:mcp-secrets-save',
  removeMcpSecrets: 'studio:mcp-secrets-remove',
  readImageConnection: 'studio:image-connection',
  saveImageKey: 'studio:image-key-save',
  removeImageKey: 'studio:image-key-remove',
  checkImageConnection: 'studio:image-connection-check',
  chooseReferenceFiles: 'studio:choose-reference-files',
  releaseReferenceFiles: 'studio:release-reference-files',
  saveSkill: 'studio:save-skill',
  deleteAgentData: 'studio:delete-agent-data',
  getInfo: 'studio:get-info',
  loadStudio: 'studio:load',
  chooseStudio: 'studio:choose',
  openStudio: 'studio:open',
  saveSection: 'studio:save-section',
  projectCommand: 'studio:project-command',
  readProject: 'studio:read-project',
  listProjectActivity: 'studio:list-project-activity',
  listProjectUsage: 'studio:list-project-usage',
  readOutput: 'studio:read-output',
  copyOutput: 'studio:copy-output',
  inspectVideoProject: 'studio:inspect-video-project',
  revealOutput: 'studio:reveal-output',
  revealAgentOutput: 'studio:reveal-agent-output',
  checkPi: 'studio:check-pi',
  getProviderStatus: 'studio:provider-status',
  getConnectionStatus: 'studio:connection-status',
  manageClaudeCode: 'studio:claude-code',
  beginConnectionLogin: 'studio:connection-login',
  removeConnectionLogin: 'studio:connection-logout',
  openProviderLogin: 'studio:provider-login',
  chooseSkill: 'studio:choose-skill',
  readSkill: 'studio:read-skill',
  beginCodexLogin: 'studio:codex-login',
  readAuthLogin: 'studio:auth-state',
  cancelAuthLogin: 'studio:auth-cancel',
  answerAuthLogin: 'studio:auth-answer',
  getStartup: 'studio:startup',
  retryStartup: 'studio:startup-retry',
  skipStartup: 'studio:startup-skip',
  chooseStartupPi: 'studio:startup-choose',
  getModelCatalog: 'studio:model-catalog',
  runFailure: 'studio:run-failure',
  discoverConnectionModels: 'studio:connection-models-discover',
  launchAgent: 'studio:launch-agent',
  openSetupAssistant: 'studio:setup-assistant',
  checkResource: 'studio:resource-check',
  installResource: 'studio:resource-install',
  openResourceLogin: 'studio:resource-login',
} as const;
