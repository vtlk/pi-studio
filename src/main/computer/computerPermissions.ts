import type { ComputerPermissions } from '../../shared/computer.ts';

export class ComputerPermissionCheckError extends Error {}

/** Exact 0.49.11 platform contracts; missing fields never imply access or a broken installation. */
export function computerPermissions(
  json: string | undefined,
  platform: NodeJS.Platform,
): ComputerPermissions {
  try {
    const state = JSON.parse(json ?? '') as Record<string, unknown>;
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error();
    if (platform === 'win32') {
      if (typeof state.uia !== 'boolean' || typeof state.post_message !== 'boolean') throw Error();
      return {
        windows: {
          uia: state.uia,
          postMessage: state.post_message,
          ...(typeof state.elevated === 'boolean' ? { elevated: state.elevated } : {}),
          ...(typeof state.integrity_level === 'string'
            ? { integrityLevel: state.integrity_level }
            : {}),
        },
      };
    }
    if (typeof state.accessibility !== 'boolean' || typeof state.screen_recording !== 'boolean')
      throw Error();
    return { accessibility: state.accessibility, screenRecording: state.screen_recording };
  } catch {
    throw new ComputerPermissionCheckError('Computer Use permission check failed');
  }
}
