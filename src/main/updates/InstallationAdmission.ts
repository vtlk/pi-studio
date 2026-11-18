import { t } from '../../shared/i18n/index.ts';
import type { InvocationRelease } from './InvocationGate.ts';
import type { InstallLease } from './installation.ts';

interface Options {
  assertIdle(): void;
  gate(): InvocationRelease | undefined;
  runs: { hold(): InstallLease }[];
  background: { hold(): { release(): void }; flush(): Promise<void> };
}
/** All holds are acquired synchronously before any asynchronous flush; failures unwind exactly once. */
export function acquireInstallation(options: Options): InstallLease | undefined {
  const releaseGate = options.gate();
  if (!releaseGate) return;
  const held: InstallLease[] = [];
  let background: { release(): void } | undefined,
    released = false;
  const release = () => {
    if (released) return;
    released = true;
    background?.release();
    for (const hold of [...held].reverse()) hold.release();
    releaseGate();
  };
  try {
    options.assertIdle();
    for (const run of options.runs) held.push(run.hold());
    background = options.background.hold();
    return {
      ready: async (signal) => {
        await releaseGate.whenIdle?.(signal);
      },
      verify: () => {
        if (released)
          throw new Error(t('error.installationAdmission.installationAlreadyCancelled'));
        options.assertIdle();
        for (const hold of held) hold.verify();
      },
      drainIdle: async () => {
        await options.background.flush();
        for (const hold of held) await hold.drainIdle();
      },
      release,
    };
  } catch {
    release();
    return;
  }
}
