import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, readdir, link, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, dirname } from 'node:path';

export async function privatePath(root, relative, missing = false) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    isAbsolute(relative) ||
    /[\\\0]/.test(relative) ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Укажите относительный путь без символических ссылок.');
  let path = await realpath(root);
  for (const part of relative.split('/')) {
    path = join(path, part);
    try {
      if ((await lstat(path)).isSymbolicLink())
        throw new Error('Символические ссылки не поддерживаются.');
    } catch (error) {
      if (!(missing && error.code === 'ENOENT')) throw error;
    }
  }
  return path;
}

export async function regularFile(path, max = 64 * 1024 ** 2) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > max)
      throw new Error('Ожидается обычный файл размером до 64 МБ.');
    return { handle, stat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function listDownloads(root) {
  const files = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (!item.isFile() || files.length >= 100) continue;
    const stat = await lstat(join(root, item.name));
    files.push({ name: item.name, bytes: stat.size });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveDownload(downloads, name, outputRoot, relative) {
  if (name.includes('/')) throw new Error('Укажите имя скачанного файла.');
  const source = await privatePath(downloads, name),
    target = await privatePath(outputRoot, relative, true);
  const { handle, stat } = await regularFile(source);
  const temporary = join(dirname(target), `.browser-download-${randomUUID()}.tmp`);
  let destination;
  try {
    await mkdir(dirname(target), { recursive: true });
    destination = await open(temporary, 'wx', 0o600);
    const buffer = Buffer.alloc(64 * 1024);
    for (let offset = 0; offset < stat.size;) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, stat.size - offset),
        offset,
      );
      if (!bytesRead) throw new Error('Скачанный файл изменился во время копирования.');
      await destination.writeFile(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    )
      throw new Error('Скачанный файл изменился во время копирования.');
    await destination.sync();
    await link(temporary, target);
    return { output: relative, bytes: stat.size };
  } finally {
    await handle.close();
    await destination?.close();
    await rm(temporary, { force: true });
  }
}
