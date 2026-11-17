import { t } from '../../shared/i18n/index.ts';
import { access } from 'node:fs/promises';
import type { PiCheck } from '../../shared/contracts.ts';
import type { StartupState } from '../../shared/startup.ts';
import { checkPi, PiNotFoundError } from './checkPi.ts';
import { installPiRuntime } from './installRuntime.ts';
import { managedPiPath } from './platform.ts';

interface Options {
  root: string;
  bundled: string;
  configuredPath?: () => Promise<string>;
  probe?: typeof checkPi;
  install?: typeof installPiRuntime;
}
export class Startup {
  private state: StartupState = { phase: 'checking', message: t('StartupGate.checkingPi') };
  private started = false;
  private controller = new AbortController();
  private generation = 0;
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  read() {
    if (!this.started) this.start();
    return structuredClone(this.state);
  }
  private start() {
    this.started = true;
    const generation = ++this.generation;
    const update = (state: StartupState) => {
      if (generation === this.generation) this.state = state;
    };
    update({ phase: 'checking', message: t('StartupGate.checkingPi') });
    const signal = this.controller.signal;
    void (async () => {
      const probe = this.options.probe ?? checkPi;
      const configured = (await this.options.configuredPath?.()) ?? '';
      let pi: PiCheck;
      if (configured) pi = await probe(configured);
      else {
        let managed = false;
        try {
          await access(managedPiPath(this.options.root));
          managed = true;
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            throw error;
        }
        if (managed) pi = await probe(managedPiPath(this.options.root));
        else {
          try {
            pi = await probe('');
          } catch (error) {
            if (!(error instanceof PiNotFoundError)) throw error;
            signal.throwIfAborted();
            pi = await (this.options.install ?? installPiRuntime)(
              this.options.root,
              this.options.bundled,
              update,
              signal,
            );
          }
        }
      }
      if (!pi.supported || !pi.nativeMcp || !pi.exactSessions)
        throw new Error(t('Startup.foundPiThisStudioVersionRequiresPi', { value1: pi.version }));
      update({ phase: 'ready', message: t('Startup.piIsReady'), pi });
    })().catch((error: unknown) => {
      if (generation !== this.generation) return;
      update({
        phase: 'error',
        message:
          error instanceof Error
            ? error.message.slice(0, 700)
            : t('Startup.couldNotPreparePiCheckYourInternet'),
      });
    });
  }
  retry() {
    if (
      ['checking', 'downloading', 'installing', 'verifying'].includes(this.state.phase) &&
      this.started
    )
      return this.read();
    this.controller.abort();
    this.controller = new AbortController();
    this.started = false;
    return this.read();
  }
  async choose(path: string) {
    const pi = await (this.options.probe ?? checkPi)(path);
    if (!pi.supported || !pi.nativeMcp || !pi.exactSessions)
      throw new Error(t('Startup.selectTheSupportedPi'));
    this.generation++;
    this.controller.abort();
    this.started = true;
    this.state = { phase: 'ready', message: t('Startup.piIsReady'), pi };
    return this.read();
  }
  get path() {
    return this.state.phase === 'ready' ? (this.state.pi?.path ?? '') : '';
  }
  assertUpdateIdle() {
    if (
      this.started &&
      ['checking', 'downloading', 'installing', 'verifying'].includes(this.state.phase)
    )
      throw new Error(t('Startup.waitForPiInstallationToFinish'));
  }
  close() {
    this.generation++;
    this.controller.abort();
  }
}
