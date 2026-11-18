import { ComputerSupport } from './ComputerSupport';
import { CuaRuntime } from './CuaRuntime';
import { ComputerOverlay } from './ComputerOverlay';

export function createComputerSupport() {
  return new ComputerSupport(
    new CuaRuntime({
      // The same inert frame and yellow pointer on both supported desktop platforms.
      feedback: new ComputerOverlay(),
    }),
  );
}
