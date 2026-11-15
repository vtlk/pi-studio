import { app } from 'electron';

/** Keep the event channel alive for Pi's final numeric accounting acknowledgement. */
export function registerGracefulQuit(
  runs: { drain(): Promise<void> }[],
  controllers: { close(): void }[],
) {
  let draining = false,
    finished = false;
  // before-quit precedes the renderer's unsaved-changes confirmation: Stay keeps Pi alive.
  app.on('will-quit', (event) => {
    if (finished) return;
    event.preventDefault();
    if (draining) return;
    draining = true;
    void Promise.allSettled(runs.map((run) => run.drain())).finally(() => {
      for (const controller of controllers) {
        try {
          controller.close();
        } catch {
          /* Other owned processes still need closing. */
        }
      }
      finished = true;
      // Electron is still unwinding the cancelled native quit inside this microtask.
      // A reentrant quit is ignored; resume on the next event-loop turn instead.
      setImmediate(() => app.quit());
    });
  });
}
