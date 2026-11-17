export const cuaVersion = '0.49.11';
export interface ComputerPermissions {
  accessibility?: boolean;
  screenRecording?: boolean;
  windows?: {
    uia: boolean;
    postMessage: boolean;
    elevated?: boolean;
    integrityLevel?: string;
  };
}
/** Windows has no macOS TCC grants. This is driver readiness, not a live capture test. */
export const computerPermissionsReady = (permissions: ComputerPermissions) =>
  permissions.windows
    ? permissions.windows.uia && permissions.windows.postMessage
    : permissions.accessibility === true && permissions.screenRecording === true;
export interface ComputerState {
  version: string;
  phase: 'ready' | 'permissions_required' | 'unavailable';
  permissions?: ComputerPermissions;
  message?: string;
  reason?: 'component' | 'check';
}
