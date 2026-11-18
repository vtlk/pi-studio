import { codeLanguage } from '../../shared/codeLanguage.ts';
import { t } from '../../shared/i18n/index.ts';
import { isSharedTaskPath } from '../../shared/agentPaths.ts';
import { outputScope } from './outputScope.ts';
import { readdir, lstat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { OutputEntry, OutputFile } from '../../shared/project.ts';
import { safePath, isMissing, readText } from './files.ts';
import { compareOutputEntries } from '../../shared/outputOrder.ts';

// Agent-owned work files/directories may disappear between readdir, safePath and lstat.
// Only a vanished/replaced entry is skipped; permissions, symlinks and unsafe paths still fail.
const disappeared = (error: unknown) =>
  isMissing(error) || (error as NodeJS.ErrnoException).code === 'ENOTDIR';

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
      '.htm',
    ].includes(extension)
  )
    return 'text';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension)) return 'image';
  if (['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac'].includes(extension)) return 'audio';
  if (['.mp4', '.webm', '.mov', '.m4v'].includes(extension)) return 'video';
  if (codeLanguage(name)) return 'text';
  return 'unsupported';
}
/** Metadata only: text and media load on selection, not while walking the tree. */
export async function scanOutputs(
  root: string,
  relative: string,
  budget: { remaining: number; signal?: AbortSignal } = { remaining: 5000 },
  depth = 0,
): Promise<OutputEntry[]> {
  budget.signal?.throwIfAborted();
  if (depth > 20) throw new Error(t('error.outputs.theOutputFolderIsNested'));
  let directory: string;
  let children;
  try {
    directory = relative ? await safePath(root, relative) : root;
    children = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (disappeared(error)) return [];
    throw error;
  }
  const entries: OutputEntry[] = [];
  for (const entry of children) {
    budget.signal?.throwIfAborted();
    if (
      entry.name.startsWith('.') ||
      entry.isSymbolicLink() ||
      (entry.isDirectory() && entry.name === 'node_modules')
    )
      continue;
    if (--budget.remaining < 0) throw new Error(t('error.outputs.thereAreMoreThanOutput'));
    const diskPath = [relative, entry.name].filter(Boolean).join('/');
    if (!relative && !isSharedTaskPath(diskPath)) continue;
    let stat;
    try {
      const path = await safePath(root, diskPath);
      stat = await lstat(path);
    } catch (error) {
      if (disappeared(error)) continue;
      throw error;
    }
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
  return entries.sort(compareOutputEntries);
}
export async function loadOutput(root: string, relative: string): Promise<OutputFile> {
  try {
    await outputScope(root, relative);
    const path = await safePath(root, relative);
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error(t('error.outputs.theSelectedPathIsNot'));
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
  } catch (error) {
    if (isMissing(error)) throw new Error(t('error.outputs.theSelectedFileIsNo'), { cause: error });
    throw error;
  }
}
