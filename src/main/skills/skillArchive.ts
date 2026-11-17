import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { crc32 } from 'node:zlib';
import { openPromise } from 'yauzl';
import type { Readable } from 'node:stream';
import { t } from '../../shared/i18n/index.ts';
import { windowsFileName } from '../../shared/windowsNames.ts';

export const skillArchiveLimits = {
  files: 4096,
  bytes: 200 * 1024 ** 2,
  fileBytes: 20 * 1024 ** 2,
};
/** Extract regular files only into an owned empty directory. Never execute archive contents. */
export async function extractSkillArchive(
  archive: string,
  destination: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  await mkdir(destination, { mode: 0o700 });
  const zip = await openPromise(archive, {
    lazyEntries: true,
    autoClose: false,
    strictFileNames: true,
    validateEntrySizes: true,
  }).catch((cause) => {
    throw Error(t('error.remoteSkill.archive'), { cause });
  });
  const names = new Map<string, { name: string; directory: boolean; explicit: boolean }>();
  const files: string[] = [];
  let count = 0,
    bytes = 0;
  const abort = () => zip.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted();
      const directory = entry.fileName.endsWith('/');
      const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
      const parts = name.split('/');
      const mode = entry.externalFileAttributes >>> 16,
        kind = mode & 0o170000;
      if (
        ++count > skillArchiveLimits.files ||
        name.length > 1000 ||
        parts.some((part) => part === '.' || part === '..' || !windowsFileName(part)) ||
        entry.isEncrypted() ||
        ![0, 8].includes(entry.compressionMethod) ||
        ![0, 0o100000, 0o040000].includes(kind) ||
        mode & 0o6000 ||
        (kind === 0o040000 && !directory) ||
        (kind === 0o100000 && directory) ||
        (directory && entry.uncompressedSize) ||
        entry.uncompressedSize > skillArchiveLimits.fileBytes
      )
        throw Error(t('error.remoteSkill.archive'));
      bytes += entry.uncompressedSize;
      if (!Number.isSafeInteger(bytes) || bytes > skillArchiveLimits.bytes)
        throw Error(t('error.remoteSkill.size'));
      for (let i = 1; i <= parts.length; i++) {
        const path = parts.slice(0, i).join('/'),
          key = path.normalize('NFC').toLowerCase();
        const old = names.get(key),
          leaf = i === parts.length;
        if (old && (old.name !== path || !old.directory || (leaf && old.explicit)))
          throw Error(t('error.remoteSkill.archive'));
        names.set(key, {
          name: path,
          directory: !leaf || directory,
          explicit: leaf || !!old?.explicit,
        });
      }
      const header = await zip.readLocalFileHeaderPromise(entry);
      if (
        header.fileName.toString('utf8') !== entry.fileName ||
        header.compressionMethod !== entry.compressionMethod ||
        header.generalPurposeBitFlag !== entry.generalPurposeBitFlag
      )
        throw Error(t('error.remoteSkill.archive'));
      const path = join(destination, ...parts);
      if (directory) {
        await mkdir(path, { recursive: true, mode: 0o700 });
        continue;
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const handle = await open(path, 'wx', mode & 0o111 ? 0o755 : 0o644);
      let stream: Readable | undefined;
      const stop = () => stream?.destroy(new Error(t('error.remoteSkill.cancelled')));
      signal.addEventListener('abort', stop, { once: true });
      let length = 0,
        checksum = 0;
      try {
        stream = await zip.openReadStreamPromise(entry);
        signal.throwIfAborted();
        for await (const data of stream) {
          signal.throwIfAborted();
          const chunk = Buffer.from(data);
          length += chunk.length;
          if (length > entry.uncompressedSize) throw Error(t('error.remoteSkill.archive'));
          checksum = crc32(chunk, checksum);
          await handle.writeFile(chunk);
        }
        if (length !== entry.uncompressedSize || checksum !== entry.crc32)
          throw Error(t('error.remoteSkill.archive'));
      } finally {
        signal.removeEventListener('abort', stop);
        stream?.destroy();
        await handle.close();
      }
      files.push(name);
    }
    signal.throwIfAborted();
    return files;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.message === t('error.remoteSkill.size')) throw error;
    throw Error(t('error.remoteSkill.archive'), { cause: error });
  } finally {
    signal.removeEventListener('abort', abort);
    zip.close();
  }
}
