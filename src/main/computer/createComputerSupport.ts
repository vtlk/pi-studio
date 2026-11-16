import { ComputerSupport } from './ComputerSupport';
import { CuaRuntime } from './CuaRuntime';
import { ComputerOverlay } from './ComputerOverlay';

export function createComputerSupport() {
  return new ComputerSupport(
    new CuaRuntime({
      // macOS direct mode has no native Cua overlay. Keep Windows' vendor cursor unchanged.
      feedback: process.platform === 'darwin' ? new ComputerOverlay() : undefined,
    }),
  );
}
