import { t } from '../../shared/i18n/index.ts';
import { randomUUID } from 'node:crypto';
import type { UpdateReadiness, UpdateState, UpdateView } from '../../shared/updates.ts';
import type { UpdateCoordinator } from './UpdateCoordinator.ts';
import type { UpdateStartup } from './UpdateStartup.ts';
import { cleanupFinishedUpdates } from './cleanupUpdate.ts';
import { restoreUpdateView } from './UpdateViewStore.ts';
import { cleanupDownloads } from './cleanupDownloads.ts';
import { join } from 'node:path';

interface Options {
  version: string;
  userData: string;
  target: string;
  coordinator?: UpdateCoordinator;
  startup?: UpdateStartup;
  folder(): Promise<string>;
  flush(): Promise<void>;
  releaseStartup(): void;
  quit(): void;
}
/** Joins post-restart health with the ordinary updater; no renderer URL/path/command inputs. */
export class NativeUpdates {
  private readonly options: Options;
  private readonly token = randomUUID();
  private view?: UpdateView;
  private startupFolder?: string;
  private preparing?: Promise<void>;
  private cleanupPending = false;
  private cleaned = false;
  private healthy = false;
  private closed = false;
  private started = false;
  private initialization?: Promise<void>;
  private reportedStartup = false;
  private maintenanceError?: string;
  private manualCheckToken?: string;
  private manualError?: string;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(options: Options) {
    this.options = options;
    this.timer = setInterval(() => this.tick(), 500);
    this.timer.unref();
  }
  initialize() {
    return (this.initialization ??= this.initializeOnce());
  }
  private async initializeOnce() {
    if (this.options.startup) {
      await this.options.startup.start();
      this.startupFolder = await this.options.folder();
      this.view = await restoreUpdateView(this.options.startup.job, this.startupFolder);
    }
    this.tick();
  }
  read(): UpdateState {
    const state = this.options.coordinator?.read() ?? {
      phase: this.manualError ? ('error' as const) : ('idle' as const),
      currentVersion: this.options.version,
      message: this.manualError,
    };
    const startup = this.options.startup;
    return {
      ...state,
      maintenanceError: this.maintenanceError,
      manualCheckToken: this.manualCheckToken,
      startup: startup
        ? { ...startup.read(), token: this.token, view: this.view, folder: this.startupFolder }
        : undefined,
    };
  }
  check() {
    if (this.closed) return Promise.resolve(this.read());
    if (this.read().prepareToken) return Promise.resolve(this.read());
    this.manualCheckToken = randomUUID();
    if (this.read().startup?.phase === 'starting') return Promise.resolve(this.read());
    if (['downloading', 'verifying', 'waiting', 'installing'].includes(this.read().phase))
      return Promise.resolve(this.read());
    if (!this.options.coordinator)
      this.manualError = t('NativeUpdates.updateChecksAreAvailableInTheInstalled');
    return (
      this.options.coordinator?.check().then(() => this.read()) ?? Promise.resolve(this.read())
    );
  }
  request() {
    if (this.closed) return this.close().then(() => this.options.quit());
    if (this.maintenanceError) {
      this.maintenanceError = undefined;
      this.cleaned = false;
      this.tick();
      return Promise.resolve();
    }
    const phase = this.read().startup?.phase;
    if (phase && !['committed', 'restored'].includes(phase))
      return Promise.reject(new Error(t('NativeUpdates.waitForStudioStartupToFinish')));
    return this.options.coordinator?.request() ?? Promise.resolve();
  }
  report(ready: UpdateReadiness) {
    if (ready?.manualCheckToken && ready.manualCheckToken === this.manualCheckToken)
      this.manualCheckToken = undefined;
    if (this.options.startup?.read().phase === 'starting') {
      if (
        !this.preparing &&
        !this.reportedStartup &&
        ready?.saved === true &&
        ready.hydrated === true &&
        ready.startupToken === this.token
      ) {
        const work = this.options
          .flush()
          .then(async () => {
            if (!this.closed) await this.options.startup!.confirmReady();
            this.reportedStartup = true;
            this.view = undefined;
          })
          .finally(() => {
            if (this.preparing === work) this.preparing = undefined;
          });
        this.preparing = work;
        return work;
      }
      return Promise.resolve();
    }
    if (ready?.saved && ready.hydrated && ready.startupToken === this.token) this.view = undefined;
    this.options.coordinator?.report(ready);
    return Promise.resolve();
  }
  private tick() {
    if (this.closed) return;
    const phase = this.options.startup?.read().phase;
    if (phase && !['committed', 'restored'].includes(phase)) return;
    if (!this.healthy) {
      this.healthy = true;
      this.options.releaseStartup();
    }
    if (!this.started) {
      this.started = true;
      this.options.coordinator?.start();
    }
    if (!this.cleaned && !this.cleanupPending) {
      this.cleanupPending = true;
      void this.cleanup()
        .then(
          (finished) => {
            this.cleaned = finished;
          },
          (error: unknown) => {
            // Keep owned staging/journals for another normal startup rather than deleting uncertain data.
            this.cleaned = true;
            this.maintenanceError =
              error instanceof Error
                ? error.message.slice(0, 500)
                : t('NativeUpdates.couldNotDeleteTemporaryUpdateFilesThey');
          },
        )
        .finally(() => {
          this.cleanupPending = false;
        });
    }
  }
  private async cleanup() {
    const results = await Promise.allSettled([
      cleanupDownloads(join(this.options.userData, 'updates/downloads')),
      cleanupFinishedUpdates(this.options.userData, this.options.target),
    ]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const transactions = results[1];
    return transactions.status === 'fulfilled' && transactions.value === true;
  }
  wake() {
    if (this.healthy) this.options.coordinator?.wake();
    this.tick();
  }
  quitPrevented() {
    this.options.coordinator?.quitPrevented();
  }
  get installing() {
    return this.options.coordinator?.read().phase === 'installing';
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.options.startup?.close();
    await this.preparing?.catch(() => undefined);
    await this.options.coordinator?.close();
  }
}
