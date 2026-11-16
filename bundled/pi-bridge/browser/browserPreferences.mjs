import { writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { regularFile } from './files.mjs';

export async function readPrivateJson(path, fallback, max = 16384) {
  try {
    const { handle } = await regularFile(path, max);
    try {
      return JSON.parse(await handle.readFile('utf8'));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}
export async function writePrivateJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export function proxyUrl(value) {
  if (value === undefined || value === '') return undefined;
  const parsed = new URL(value);
  if (
    !['http:', 'https:', 'socks5:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('Укажите HTTP/HTTPS/SOCKS5 proxy без пароля, пути и параметров.');
  return parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
}
export async function launchPreferences(browser, args) {
  const path = join(browser.root, 'launch.json');
  const saved = await readPrivateJson(path, { headed: false });
  if (!saved || typeof saved.headed !== 'boolean')
    throw new Error('Некорректные настройки браузерной сессии.');
  const next = {
    headed: args.headed ?? saved.headed,
    proxy: args.proxy === undefined ? proxyUrl(saved.proxy) : proxyUrl(args.proxy),
  };
  if (browser.started && (next.headed !== browser.headed || next.proxy !== browser.proxy))
    throw new Error(
      'Сначала browser_close: изменение режима или proxy требует закрытия только этого браузера. Состояние сохранится.',
    );
  browser.headed = next.headed;
  browser.proxy = next.proxy;
  return { path, value: next };
}

/** Extract upstream's structured result without exposing arbitrary evaluation as a tool. */
export function evaluated(reply) {
  const candidates = [reply.structuredContent?.response, reply.structuredContent];
  for (const item of reply.content ?? [])
    if (item.type === 'text') {
      try {
        candidates.push(JSON.parse(item.text));
      } catch {
        /* text-only upstream result */
      }
    }
  for (const item of candidates) {
    const data = item?.data?.result ?? item?.response?.data?.result ?? item?.result;
    if (data !== undefined) return data;
    if (item?.width && item?.height) return item;
  }
  throw new Error('Браузер не подтвердил геометрию страницы. Получите свежий снимок.');
}
