import type { OutputFile, WorkspaceProject } from './project';
import type {
  FileRequest,
  ProjectCommand,
  ProjectCommandResult,
  StorageSection,
  StudioBootstrap,
} from './storage';
import type { LibraryStandard, StandardFile, StandardDocument } from './libraryStandards';

/** Only explicit, typed desktop capabilities may cross the preload boundary. */
export interface DesktopInfo {
  platform: 'darwin';
  version: string;
  runtimeConnected: false;
}

export interface DesktopApi {
  getInfo(): Promise<DesktopInfo>;
  loadStudio(): Promise<StudioBootstrap>;
  chooseStudio(): Promise<StudioBootstrap | null>;
  openStudio(folder: string): Promise<StudioBootstrap>;
  saveSection(section: StorageSection, value: unknown): Promise<void>;
  projectCommand(command: ProjectCommand): Promise<ProjectCommandResult>;
  readProject(projectId: string): Promise<WorkspaceProject>;
  readOutput(request: FileRequest): Promise<OutputFile>;
  revealOutput(request: FileRequest): Promise<void>;
  checkPi(path: string): Promise<PiCheck>;
  readStandard(skill: LibraryStandard, file: StandardFile): Promise<StandardDocument>;
  saveStandard(
    skill: LibraryStandard,
    file: StandardFile,
    content: string,
  ): Promise<StandardDocument>;
  resetStandard(skill: LibraryStandard, file: StandardFile): Promise<StandardDocument>;
  getProviderStatus(provider: string): Promise<ProviderStatus>;
  openProviderLogin(provider: string): Promise<void>;
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
  getInfo: 'studio:get-info',
  loadStudio: 'studio:load',
  chooseStudio: 'studio:choose',
  openStudio: 'studio:open',
  saveSection: 'studio:save-section',
  projectCommand: 'studio:project-command',
  readProject: 'studio:read-project',
  readOutput: 'studio:read-output',
  revealOutput: 'studio:reveal-output',
  checkPi: 'studio:check-pi',
  readStandard: 'studio:read-standard',
  saveStandard: 'studio:save-standard',
  resetStandard: 'studio:reset-standard',
  getProviderStatus: 'studio:provider-status',
  openProviderLogin: 'studio:provider-login',
} as const;
