import { t } from '../../shared/i18n/index.ts';
import { createHash } from 'node:crypto';
import { open, rm, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { VerifiedUpdate } from './githubReleases.ts';
import {
  boundedBody,
  githubResponse,
  readUpdateChunk,
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
}) {
  const { update, signal, destination } = options;
  const free = options.freeSpace
    ? await options.freeSpace()
    : await statfs(dirname(destination)).then((fs) => fs.bavail * fs.bsize);
  // Archive + extracted program + transient replacement/recovery; never remove user data for space.
  if (
    free <
    update.manifest.archive.bytes + update.manifest.archive.unpackedBytes * 2 + 128 * 1024 ** 2
  )
    throw new Error(t('error.download.notEnoughFreeSpaceFor'));
  // Revalidate the signed metadata after the user's explicit choice, including asset revocation.
  const response = await githubResponse(update.manifestUrl, signal, options.fetch);
  const current = verifyManifest(
    await boundedBody(response, maxManifestBytes, signal),
    options.publicKey,
  );
  if (JSON.stringify(current) !== JSON.stringify(update.manifest))
    throw new Error(t('error.download.theReleaseChangedCheckFor'));
  const archive = await githubResponse(update.archiveUrl, signal, options.fetch);
  if (!archive.body) throw new Error(t('error.download.githubReturnedAnEmptyUpdate'));
  const expected = current.archive;
  const contentLength = archive.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) !== expected.bytes) {
    await archive.body.cancel();
    throw new Error(t('error.download.theDownloadSizeDoesNot'));
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let owned = false;
  const reader = archive.body.getReader();
  try {
    handle = await open(destination, 'wx', 0o600);
    owned = true;
    const hash = createHash('sha256');
    let received = 0;
    while (true) {
      signal.throwIfAborted();
      const chunk = await readUpdateChunk(reader, signal);
      if (chunk.done) break;
      received += chunk.value.length;
      if (received > expected.bytes)
        throw new Error(t('error.download.theDownloadExceedsTheSigned'));
      hash.update(chunk.value);
      await handle.writeFile(chunk.value);
      options.progress(received);
    }
    if (received !== expected.bytes || hash.digest('hex') !== expected.sha256)
      throw new Error(t('error.download.updateChecksumMismatchTheApp'));
    await handle.sync();
    await handle.close();
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
    if (owned) await rm(destination, { force: true });
    throw error;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
