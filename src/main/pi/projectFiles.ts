import { t } from '../../shared/i18n/index.ts';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { safePath, withReadDeadline } from '../storage/files.ts';

function projectPath(value: unknown, rootAllowed = false) {
  if (rootAllowed && (value === undefined || value === '' || value === '.')) return '';
  if (typeof value !== 'string' || !value || value.length > 2000)
    throw new Error(t('error.projectFiles.provideAPathRelativeTo'));
  return value;
}
function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(t('error.projectFiles.expectedAnIntegerFromTo', { value1: min, value2: max }));
  return value;
}
/** The session selects the root. Arguments cannot select another project or a global path. */
export function listProjectFiles(
  root: string,
  args: Record<string, unknown>,
  foldersFirst = false,
  allowed?: (path: string) => boolean,
  maxPage = 500,
) {
  return withReadDeadline(async () => {
    const relative = projectPath(args.path, true);
    const offset = integer(args.offset, 0, 0, 10000),
      limit = integer(args.limit, 100, 1, maxPage);
    const directory = relative ? await safePath(root, relative) : await realpath(root);
    if (!(await lstat(directory)).isDirectory())
      throw new Error(t('error.projectFiles.theSelectedPathIsNot'));
    const names = await readdir(directory, { withFileTypes: true });
    if (names.length > 10000) throw new Error(t('error.projectFiles.theFolderHasMoreThan'));
    const entries = [];
    for (const entry of names) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (allowed && !allowed(path)) continue;
      const metadata = await lstat(join(directory, entry.name));
      entries.push({
        path,
        name: entry.name,
        kind: metadata.isSymbolicLink()
          ? 'symlink'
          : metadata.isDirectory()
            ? 'directory'
            : metadata.isFile()
              ? 'file'
              : 'other',
        size: metadata.size,
        createdAt: metadata.birthtimeMs || metadata.mtimeMs,
        modifiedAt: metadata.mtimeMs,
        readable: !metadata.isSymbolicLink() && (metadata.isDirectory() || metadata.isFile()),
      });
    }
    entries.sort(
      (a, b) =>
        (foldersFirst ? Number(b.kind === 'directory') - Number(a.kind === 'directory') : 0) ||
        a.createdAt - b.createdAt ||
        a.name.localeCompare(b.name, 'ru', { numeric: true }),
    );
    return {
      path: relative || '.',
      entries: entries.slice(offset, offset + limit),
      total: entries.length,
      nextOffset: offset + limit < entries.length ? offset + limit : null,
    };
  });
}

/** Read a bounded byte window. No commands, writes, or unbounded binary/text payloads. */
export function readProjectFile(
  root: string,
  args: Record<string, unknown>,
  assertFile?: (info: { size: number; mtimeMs: number; ctimeMs: number }) => void,
) {
  return withReadDeadline(async () => {
    const relative = projectPath(args.path);
    const offset = integer(args.offset, 0, 0, Number.MAX_SAFE_INTEGER),
      maxBytes = integer(args.maxBytes, 65536, 4, 262144);
    const encoding = args.encoding ?? 'auto';
    if (!['auto', 'utf8', 'base64'].includes(String(encoding)))
      throw new Error(t('error.projectFiles.encodingAutoUtfOrBase'));
    const path = await safePath(root, relative);
    const checked = await lstat(path);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await file.stat();
      if (checked.dev !== before.dev || checked.ino !== before.ino || checked.isSymbolicLink())
        throw new Error(t('error.projectFiles.theFileWasReplacedBefore'));
      if (!before.isFile()) throw new Error(t('error.projectFiles.theSelectedPathIsNot2'));
      assertFile?.(before);
      if (offset > before.size) throw new Error(t('error.projectFiles.theOffsetExceedsTheFile'));
      const buffer = Buffer.alloc(Math.min(maxBytes, before.size - offset));
      let { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      let content: string | undefined;
      if (encoding !== 'base64' && !buffer.subarray(0, bytesRead).includes(0)) {
        // Do not cut a UTF-8 character in half at the end of a paged text window.
        for (let trim = 0; trim <= 3 && trim <= bytesRead; trim++) {
          if (trim && offset + bytesRead === before.size) break;
          try {
            content = new TextDecoder('utf-8', { fatal: true }).decode(
              buffer.subarray(0, bytesRead - trim),
            );
            bytesRead -= trim;
            break;
          } catch {
            /* Binary data or an incomplete final UTF-8 character. */
          }
        }
      }
      if (encoding === 'utf8' && content === undefined)
        throw new Error(t('error.projectFiles.thisSegmentIsNotUtf'));
      const after = await file.stat();
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new Error(t('error.projectFiles.theFileChangedWhileBeing'));
      if ((await safePath(root, relative)) !== path)
        throw new Error(t('error.projectFiles.thePathChanged'));
      const current = await lstat(path);
      if (current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink())
        throw new Error(t('error.projectFiles.theFileWasReplacedWhile'));
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify([before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs]),
        )
        .digest('hex');
      if (args.fingerprint !== undefined && args.fingerprint !== fingerprint)
        throw new Error(t('error.projectFiles.theFileChangedBetweenSegments'));
      const text = content !== undefined;
      return {
        path: relative,
        fingerprint,
        encoding: text ? 'utf8' : 'base64',
        content: content ?? buffer.subarray(0, bytesRead).toString('base64'),
        size: before.size,
        modifiedAt: before.mtimeMs,
        offset,
        bytesRead,
        nextOffset: offset + bytesRead < before.size ? offset + bytesRead : null,
      };
    } finally {
      await file.close();
    }
  });
}
