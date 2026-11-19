export type UpdatePlatform = 'darwin' | 'win32';
export interface UpdateManifest {
  schema: 1;
  appId: 'studio.pi.desktop';
  version: string;
  platform: UpdatePlatform;
  arch: 'arm64' | 'x64';
  minOs: string;
  format: 'mac-zip' | 'windows-portable-zip';
  sourceCommit: string;
  archive: { name: string; sha256: string; bytes: number; unpackedBytes: number };
}
export interface UpdateOffer {
  version: string;
  notes: string;
  releaseUrl: string;
  bytes: number;
}
export interface UpdateView {
  page: 'projects' | 'project' | 'agents' | 'settings' | 'onboarding';
  projectId?: string;
}
export const updateBlockers = [
  'drafts',
  'voice',
  'dialog',
  'credentials',
  'saving',
  'save-error',
] as const;
export type UpdateBlocker = (typeof updateBlockers)[number];
export interface UpdateReadiness {
  saved: boolean;
  blocker?: UpdateBlocker;
  token?: string;
  view?: UpdateView;
  startupToken?: string;
  hydrated?: boolean;
  manualCheckToken?: string;
}
export interface UpdateStartupInfo {
  phase: 'starting' | 'committed' | 'restored' | 'aborting' | 'recovery-required';
  token: string;
  initialized?: boolean;
  message?: string;
  view?: UpdateView;
  folder?: string;
}
export interface UpdateState {
  phase:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'verifying'
    | 'waiting'
    | 'installing'
    | 'error';
  currentVersion: string;
  offer?: UpdateOffer;
  downloaded?: number;
  message?: string;
  checkedAt?: number;
  prepareToken?: string;
  waitingReason?: UpdateBlocker | 'work' | 'interface';
  startup?: UpdateStartupInfo;
  maintenanceError?: string;
  manualCheckToken?: string;
}
