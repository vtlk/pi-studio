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
import type { LaunchAgentRequest, LaunchAgentResult } from './runtime';
import type { VideoProjectInspection } from './video';
import type { LibraryListing } from './library';
import type { LibraryKind } from './library';
import type { ReferenceFile } from './attachments';
import type { LibraryCharacter } from './characterRig';

/** Only explicit, typed desktop capabilities may cross the preload boundary. */
export interface DesktopInfo {
  platform: 'darwin';
  version: string;
  runtimeConnected: boolean;
}

export interface DesktopApi {
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
  readOutput(request: FileRequest): Promise<OutputFile>;
  inspectVideoProject(request: FileRequest): Promise<VideoProjectInspection>;
  revealOutput(request: FileRequest): Promise<void>;
  checkPi(path: string): Promise<PiCheck>;
  getProviderStatus(provider: string): Promise<ProviderStatus>;
  openProviderLogin(provider: string): Promise<void>;
  chooseSkill(): Promise<Resource | null>;
  readSkill(resourceId: string): Promise<SkillDocument>;
  beginCodexLogin(): Promise<AuthLoginState>;
  readAuthLogin(id: string): Promise<AuthLoginState>;
  cancelAuthLogin(id: string): Promise<void>;
  answerAuthLogin(id: string, promptId: string, answer: string): Promise<void>;
  getStartup(): Promise<StartupState>;
  retryStartup(): Promise<StartupState>;
  skipStartup(): Promise<StartupState>;
  chooseStartupPi(): Promise<StartupState | null>;
  getModelCatalog(): Promise<PiModelCatalog>;
  launchAgent(request: LaunchAgentRequest): Promise<LaunchAgentResult>;
  openSetupAssistant(): Promise<void>;
  listLibrary(): Promise<LibraryListing>;
  readLibraryCharacter(id: string, version: number, revision: string): Promise<LibraryCharacter>;
  chooseReferenceFiles(): Promise<ReferenceFile[]>;
  createLibraryAsset(request: {
    kind: LibraryKind;
    description: string;
    attachments: string[];
  }): Promise<void>;
  checkResource(resourceId: string): Promise<ResourceCheck>;
  installResource(resourceId: string): Promise<Resource>;
  openResourceLogin(
    resourceId: string,
  ): Promise<{ opened: boolean; authorized: boolean; next: string }>;
}

export interface ProviderStatus {
  provider: string;
  status: 'ready' | 'not_ready' | 'invalid';
}

export interface PiCheck {
  path: string;
  version: string;
  supported: boolean;
  nativeMcp: boolean;
  exactSessions: boolean;
}

export const desktopChannels = {
  listLibrary: 'studio:list-library',
  readLibraryCharacter: 'studio:read-library-character',
  chooseReferenceFiles: 'studio:choose-reference-files',
  createLibraryAsset: 'studio:create-library-asset',
  getInfo: 'studio:get-info',
  loadStudio: 'studio:load',
  chooseStudio: 'studio:choose',
  openStudio: 'studio:open',
  saveSection: 'studio:save-section',
  projectCommand: 'studio:project-command',
  readProject: 'studio:read-project',
  readOutput: 'studio:read-output',
  inspectVideoProject: 'studio:inspect-video-project',
  revealOutput: 'studio:reveal-output',
  checkPi: 'studio:check-pi',
  getProviderStatus: 'studio:provider-status',
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
  launchAgent: 'studio:launch-agent',
  openSetupAssistant: 'studio:setup-assistant',
  checkResource: 'studio:resource-check',
  installResource: 'studio:resource-install',
  openResourceLogin: 'studio:resource-login',
} as const;
