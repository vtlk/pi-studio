import { t } from '../../shared/i18n/index.ts';
import { createHash } from 'node:crypto';
import { open, rm, statfs, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { VerifiedUpdate } from './githubReleases.ts';
import {
  boundedBody,
  githubResponse,
  readUpdateChunk,
  UpdateNetworkError,
  type FetchUpdate,
} from './githubTransport.ts';
import { maxManifestBytes, verifyManifest } from './manifest.ts';
import { inspectUpdateArchive } from './archive.ts';

export async function downloadVerifiedUpdate(options: {
  update: VerifiedUpdate;
  publicKey: string;
  destination: string;
  signal: AbortSignal;
  progress: (bytes: number) => void;
  fetch?: FetchUpdate;
  freeSpace?: () => Promise<number>;
  resume?: boolean;
}) {
  const { update, signal, destination } = options;
  const expected = update.manifest.archive;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let owned = false;
  let received = 0;
  let hash = createHash('sha256');
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let preserve = false;
  try {
    if (options.resume) {
      const info = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (info) {
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.nlink !== 1 ||
          info.size > expected.bytes
        )
          throw new Error(t('error.download.invalidPartial'));
        handle = await open(destination, 'r+');
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.nlink !== 1 ||
          opened.dev !== info.dev ||
          opened.ino !== info.ino ||
          opened.size !== info.size
        )
          throw new Error(t('error.download.invalidPartial'));
        owned = true;
        received = opened.size;
      }
    }
    const free = options.freeSpace
      ? await options.freeSpace()
      : await statfs(dirname(destination)).then((fs) => fs.bavail * fs.bsize);
    // Only the missing bytes need downloading; extracted program/recovery still need full space.
    if (free < expected.bytes - received + expected.unpackedBytes * 2 + 128 * 1024 ** 2) {
      preserve = true;
      throw new Error(t('error.download.notEnoughFreeSpaceFor'));
    }
    // Revalidate on every explicit retry, even when the entire archive is already cached.
    const response = await githubResponse(update.manifestUrl, signal, options.fetch);
    const current = verifyManifest(
      await boundedBody(response, maxManifestBytes, signal),
      options.publicKey,
    );
    if (JSON.stringify(current) !== JSON.stringify(update.manifest))
      throw new Error(t('error.download.theReleaseChangedCheckFor'));
    if (handle && received) {
      const buffer = Buffer.alloc(Math.min(received, 1024 * 1024));
      for (let position = 0; position < received;) {
        signal.throwIfAborted();
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, received - position),
          position,
        );
        if (!bytesRead) throw new Error(t('error.download.invalidPartial'));
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      options.progress(received);
    }
    if (received < expected.bytes) {
      let archive;
      try {
        archive = await githubResponse(
          update.archiveUrl,
          signal,
          options.fetch,
          Date.now(),
          60_000,
          received || undefined,
        );
      } catch (error) {
        if (!(error instanceof UpdateNetworkError) || error.status !== 416 || !received)
          throw error;
        await handle!.truncate(0);
        received = 0;
        hash = createHash('sha256');
        options.progress(0);
        archive = await githubResponse(update.archiveUrl, signal, options.fetch);
      }
      const length = archive.headers.get('content-length');
      const encoding = archive.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') {
        await archive.body?.cancel();
        throw new Error(t('error.download.invalidRange'));
      }
      if (archive.status === 206) {
        const range = archive.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (
          !range ||
          Number(range[1]) !== received ||
          Number(range[2]) !== expected.bytes - 1 ||
          Number(range[3]) !== expected.bytes
        ) {
          await archive.body?.cancel();
          throw new Error(t('error.download.invalidRange'));
        }
      } else if (archive.status === 200) {
        // A server may ignore Range. Consume this full response once, replacing the prefix safely.
        if (received) {
          await handle!.truncate(0);
          received = 0;
          hash = createHash('sha256');
          options.progress(0);
        }
      } else {
        await archive.body?.cancel();
        throw new Error(t('error.download.invalidRange'));
      }
      if (length !== null && Number(length) !== expected.bytes - received) {
        await archive.body?.cancel();
        throw new Error(t('error.download.theDownloadSizeDoesNot'));
      }
      if (!archive.body) throw new Error(t('error.download.githubReturnedAnEmptyUpdate'));
      reader = archive.body.getReader();
      if (!handle) {
        handle = await open(destination, 'wx', 0o600);
        owned = true;
      }
      for (;;) {
        signal.throwIfAborted();
        const chunk = await readUpdateChunk(reader, signal).catch((error: unknown) => {
          signal.throwIfAborted();
          if (error instanceof UpdateNetworkError) throw error;
          throw new UpdateNetworkError(t('error.download.networkInterrupted'));
        });
        if (chunk.done) break;
        if (received + chunk.value.length > expected.bytes)
          throw new Error(t('error.download.theDownloadExceedsTheSigned'));
        for (let written = 0; written < chunk.value.length;) {
          const { bytesWritten } = await handle.write(
            chunk.value,
            written,
            chunk.value.length - written,
            received + written,
          );
          if (!bytesWritten) throw new Error(t('error.download.invalidPartial'));
          written += bytesWritten;
        }
        received += chunk.value.length;
        hash.update(chunk.value);
        options.progress(received);
      }
      if (received !== expected.bytes)
        throw new UpdateNetworkError(t('error.download.networkInterrupted'));
    }
    if (hash.digest('hex') !== expected.sha256)
      throw new Error(t('error.download.updateChecksumMismatchTheApp'));
    await handle!.sync();
    await handle!.close();
    handle = undefined;
    signal.throwIfAborted();
    const inspected = await inspectUpdateArchive(
      destination,
      current.platform,
      expected.unpackedBytes,
      signal,
    );
    return { path: destination, ...inspected };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    const diskFull =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['ENOSPC', 'EDQUOT'].includes(String(error.code));
    preserve ||=
      signal.aborted || (error instanceof UpdateNetworkError && error.recoverable) || !!diskFull;
    if (owned) {
      const size =
        (
          await lstat(destination).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
          })
        )?.size ?? 0;
      if (!options.resume || !preserve || !size || size > expected.bytes)
        await rm(destination, { force: true });
      else if (!signal.aborted && !diskFull && error instanceof UpdateNetworkError)
        throw new UpdateNetworkError(t('error.download.partialSaved'), error.retryAt);
    }
    throw error;
  } finally {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}
