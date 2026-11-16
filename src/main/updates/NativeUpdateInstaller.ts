import { cp, mkdir, readFile, realpath, rm, statfs } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import semver from 'semver';
import type { UpdateManifest } from '../../shared/updates.ts';
import type { UpdateInstaller } from './installation.ts';
import { verifyInventory } from '../../../bundled/update-helper/inventory.mjs';
import {
  paths,
  exists,
  validateJob,
  sameIdentity,
  type UpdateJob,
} from '../../../bundled/update-helper/protocol.mjs';
import {
  applicationIdentity,
  applicationMetadata,
  verifyApplication,
} from './verifyApplication.ts';
import { extractUpdate } from './extractUpdate.ts';
import { privateDirectory } from './privateDirectory.ts';
import { PreparedUpdate } from './PreparedUpdate.ts';

interface Options {
  target: string;
  userData: string;
  version: string;
  platform: 'darwin' | 'win32';
  arch: 'arm64' | 'x64';
  helperSource: string;
  protectedRoots(): string[] | Promise<string[]>;
  helperNode(signal: AbortSignal): Promise<string>;
  /** Main-owned dependencies; never exposed in IPC. */
  verify?: typeof verifyApplication;
  freeSpace?: (directory: string) => Promise<number>;
}
function inside(root: string, path: string) {
  const child = relative(root, path);
  return !child || !(child === '..' || child.startsWith('..' + sep) || isAbsolute(child));
}
async function matchesArchive(
  archive: string,
  expected: UpdateManifest['archive'],
  signal: AbortSignal,
) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(archive, { signal })) {
    bytes += chunk.length;
    if (bytes > expected.bytes) throw new Error('Размер пакета изменился после загрузки.');
    hash.update(chunk);
  }
  if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256)
    throw new Error('Пакет изменился после проверки. Программа сохранена.');
}

/** Prepares a same-volume program-only transaction; no user-data copies or process termination. */
export class NativeUpdateInstaller implements UpdateInstaller {
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  async prepare(archive: string, manifest: UpdateManifest, signal: AbortSignal) {
    const o = this.options;
    signal.throwIfAborted();
    if (
      manifest.platform !== o.platform ||
      manifest.arch !== o.arch ||
      !semver.gt(manifest.version, o.version)
    )
      throw new Error('Обновление не подходит версии или платформе установленной программы.');
    const oldIdentity = await applicationIdentity(o.target);
    const userData = await realpath(o.userData);
    for (const root of [userData, ...(await o.protectedRoots())]) {
      if (inside(o.target, await realpath(root)))
        throw new Error(
          'Папка студии или настроек находится внутри программы. Перенесите её перед обновлением.',
        );
    }
    const current = JSON.parse(await readFile(applicationMetadata(o.target, o.platform), 'utf8'));
    if (current.name !== 'pi-video-studio' || current.version !== o.version)
      throw new Error('Установленная программа изменилась. Перезапустите Studio.');
    try {
      await verifyInventory(o.target, o.platform);
    } catch {
      throw new Error(
        'В папке программы есть изменения или отсутствует опись. Автоматическая замена отменена.',
      );
    }
    const free = o.freeSpace
      ? await o.freeSpace(dirname(o.target))
      : await statfs(dirname(o.target)).then((fs) => fs.bavail * fs.bsize);
    if (free < manifest.archive.unpackedBytes * 2 + 128 * 1024 ** 2)
      throw new Error('Недостаточно места на диске установленной программы.');
    await matchesArchive(archive, manifest.archive, signal);
    const id = randomUUID(),
      stage = join(dirname(o.target), `.pistudio-update-${id}`);
    // Non-recursive creation owns this exact directory; never reuse a pre-existing stage.
    await mkdir(stage, { mode: 0o700 });
    let job: UpdateJob | undefined;
    try {
      await privateDirectory(stage);
      const candidate = await extractUpdate(archive, join(stage, 'next'), manifest, signal);
      await (o.verify ?? verifyApplication)(candidate, o.target, manifest);
      await verifyInventory(candidate, o.platform);
      await cp(o.helperSource, join(stage, 'helper'), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      const node = await realpath(await o.helperNode(signal));
      if (inside(o.target, node) || inside(stage, node))
        throw new Error('Компоненты установщика должны находиться вне заменяемой программы.');
      job = validateJob({
        schema: 1,
        id,
        nonce: randomUUID(),
        platform: o.platform,
        oldPid: process.pid,
        oldVersion: o.version,
        version: manifest.version,
        target: o.target,
        stage,
        userData,
        oldIdentity,
        newIdentity: await applicationIdentity(candidate),
        limits: { exitMs: 120000, healthMs: 90000, abortMs: 30000 },
      });
      if (await exists(paths(job).active))
        throw new Error('Предыдущее обновление ещё не завершено.');
      signal.throwIfAborted();
      const prepared = new PreparedUpdate(job, node, async () => {
        if (!sameIdentity(await applicationIdentity(o.target), oldIdentity))
          throw new Error('Установленная программа изменилась во время ожидания.');
        await verifyInventory(o.target, o.platform);
        for (const root of [userData, ...(await o.protectedRoots())])
          if (inside(o.target, await realpath(root)))
            throw new Error('Папка студии переместилась внутрь программы. Обновление отменено.');
      });
      await prepared.persist();
      return prepared;
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      if (job) await rm(paths(job).journal, { force: true });
      throw error;
    }
  }
}
