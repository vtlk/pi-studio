export const cuaVersion = '0.49.11';
export interface ComputerPermissions {
  accessibility: boolean;
  screenRecording: boolean;
}
export interface ComputerState {
  version: string;
  phase: 'ready' | 'permissions_required' | 'unavailable';
  permissions?: ComputerPermissions;
  message?: string;
}
