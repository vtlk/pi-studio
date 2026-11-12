import { readdir, lstat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { OutputEntry, OutputFile } from '../../shared/project.ts';
import { safePath, isMissing, readText } from './files.ts';

export function fileFormat(name: string): OutputFile['format'] {
  const extension = extname(name).toLowerCase();
  if (['.md', '.markdown'].includes(extension)) return 'markdown';
  if (extension === '.json') return 'json';
  if (
    [
      '.txt',
      '.csv',
      '.tsv',
      '.yaml',
      '.yml',
      '.srt',
      '.vtt',
      '.log',
      '.tsx',
      '.ts',
      '.js',
      '.css',
      '.html',
    ].includes(extension)
  )
    return 'text';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension)) return 'image';
  if (['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac'].includes(extension)) return 'audio';
  if (['.mp4', '.webm', '.mov', '.m4v'].includes(extension)) return 'video';
  return 'unsupported';
}
/** Metadata only: text and media load on selection, not while walking the tree. */
export async function scanOutputs(
  root: string,
  relative: string,
  budget = { remaining: 5000 },
  depth = 0,
): Promise<OutputEntry[]> {
  if (depth > 20) throw new Error('Папка результатов вложена глубже 20 уровней.');
  let directory: string;
  try {
    directory = await safePath(root, relative);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const entries: OutputEntry[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    if (--budget.remaining < 0) throw new Error('В результатах больше 5000 файлов/папок.');
    const diskPath = `${relative}/${entry.name}`;
    const path = await safePath(root, diskPath);
    const stat = await lstat(path);
    const base = { id: diskPath, name: entry.name, createdAt: stat.birthtimeMs || stat.mtimeMs };
    if (stat.isDirectory())
      entries.push({
        ...base,
        kind: 'folder',
        children: await scanOutputs(root, diskPath, budget, depth + 1),
      });
    else if (stat.isFile())
      entries.push({
        ...base,
        kind: 'file',
        format: fileFormat(entry.name),
        diskPath,
        modifiedAt: stat.mtimeMs,
        size: stat.size,
        fingerprint: `${stat.size}:${stat.mtimeMs}:${stat.ino}`,
      });
  }
  return entries.sort(
    (a, b) =>
      (a.createdAt ?? 0) - (b.createdAt ?? 0) ||
      a.name.localeCompare(b.name, 'ru', { numeric: true }),
  );
}
export async function loadOutput(root: string, relative: string): Promise<OutputFile> {
  if (!/^agents\/[a-zA-Z0-9_-]+\/output\/.+/.test(relative))
    throw new Error('Файл не находится в output агента.');
  const path = await safePath(root, relative);
  const stat = await lstat(path);
  if (!stat.isFile()) throw new Error('Выбранный путь не является файлом.');
  const name = relative.split('/').at(-1)!;
  const format = fileFormat(name);
  const file: OutputFile = {
    kind: 'file',
    id: relative,
    name,
    format,
    diskPath: relative,
    createdAt: stat.birthtimeMs || stat.mtimeMs,
    modifiedAt: stat.mtimeMs,
    size: stat.size,
    fingerprint: `${stat.size}:${stat.mtimeMs}:${stat.ino}`,
  };
  if (['text', 'json', 'markdown'].includes(format)) file.content = await readText(path);
  return file;
}
