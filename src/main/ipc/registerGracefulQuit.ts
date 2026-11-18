import { app } from 'electron';

/** Keep the event channel alive for Pi's final numeric accounting acknowledgement. */
export function registerGracefulQuit(
  runs: { drain(): Promise<void> }[],
  controllers: { close(): void | Promise<void> }[],
  admission?: { close(): Promise<void>; failed(error: unknown): void },
) {
  let draining = false,
    finished = false;
  // before-quit precedes the renderer's unsaved-changes confirmation: Stay keeps Pi alive.
  app.on('will-quit', (event) => {
    if (finished) return;
    event.preventDefault();
    if (draining) return;
    draining = true;
    void (async () => {
      try {
        await admission?.close();
      } catch (error) {
        draining = false;
        admission?.failed(error);
        return;
      }
      const results = await Promise.allSettled(runs.map((run) => run.drain()));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') {
        draining = false;
        admission?.failed(failure.reason);
        return;
      }
      // Wait for asynchronous cleanup attempts too; every owned controller is attempted.
      // A cancellation that must veto quit belongs in a pre-close admission guard.
      await Promise.allSettled(
        controllers.map((controller) => Promise.resolve().then(() => controller.close())),
      );
      finished = true;
      // Electron is still unwinding the cancelled native quit inside this microtask.
      // A reentrant quit is ignored; resume on the next event-loop turn instead.
      setImmediate(() => app.quit());
    })();
  });
}
