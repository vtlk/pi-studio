import { t } from '../../shared/i18n/index.ts';
import { maxArchiveBytes } from './manifest.ts';

export const repository = 'vtlk/pi-studio';
export const releaseApi = `https://api.github.com/repos/${repository}/releases`;
const redirectHosts = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);
export class UpdateNetworkError extends Error {
  readonly retryAt?: number;
  constructor(message: string, retryAt?: number) {
    super(message);
    this.retryAt = retryAt;
  }
}
export type FetchUpdate = typeof fetch;
export function releaseAssetUrl(tag: string, name: string) {
  if (!/^v[0-9A-Za-z.-]+$/.test(tag) || !/^[0-9A-Za-z.-]+$/.test(name))
    throw new Error(t('error.githubTransport.invalidReleaseFilename'));
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}
function allowed(url: URL) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    return false;
  if (url.hostname === 'api.github.com') return url.pathname === `/repos/${repository}/releases`;
  if (!redirectHosts.has(url.hostname)) return false;
  return (
    url.hostname !== 'github.com' || url.pathname.startsWith(`/${repository}/releases/download/`)
  );
}
/** Anonymous transport only: no account/project data, PAT, cookies or credential headers. */
export async function githubResponse(
  address: string,
  signal: AbortSignal,
  request: FetchUpdate = fetch,
  now = Date.now(),
  headerTimeoutMs = 60_000,
) {
  let url = new URL(address);
  const deadline = new AbortController();
  const timeout = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout(
    () => deadline.abort(new UpdateNetworkError(t('error.githubTransport.headerTimeout'))),
    headerTimeoutMs,
  );
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      timeout.throwIfAborted();
      if (!allowed(url)) throw new Error(t('error.githubTransport.updateSourceNotAllowed'));
      const response = await request(url, {
        redirect: 'manual',
        signal: timeout,
        credentials: 'omit',
        headers: {
          Accept:
            url.hostname === 'api.github.com'
              ? 'application/vnd.github+json'
              : 'application/octet-stream',
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || redirects === 5)
          throw new Error(t('error.githubTransport.invalidUpdateRedirect'));
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const wait = response.headers.get('retry-after');
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        const retryAt = wait
          ? /^\d+$/.test(wait)
            ? now + Number(wait) * 1000
            : Date.parse(wait)
          : reset;
        throw new UpdateNetworkError(
          response.status === 404
            ? t('error.githubTransport.releasesUnavailableTheRepositoryMay')
            : [403, 429].includes(response.status)
              ? t('error.githubTransport.githubTemporarilyRateLimitedUpdate')
              : t('error.githubTransport.couldNotRetrieveTheUpdate', {
                  value1: response.status,
                }),
          Number.isFinite(retryAt) && retryAt > now
            ? Math.min(retryAt, now + 24 * 3600_000)
            : undefined,
        );
      }
      if (Number(response.headers.get('content-length')) > maxArchiveBytes) {
        await response.body?.cancel();
        throw new Error(t('error.githubTransport.theUpdateFileExceedsThe'));
      }
      return response;
    }
    throw new Error(t('error.githubTransport.tooManyUpdateRedirects'));
  } finally {
    // A response can keep streaming for minutes. Do not abort its healthy body after 60 seconds.
    clearTimeout(timer);
  }
}

/** Bound inactivity per read, while allowing a slow download to keep making progress. */
export function readUpdateChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
  idleTimeoutMs = 60_000,
) {
  signal?.throwIfAborted();
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
      void reader.cancel(error).catch(() => undefined);
    };
    const abort = () => fail(signal?.reason);
    const timer = setTimeout(
      () => fail(new UpdateNetworkError(t('error.githubTransport.downloadIdleTimeout'))),
      idleTimeoutMs,
    );
    signal?.addEventListener('abort', abort, { once: true });
    reader.read().then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
export async function boundedBody(response: Response, limit: number, signal?: AbortSignal) {
  if (!response.body) throw new Error(t('error.githubTransport.githubReturnedAnEmptyResponse'));
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await readUpdateChunk(reader, signal);
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) throw new Error(t('error.githubTransport.theUpdateResponseExceedsThe'));
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
