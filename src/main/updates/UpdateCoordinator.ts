import { t } from '../../shared/i18n/index.ts';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UpdateState, UpdateReadiness, UpdateView } from '../../shared/updates.ts';
import type { UpdateTarget } from './releasePolicy.ts';
import type { UpdateInstaller, PreparedInstallation, InstallLease } from './installation.ts';
import { checkGitHubReleases, type VerifiedUpdate } from './githubReleases.ts';
import { downloadVerifiedUpdate } from './download.ts';
import { UpdateSchedule } from './UpdateSchedule.ts';
import { prepareDownload, releaseDownload } from './cleanupDownloads.ts';

interface Options {
  target: UpdateTarget;
  publicKey: string;
  cacheRoot: string;
  installer: UpdateInstaller;
  idle(): boolean;
  acquire(): InstallLease | undefined;
  flushMain(view?: UpdateView): Promise<void>;
  quit(): void;
  check?: typeof checkGitHubReleases;
  download?: typeof downloadVerifiedUpdate;
  now?: () => number;
}
const busyPhases = new Set(['downloading', 'verifying', 'waiting', 'installing']);
/** Consent binds one verified offer. Only a current saved-renderer acknowledgement may acquire a lease. */
export class UpdateCoordinator {
  private readonly options: Options;
  private readonly schedule: UpdateSchedule<VerifiedUpdate | undefined>;
  private state: UpdateState;
  private candidate?: VerifiedUpdate;
  private work?: Promise<void>;
  private prepared?: PreparedInstallation;
  private directory?: string;
  private lease?: InstallLease;
  private clearing?: Promise<void>;
  private closed = false;
  private committed = false;
  private rendererSaved = false;
  private rendererSeen = 0;
  private tokenIssued = 0;
  private view?: UpdateView;
  private readonly abort = new AbortController();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(options: Options) {
    this.options = options;
    this.state = { phase: 'idle', currentVersion: options.target.version };
    this.schedule = new UpdateSchedule({
      check: async (signal) => {
        if (busyPhases.has(this.state.phase)) return this.candidate;
        this.state = { ...this.state, phase: 'checking', message: undefined };
        return (options.check ?? checkGitHubReleases)({
          target: options.target,
          publicKey: options.publicKey,
          signal,
        });
      },
      result: (candidate) => {
        if (busyPhases.has(this.state.phase)) return;
        this.candidate = candidate;
        this.state = {
          currentVersion: options.target.version,
          phase: candidate ? 'available' : 'idle',
          offer: candidate?.offer,
          checkedAt: this.now(),
          prepareToken: this.lease ? this.state.prepareToken : undefined,
        };
      },
      error: (error) => {
        if (!busyPhases.has(this.state.phase)) void this.fail(error);
      },
    });
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  start() {
    this.schedule.start();
  }
  wake() {
    this.schedule.wake();
    this.tick();
  }
  read() {
    return structuredClone(this.state);
  }
  check() {
    return this.schedule.checkNow(true).then(() => this.read());
  }
  quitPrevented() {
    if (this.state.phase !== 'installing') return;
    this.committed = false;
    void this.fail(new Error(t('UpdateCoordinator.quitCancelledChangesHaveNotBeenSaved')));
  }
  request(): Promise<void> {
    if (this.work) return this.work;
    if (this.closed || busyPhases.has(this.state.phase)) return Promise.resolve();
    const work = this.prepare()
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        if (this.work === work) this.work = undefined;
      });
    this.work = work;
    return work;
  }
  private async prepare() {
    await this.schedule.checkNow(true);
    if (this.closed) return;
    if (this.state.phase !== 'available' || !this.candidate)
      throw new Error(
        this.state.message ?? t('UpdateCoordinator.aCompatibleUpdateIsNoLongerAvailable'),
      );
    const candidate = this.candidate;
    await this.discard(true);
    this.state = {
      ...this.state,
      phase: 'downloading',
      downloaded: 0,
      message: undefined,
      prepareToken: undefined,
    };
    this.directory = await prepareDownload(this.options.cacheRoot, candidate.manifest);
    const file = join(this.directory, 'package.zip');
    await (this.options.download ?? downloadVerifiedUpdate)({
      update: candidate,
      publicKey: this.options.publicKey,
      destination: file,
      signal: this.abort.signal,
      resume: true,
      progress: (downloaded) => {
        if (!this.closed) this.state = { ...this.state, downloaded };
      },
    });
    this.abort.signal.throwIfAborted();
    this.state = { ...this.state, phase: 'verifying' };
    this.prepared = await this.options.installer.prepare(
      file,
      candidate.manifest,
      this.abort.signal,
    );
    this.abort.signal.throwIfAborted();
    await releaseDownload(this.directory);
    this.directory = undefined;
    this.state = {
      ...this.state,
      phase: 'waiting',
      message: t('UpdateCoordinator.willInstallAfterChangesAreSavedAnd'),
    };
    this.tick();
  }
  report(ready: UpdateReadiness) {
    if (
      typeof ready?.saved !== 'boolean' ||
      (ready.token !== undefined && (typeof ready.token !== 'string' || ready.token.length > 100))
    )
      throw new Error(t('UpdateCoordinator.invalidSaveConfirmation'));
    this.rendererSeen = this.now();
    this.rendererSaved = ready.saved;
    if (ready.token && ready.token === this.state.prepareToken && this.state.phase === 'waiting') {
      if (!ready.saved) {
        this.state = { ...this.state, prepareToken: undefined };
        return;
      }
      if (this.work || !this.options.idle()) {
        this.state = { ...this.state, prepareToken: undefined };
        return;
      }
      if (ready.view !== undefined) {
        const view = ready.view;
        if (
          !view ||
          typeof view !== 'object' ||
          !['projects', 'project', 'agents', 'settings', 'onboarding'].includes(view.page) ||
          (view.projectId !== undefined &&
            (typeof view.projectId !== 'string' || view.projectId.length > 200))
        )
          throw new Error(t('UpdateCoordinator.invalidOpenProjectState'));
        this.view = { page: view.page, projectId: view.projectId };
      }
      const lease = this.options.acquire();
      if (!lease) {
        this.state = { ...this.state, prepareToken: undefined };
        return;
      }
      this.lease = lease;
      this.state = {
        ...this.state,
        phase: 'installing',
        message: t('UpdateCoordinator.installingUpdate'),
      };
      const work = this.install()
        .catch((error: unknown) => this.fail(error))
        .finally(() => {
          if (this.work === work) this.work = undefined;
        });
      this.work = work;
    }
  }
  private tick() {
    if (this.closed || this.state.phase !== 'waiting' || this.work) return;
    if (this.state.prepareToken) {
      if (this.now() - this.tokenIssued > 15_000)
        this.state = { ...this.state, prepareToken: undefined };
      return;
    }
    if (!this.rendererSaved || this.now() - this.rendererSeen > 5000 || !this.options.idle())
      return;
    this.tokenIssued = this.now();
    this.state = { ...this.state, prepareToken: randomUUID() };
  }
  private async install() {
    const lease = this.lease!,
      prepared = this.prepared!;
    const verify = () => {
      lease.verify();
      if (!this.rendererSaved || this.now() - this.rendererSeen > 5000)
        throw new Error(t('UpdateCoordinator.interfaceSaveConfirmationIsNoLongerValid'));
    };
    if (lease.ready) await lease.ready(this.abort.signal);
    verify();
    await this.options.flushMain(this.view);
    this.abort.signal.throwIfAborted();
    verify();
    await lease.drainIdle();
    verify();
    await prepared.arm();
    this.abort.signal.throwIfAborted();
    verify();
    await prepared.commit();
    this.committed = true;
    this.options.quit();
  }
  private async fail(error: unknown) {
    if (this.closed) return;
    this.state = {
      ...this.state,
      phase: 'error',
      prepareToken: this.lease ? this.state.prepareToken : undefined,
      message:
        error instanceof Error
          ? error.message.slice(0, 700)
          : t('UpdateCoordinator.couldNotUpdatePiStudio'),
    };
    try {
      await this.discard(true);
      this.committed = false;
      this.state = { ...this.state, prepareToken: undefined };
    } catch {
      this.state = {
        ...this.state,
        message: t('UpdateCoordinator.couldNotConfirmInstallerCancellation', {
          value1: this.state.message,
        }),
      };
    }
  }
  private discard(keepPartial = false): Promise<void> {
    if (this.clearing) return this.clearing;
    const prepared = this.prepared,
      directory = this.directory,
      lease = this.lease;
    const clearing = (async () => {
      // A failed helper cancellation retains the lease; never unfreeze an uncertain installer.
      await prepared?.dispose();
      this.prepared = undefined;
      this.lease = undefined;
      lease?.release();
      if (directory) await releaseDownload(directory, keepPartial);
      this.directory = undefined;
    })().finally(() => {
      if (this.clearing === clearing) this.clearing = undefined;
    });
    this.clearing = clearing;
    return clearing;
  }
  async close() {
    this.closed = true;
    this.abort.abort();
    this.schedule.close();
    clearInterval(this.timer);
    if (!this.committed) {
      await this.work?.catch(() => undefined);
      try {
        await this.discard(true);
      } catch (error) {
        this.state = {
          ...this.state,
          phase: 'error',
          message: t('UpdateCoordinator.couldNotConfirmInstallerCancellationTheApp'),
        };
        throw error;
      }
    }
  }
}
