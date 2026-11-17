import { t } from '../../shared/i18n/index.ts';

export const transferTimeouts = {
  headers: 60_000,
  idle: 60_000,
  unpack: 5 * 60_000,
  packageInstall: 15 * 60_000,
  imageGeneration: 10 * 60_000,
} as const;

/** Only time the wait for headers. A healthy body has no overall download deadline. */
export async function requestTransfer(
  url: string | URL,
  options: RequestInit,
  request: typeof fetch = fetch,
  headerTimeoutMs: number = transferTimeouts.headers,
) {
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  const timer = setTimeout(
    () => controller.abort(new Error(t('error.transfer.headerTimeout'))),
    headerTimeoutMs,
  );
  try {
    return await Promise.race([
      request(url, { ...options, signal }).then((response) => {
        if (signal.aborted) {
          void response.body?.cancel().catch(() => {});
          signal.throwIfAborted();
        }
        return response;
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** Cancellation also works with a reader whose underlying transport ignores AbortSignal. */
export function readTransferChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
  idleTimeoutMs: number = transferTimeouts.idle,
) {
  signal?.throwIfAborted();
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
      void reader.cancel(error).catch(() => {});
    };
    const abort = () => fail(signal?.reason);
    const timer = setTimeout(() => fail(new Error(t('error.transfer.idleTimeout'))), idleTimeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const read = () => {
      reader.read().then((chunk) => {
        if (settled) return;
        // Empty chunks do not count as progress or extend the idle deadline.
        if (!chunk.done && !chunk.value.length) return read();
        settled = true;
        cleanup();
        resolve(chunk);
      }, fail);
    };
    read();
  });
}
