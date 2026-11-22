import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { t } from '../../shared/i18n/index.ts';
import { windowsFileName } from '../../shared/windowsNames.ts';
import { skillArchiveLimits } from './skillArchive.ts';
import { consumeSkillBody, skillResponse } from './skillTransfer.ts';

interface GitEntry {
  path: string;
  type: string;
  mode: string;
  sha: string;
  size?: number;
}
const gitHash = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const pathKey = (path: string) => path.normalize('NFC').toLowerCase();
const isDirectory = (entry: GitEntry) => entry.type === 'tree' && entry.mode === '040000';
const isFile = (entry: GitEntry) =>
  entry.type === 'blob' && ['100644', '100755'].includes(entry.mode);
const isPortablePath = (path: unknown): path is string =>
  typeof path === 'string' &&
  path.length <= 1000 &&
  path.split('/').every((part) => part !== '.' && part !== '..' && windowsFileName(part));

async function readTree(
  base: string,
  sha: string,
  signal: AbortSignal,
  request: typeof fetch,
  recursive = false,
): Promise<GitEntry[]> {
  if (!gitHash.test(sha)) throw Error(t('error.remoteSkill.githubTree'));
  const url = new URL(`${base}/git/trees/${sha}`);
  if (recursive) url.searchParams.set('recursive', '1');
  const response = await skillResponse(url, signal, request, 'application/vnd.github+json');
  const chunks: Buffer[] = [];
  // GitHub caps a recursive tree response at 7 MB. Leave room for JSON framing.
  await consumeSkillBody(
    response,
    8 * 1024 ** 2,
    signal,
    async (chunk) => {
      chunks.push(Buffer.from(chunk));
    },
    t('error.remoteSkill.githubNarrowPath'),
  );
  let result: { tree?: GitEntry[]; truncated?: boolean } | null;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Error(t('error.remoteSkill.githubTree'));
  }
  const { tree, truncated } = result ?? {};
  if (truncated === true) throw Error(t('error.remoteSkill.githubNarrowPath'));
  if (truncated !== false || !Array.isArray(tree) || tree.some((entry) => !entry))
    throw Error(t('error.remoteSkill.githubTree'));
  return tree;
}

/** Select a skill from Git metadata, then download the pinned files from only that folder. */
export async function downloadGithubSkill(
  github: { api: string; raw: string; commit: string; path?: string; exact: boolean },
  destination: string,
  signal: AbortSignal,
  request: typeof fetch,
) {
  const selected = github.path ? github.path.split('/') : [];
  let sha = github.commit;
  for (const part of selected) {
    const entries = await readTree(github.api, sha, signal, request);
    const child = entries.find((entry) => entry.path === part);
    if (!child || !isDirectory(child)) throw Error(t('error.remoteSkill.noSkill'));
    sha = child.sha;
  }
  let entries = await readTree(github.api, sha, signal, request, true);
  if (!github.exact && (!github.path || !entries.some((entry) => entry.path === 'SKILL.md'))) {
    const candidates = entries
      .filter(
        (entry) =>
          isFile(entry) &&
          isPortablePath(entry.path) &&
          (entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md')),
      )
      .map((entry) => entry.path.replace(/(?:^|\/)SKILL\.md$/, ''));
    if (candidates.length > 100) throw Error(t('error.remoteSkill.githubNarrowPath'));
    if (candidates.length > 1)
      return {
        selectionRequired: true as const,
        skills: candidates.map((path) => ({
          path: path ? [...selected, path].join('/') : selected.join('/'),
        })),
      };
    if (!candidates.length) throw Error(t('error.remoteSkill.noSkill'));
    if (candidates[0]) {
      const prefix = candidates[0] + '/';
      selected.push(...candidates[0].split('/'));
      entries = entries
        .filter((entry) => typeof entry.path === 'string' && entry.path.startsWith(prefix))
        .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length) }));
    }
  }
  if (entries.length > skillArchiveLimits.files) throw Error(t('error.remoteSkill.githubSize'));
  const paths = new Map<string, GitEntry>();
  const files: (GitEntry & { size: number })[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const { path, sha, size } = entry;
    if (
      !isPortablePath(path) ||
      typeof sha !== 'string' ||
      !gitHash.test(sha) ||
      paths.has(pathKey(path))
    )
      throw Error(t('error.remoteSkill.githubTree'));
    paths.set(pathKey(path), entry);
    if (isDirectory(entry)) continue;
    if (!isFile(entry) || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)
      throw Error(t('error.remoteSkill.githubTree'));
    bytes += size;
    if (size > skillArchiveLimits.fileBytes || bytes > skillArchiveLimits.bytes)
      throw Error(t('error.remoteSkill.githubSize'));
    files.push({ ...entry, size });
  }
  if (!files.some((file) => file.path === 'SKILL.md')) throw Error(t('error.remoteSkill.noSkill'));
  for (const entry of entries) {
    const separator = entry.path.lastIndexOf('/');
    if (separator < 0) continue;
    const parent = entry.path.slice(0, separator);
    const directory = paths.get(pathKey(parent));
    if (directory?.path !== parent || !isDirectory(directory))
      throw Error(t('error.remoteSkill.githubTree'));
  }
  await mkdir(destination, { mode: 0o700 });
  for (const file of files) {
    signal.throwIfAborted();
    const parts = file.path.split('/');
    const path = join(destination, ...parts);
    const url = new URL(
      `${github.raw}/${[...selected, ...parts].map(encodeURIComponent).join('/')}`,
    );
    const hash = createHash(file.sha.length === 40 ? 'sha1' : 'sha256');
    hash.update(`blob ${file.size}\0`);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const handle = await open(path, 'wx', file.mode === '100755' ? 0o755 : 0o644);
    try {
      if (file.size) {
        const response = await skillResponse(url, signal, request, 'application/octet-stream');
        await consumeSkillBody(
          response,
          file.size,
          signal,
          async (chunk) => {
            hash.update(chunk);
            await handle.writeFile(chunk);
          },
          t('error.remoteSkill.githubHash'),
        );
      }
      if (hash.digest('hex') !== file.sha.toLowerCase())
        throw Error(t('error.remoteSkill.githubHash'));
    } finally {
      await handle.close();
    }
  }
}
