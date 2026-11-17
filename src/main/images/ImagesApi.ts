import { t } from '../../shared/i18n/index.ts';
import { validatePngBytes } from '../storage/png.ts';
import type { ImageReference } from './imageReferences.ts';

import { ImagesApiError, imagesApiFailure } from './imageApiError.ts';
import { readTransferChunk, transferTimeouts } from '../network/transfer.ts';
export { ImagesApiError } from './imageApiError.ts';

async function readBody(response: Response, limit: number, signal?: AbortSignal) {
  if (!response.body) throw new Error(t('error.imagesApi.emptyImagesApiResponse'));
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await readTransferChunk(reader, signal);
      if (item.done) break;
      length += item.value.length;
      if (length > limit) throw new Error(t('error.imagesApi.theImagesApiResponseExceeds'));
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function apiError(response: Response, catalog = false): Promise<never> {
  const body = await readBody(response, 16384).catch(() => null);
  throw imagesApiFailure(response.status, body, catalog);
}

export interface ImageParameters {
  prompt: string;
  size: 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
  quality: 'auto' | 'low' | 'medium' | 'high';
  background: 'auto' | 'opaque' | 'transparent';
}
export function imageParameters(value: Record<string, unknown>): ImageParameters {
  if (
    Object.keys(value).some(
      (key) =>
        !['prompt', 'size', 'quality', 'background', 'retryOperationId', 'references'].includes(
          key,
        ),
    )
  )
    throw new Error(t('error.imagesApi.theToolDoesNotAccept'));
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 32000)
    throw new Error(t('error.imagesApi.provideANonemptyImageDescription'));
  const result = {
    prompt: value.prompt.trim(),
    size: value.size ?? 'auto',
    quality: value.quality ?? 'auto',
    background: value.background ?? 'auto',
  };
  if (
    !['auto', '1024x1024', '1536x1024', '1024x1536'].includes(String(result.size)) ||
    !['auto', 'low', 'medium', 'high'].includes(String(result.quality)) ||
    !['auto', 'opaque', 'transparent'].includes(String(result.background))
  )
    throw new Error(t('error.imagesApi.unsupportedImageParameters'));
  return result as ImageParameters;
}
export class ImagesApi {
  private request: typeof fetch;
  constructor(request: typeof fetch = fetch) {
    this.request = request;
  }
  async models(key: string) {
    let response: Response;
    try {
      response = await this.request('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new Error(t('error.imagesApi.couldNotCheckTheImages'));
    }
    if (!response.ok) return apiError(response, true);
    let body: Record<string, unknown>;
    try {
      body = await readBody(response, 2 * 1024 ** 2);
    } catch {
      throw new Error(t('error.imagesApi.theImagesApiReturnedAn'));
    }
    if (!Array.isArray(body.data)) throw new Error(t('error.imagesApi.theImagesApiReturnedAn2'));
    return [
      ...new Set(
        body.data
          .map((model) => model?.id)
          .filter(
            (id): id is string =>
              typeof id === 'string' && /^gpt-image-[a-zA-Z0-9._-]{1,120}$/.test(id),
          ),
      ),
    ].sort();
  }
  async generate(
    key: string,
    model: string,
    parameters: ImageParameters,
    signal: AbortSignal,
    references: readonly ImageReference[] = [],
  ) {
    if (!/^gpt-image-[a-zA-Z0-9._-]{1,120}$/.test(model))
      throw new Error(t('error.imageGeneration.selectAGptImageModel'));
    let response: Response;
    const payload = { ...parameters, model, n: 1, output_format: 'png' };
    const multipart = references.length ? new FormData() : undefined;
    if (multipart) {
      for (const [name, value] of Object.entries(payload)) multipart.append(name, String(value));
      references.forEach((image, index) =>
        multipart.append(
          'image[]',
          new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }),
          `reference-${index + 1}.${image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1]}`,
        ),
      );
    }
    // Paid generation may take several minutes. Keep one bounded operation and no automatic retry.
    const operationSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(transferTimeouts.imageGeneration),
    ]);
    try {
      response = await this.request(
        `https://api.openai.com/v1/images/${multipart ? 'edits' : 'generations'}`,
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            Authorization: `Bearer ${key}`,
            ...(!multipart ? { 'Content-Type': 'application/json' } : {}),
          },
          body: multipart ?? JSON.stringify(payload),
          signal: operationSignal,
        },
      );
    } catch {
      if (signal.aborted)
        throw new ImagesApiError('cancelled', t('error.imagesApi.theImagesApiRequestWas'));
      throw new ImagesApiError('uncertain', t('error.imagesApi.couldNotRetrieveTheImages'));
    }
    if (!response.ok) return apiError(response);
    try {
      const body = await readBody(response, 48 * 1024 ** 2, operationSignal);
      const data = body.data;
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        typeof data[0]?.b64_json !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(data[0].b64_json)
      )
        throw new Error(t('error.imagesApi.invalidImageResponse'));
      const bytes = Buffer.from(data[0].b64_json, 'base64');
      if (
        bytes.length > 32 * 1024 ** 2 ||
        bytes.length < 8 ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error(t('error.imagesApi.theImagesApiDidNot'));
      validatePngBytes(bytes);
      const usage: Record<string, number> = {};
      if (body.usage && typeof body.usage === 'object')
        for (const name of ['input_tokens', 'output_tokens', 'total_tokens'] as const) {
          const value = (body.usage as Record<string, unknown>)[name];
          if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
            usage[name] = value;
        }
      return { bytes, ...(Object.keys(usage).length ? { usage } : {}) };
    } catch {
      if (signal.aborted)
        throw new ImagesApiError('cancelled', t('error.imagesApi.imageRetrievalCancelledTheApi'));
      throw new ImagesApiError('uncertain', t('error.imagesApi.theImagesApiRespondedBut'));
    }
  }
}
