import { t } from '../../shared/i18n/index.ts';
import { windowsFileName } from '../../shared/windowsNames.ts';
import { skillUrl, skillResponse, consumeSkillBody } from './skillTransfer.ts';

/** The same portable relative names are used on macOS and Windows. */
export function skillPath(value: unknown, root = false): string {
  if (root && (value === undefined || value === '' || value === '.')) return '';
  if (
    typeof value !== 'string' ||
    value.length > 1000 ||
    value.split('/').some((part) => part === '.' || part === '..' || !windowsFileName(part))
  )
    throw Error(t('error.remoteSkill.path'));
  return value.replace(/(?:^|\/)SKILL\.md$/, '');
}

/** Resolve GitHub tree/blob refs, including slash-containing branches, to a fixed commit. */
export async function skillSource(
  args: Record<string, unknown>,
  signal: AbortSignal,
  request = fetch,
) {
  const url = skillUrl(args.url);
  const selected = args.skillPath === undefined ? undefined : skillPath(args.skillPath, true);
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    if (args.ref !== undefined) throw Error(t('error.remoteSkill.ref'));
    return { url, path: selected };
  }
  let parts: string[];
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    throw Error(t('error.remoteSkill.url'));
  }
  // GitHub's ordinary archive/release ZIP links already identify a concrete download endpoint.
  if (parts[2] === 'archive' || parts[2] === 'releases') {
    if (args.ref !== undefined) throw Error(t('error.remoteSkill.ref'));
    return { url, path: selected };
  }
  const [owner, rawRepo, kind, ...tail] = parts;
  const repo = rawRepo?.replace(/\.git$/, '');
  if (
    !owner ||
    !repo ||
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(repo) ||
    (kind && !['tree', 'blob'].includes(kind)) ||
    tail.length > 16 ||
    (kind && !tail.length)
  )
    throw Error(t('error.remoteSkill.url'));
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const explicit = args.ref;
  if (
    explicit !== undefined &&
    (typeof explicit !== 'string' ||
      !explicit ||
      explicit.length > 300 ||
      /[\p{Cc}]/u.test(explicit))
  )
    throw Error(t('error.remoteSkill.ref'));
  const refs = explicit
    ? [explicit as string]
    : kind
      ? tail.map((_, index) => tail.slice(0, tail.length - index).join('/'))
      : ['HEAD'];
  for (const ref of refs) {
    if (kind && !tail.join('/').startsWith(ref + '/') && tail.join('/') !== ref) continue;
    const response = await skillResponse(
      new URL(`${base}/commits/${encodeURIComponent(ref)}`),
      signal,
      request,
      'application/vnd.github.sha',
    );
    if (response.status === 404 || response.status === 422) {
      await response.body?.cancel();
      continue;
    }
    const chunks: Buffer[] = [];
    await consumeSkillBody(response, 1024, signal, async (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    const commit = Buffer.concat(chunks).toString('utf8').trim();
    if (!/^[a-f0-9]{40,64}$/i.test(commit)) throw Error(t('error.remoteSkill.ref'));
    const suffix = kind ? tail.join('/').slice(ref.length).replace(/^\//, '') : undefined;
    const fromUrl = suffix ? skillPath(suffix, true) : undefined;
    if (
      fromUrl !== undefined &&
      selected !== undefined &&
      fromUrl !== selected &&
      !(kind === 'tree' && selected.startsWith(fromUrl + '/'))
    )
      throw Error(t('error.remoteSkill.path'));
    return {
      url: new URL(`${base}/zipball/${commit}`),
      path: selected ?? fromUrl,
      commit,
      github: {
        api: base,
        raw: `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commit}`,
        kind,
      },
    };
  }
  throw Error(t('error.remoteSkill.ref'));
}
