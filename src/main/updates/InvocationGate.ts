import { t } from '../../shared/i18n/index.ts';

export type InvocationRelease = (() => void) & {
  whenIdle?: (signal?: AbortSignal) => Promise<void>;
};
/** Stop new invocations before waiting for existing ones; polling must never starve installation. */
export class InvocationGate {
  private active = 0;
  private held = false;
  private idle?: () => void;
  async invoke<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.held) throw new Error(t('error.invocationGate.aPiStudioUpdateIs'));
    this.active++;
    try {
      return await action();
    } finally {
      this.active--;
      if (!this.active) this.idle?.();
    }
  }
  acquire(): InvocationRelease | undefined {
    return this.active ? undefined : this.reserve();
  }
  reserve(timeout = 15_000): InvocationRelease | undefined {
    if (this.held) return;
    this.held = true;
    let released = false;
    let cancel: (() => void) | undefined;
    let waiting: Promise<void> | undefined;
    const release = () => {
      if (released) return;
      released = true;
      cancel?.();
      this.held = false;
    };
    return Object.assign(release, {
      whenIdle: (signal?: AbortSignal) => {
        signal?.throwIfAborted();
        if (released) return Promise.reject(new Error(t('error.invocationGate.aPiStudioUpdateIs')));
        if (!this.active) return Promise.resolve();
        return (waiting ??= new Promise<void>((resolve, reject) => {
          const finish = (error?: unknown) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            this.idle = undefined;
            cancel = undefined;
            if (error) reject(error);
            else resolve();
          };
          const abort = () =>
            finish(signal?.reason ?? new Error(t('error.invocationGate.waitCancelled')));
          const timer = setTimeout(
            () => finish(new Error(t('error.invocationGate.waitTimedOut'))),
            timeout,
          );
          this.idle = () => finish();
          cancel = () => finish(new Error(t('error.invocationGate.waitCancelled')));
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        }));
      },
    });
  }
}
