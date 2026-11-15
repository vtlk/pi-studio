import { createHash } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { atomicJson, isMissing, readJson, safePath } from './files.ts';
import { stableId } from './validation.ts';

export interface StringProtector {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

/** App-local ciphertext; Electron uses Keychain on macOS and DPAPI on Windows. */
export class SecretVault {
  private directory: string;
  private protector: StringProtector;
  constructor(directory: string, protector: StringProtector) {
    this.directory = directory;
    this.protector = protector;
  }

  available() {
    return this.protector.isAsyncEncryptionAvailable();
  }
  private async path(folder: string, id: string) {
    stableId(id);
    const scope = await realpath(folder);
    const name = createHash('sha256').update(scope).update('\0').update(id).digest('hex');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return safePath(this.directory, `${name}.json`, true);
  }
  private async encrypted(folder: string, id: string) {
    try {
      const saved = (await readJson(await this.path(folder, id))) as {
        version?: unknown;
        encrypted?: unknown;
      };
      if (
        saved.version !== 1 ||
        typeof saved.encrypted !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(saved.encrypted) ||
        saved.encrypted.length > 65536
      )
        throw new Error('Повреждён защищённый ключ подключения. Введите его заново.');
      return Buffer.from(saved.encrypted, 'base64');
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }
  async inspect(folder: string, id: string) {
    const encrypted = await this.encrypted(folder, id);
    return {
      stored: !!encrypted,
      revision: encrypted ? createHash('sha256').update(encrypted).digest('hex') : '',
    };
  }
  async save(folder: string, id: string, value: string) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 16384 ||
      /[\r\n\0]/.test(value)
    )
      throw new Error('Введите ключ без переносов строки.');
    if (!(await this.available()))
      throw new Error(
        `Защищённое хранилище ${process.platform === 'win32' ? 'Windows' : 'macOS'} недоступно. Ключ не сохранён.`,
      );
    let encrypted: Buffer;
    try {
      encrypted = await this.protector.encryptStringAsync(value.trim());
    } catch {
      throw new Error(
        `Не удалось защитить ключ средствами ${process.platform === 'win32' ? 'Windows' : 'macOS'}. Ключ не сохранён.`,
      );
    }
    await atomicJson(await this.path(folder, id), {
      version: 1,
      encrypted: encrypted.toString('base64'),
    });
  }
  async read(folder: string, id: string) {
    const encrypted = await this.encrypted(folder, id);
    if (!encrypted) throw new Error('Сначала сохраните API-ключ подключения изображений.');
    if (!(await this.available()))
      throw new Error(
        `Защищённое хранилище ${process.platform === 'win32' ? 'Windows' : 'macOS'} недоступно.`,
      );
    try {
      const result = await this.protector.decryptStringAsync(encrypted);
      if (!result.result) throw new Error('Empty secret');
      if (result.shouldReEncrypt) await this.save(folder, id, result.result);
      return result.result;
    } catch {
      throw new Error(
        process.platform === 'win32'
          ? 'Не удалось прочитать защищённый ключ Windows. Войдите в исходную учётную запись Windows или введите ключ заново.'
          : 'Не удалось прочитать защищённый ключ. Разрешите доступ к Связке ключей или введите ключ заново.',
      );
    }
  }
  async remove(folder: string, id: string) {
    await rm(await this.path(folder, id), { force: true });
  }
}
