import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { t } from '../../shared/i18n/index.ts';
import { requestTransfer, readTransferChunk } from '../network/transfer.ts';

export const skillDownloadLimit = 50 * 1024 ** 2;
export function skillUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 8000) throw Error(t('error.remoteSkill.url'));
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error(t('error.remoteSkill.url'));
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw Error(t('error.remoteSkill.url'));
  url.hash = '';
  return url;
}

/** No auth headers, cookies, shell or healthy-download lifetime; redirects must remain HTTPS. */
export async function skillResponse(
  url: URL,
  signal: AbortSignal,
  request = fetch,
  accept = 'application/zip',
) {
  for (let hop = 0; hop < 6; hop++) {
    const response = await requestTransfer(
      url,
      {
        signal,
        redirect: 'manual',
        credentials: 'omit',
        headers: { Accept: accept, 'User-Agent': 'Pi-Studio-Skill-Installer' },
      },
      request,
    );
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) break;
    url = skillUrl(new URL(location, url).href);
  }
  throw Error(t('error.remoteSkill.download'));
}

export async function consumeSkillBody(
  response: Response,
  limit: number,
  signal: AbortSignal,
  consume: (chunk: Uint8Array) => Promise<void>,
) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw Error(t('error.remoteSkill.download'));
  }
  const reader = response.body.getReader();
  let length = 0;
  try {
    if (Number(response.headers.get('content-length')) > limit)
      throw Error(t('error.remoteSkill.size'));
    while (true) {
      const chunk = await readTransferChunk(reader, signal);
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > limit) throw Error(t('error.remoteSkill.size'));
      await consume(chunk.value);
    }
    if (!length) throw Error(t('error.remoteSkill.download'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function downloadSkill(url: URL, file: string, signal: AbortSignal, request = fetch) {
  const handle = await open(file, 'wx', 0o600);
  const hash = createHash('sha256');
  try {
    await consumeSkillBody(
      await skillResponse(url, signal, request),
      skillDownloadLimit,
      signal,
      async (chunk) => {
        hash.update(chunk);
        await handle.writeFile(chunk);
      },
    );
    await handle.sync();
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}
