import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { PiCheck } from '../../shared/contracts.ts';
import type { StartupState } from '../../shared/startup.ts';
import { checkPi, PiNotFoundError } from './checkPi.ts';
import { installPiRuntime } from './installRuntime.ts';

interface Options {
  root: string;
  bundled: string;
  configuredPath?: () => Promise<string>;
  probe?: typeof checkPi;
  install?: typeof installPiRuntime;
}
export class Startup {
  private state: StartupState = { phase: 'checking', message: 'Проверяем Pi…' };
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
    update({ phase: 'checking', message: 'Проверяем Pi…' });
    const signal = this.controller.signal;
    void (async () => {
      const probe = this.options.probe ?? checkPi;
      const configured = (await this.options.configuredPath?.()) ?? '';
      let pi: PiCheck;
      if (configured) pi = await probe(configured);
      else {
        let managed = false;
        try {
          await access(join(this.options.root, 'bin/pi'));
          managed = true;
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            throw error;
        }
        if (managed) pi = await probe(join(this.options.root, 'bin/pi'));
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
        throw new Error(
          `Найдена Pi ${pi.version}. Для этой версии Studio требуется Pi 1.5.2 с native MCP и точными сессиями. Существующая установка сохранена.`,
        );
      update({ phase: 'ready', message: 'Pi готов.', pi });
    })().catch((error: unknown) => {
      if (generation !== this.generation) return;
      update({
        phase: 'error',
        message:
          error instanceof Error
            ? error.message.slice(0, 700)
            : 'Не удалось подготовить Pi. Проверьте интернет и повторите попытку.',
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
  skip() {
    this.generation++;
    this.controller.abort();
    this.state = { phase: 'skipped', message: 'Студия открыта без Pi.' };
    this.started = true;
    return this.read();
  }
  async choose(path: string) {
    const pi = await (this.options.probe ?? checkPi)(path);
    if (!pi.supported || !pi.nativeMcp || !pi.exactSessions)
      throw new Error('Выберите поддерживаемую Pi 1.5.2.');
    this.generation++;
    this.controller.abort();
    this.started = true;
    this.state = { phase: 'ready', message: 'Pi готов.', pi };
    return this.read();
  }
  get path() {
    return this.state.phase === 'ready' ? (this.state.pi?.path ?? '') : '';
  }
  close() {
    this.generation++;
    this.controller.abort();
  }
}
