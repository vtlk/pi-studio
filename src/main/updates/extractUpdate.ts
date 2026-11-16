import { mkdir, open, symlink, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { crc32 } from 'node:zlib';
import { openPromise } from 'yauzl';
import type { Readable } from 'node:stream';
import type { UpdateManifest } from '../../shared/updates.ts';
import { inspectUpdateArchive } from './archive.ts';

/** Only preflighted, authenticated archives. Links are created after every regular file. */
export async function extractUpdate(
  archive: string,
  destination: string,
  manifest: UpdateManifest,
  signal: AbortSignal,
) {
  const inspected = await inspectUpdateArchive(
    archive,
    manifest.platform,
    manifest.archive.unpackedBytes,
    signal,
  );
  await mkdir(destination, { mode: 0o700 });
  const zip = await openPromise(archive, {
    lazyEntries: true,
    autoClose: false,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  const links: { path: string; target: string }[] = [];
  const directories: { path: string; mode: number }[] = [];
  try {
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted();
      const path = join(destination, ...entry.fileName.replace(/\/$/, '').split('/'));
      const mode = entry.externalFileAttributes >>> 16;
      if (entry.fileName.endsWith('/')) {
        await mkdir(path, { recursive: true, mode: 0o700 });
        directories.push({ path, mode: mode & 0o777 || 0o755 });
        continue;
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const link = (mode & 0o170000) === 0o120000;
      const handle = link ? undefined : await open(path, 'wx', 0o600);
      let stream: Readable | undefined;
      const chunks: Buffer[] = [];
      let checksum = 0,
        length = 0;
      try {
        stream = await zip.openReadStreamPromise(entry);
        for await (const input of stream) {
          signal.throwIfAborted();
          const chunk = Buffer.from(input);
          length += chunk.length;
          if (length > entry.uncompressedSize || (link && length > 4096))
            throw new Error('Распакованный файл превышает допустимый размер.');
          checksum = crc32(chunk, checksum);
          if (link) chunks.push(chunk);
          else await handle!.writeFile(chunk);
        }
        if (length !== entry.uncompressedSize || checksum !== entry.crc32)
          throw new Error('Повреждён файл в архиве обновления (CRC).');
        if (handle) {
          await handle.chmod(mode & 0o777 || 0o644);
          await handle.sync();
        } else links.push({ path, target: Buffer.concat(chunks).toString('utf8') });
      } finally {
        stream?.destroy();
        await handle?.close();
      }
    }
    // Preflight rejected entries beneath symlinks. Until now all parents are real directories.
    for (const link of links) {
      signal.throwIfAborted();
      await symlink(link.target, link.path);
    }
    for (const directory of directories.reverse()) await chmod(directory.path, directory.mode);
    signal.throwIfAborted();
    return join(destination, inspected.root);
  } finally {
    zip.close();
  }
}
