/** Only explicit, typed desktop capabilities may cross the preload boundary. */
export interface DesktopInfo {
  platform: 'darwin';
  version: string;
  prototype: true;
}

export interface DesktopApi {
  getInfo(): Promise<DesktopInfo>;
}

export const desktopChannels = { getInfo: 'studio:get-info' } as const;
