import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ValidatedVideoProject, VideoAsset } from '../../shared/video.ts';
import { resolveOutputReference } from '../../shared/outputPaths.ts';
import { readText, safePath } from '../storage/files.ts';
import { parseVideoManifest, parseVideoTimeline } from './timeline.ts';

const extensions = {
  image: ['.svg', '.png', '.jpg', '.jpeg', '.webp'],
  video: ['.mp4', '.m4v', '.mov', '.webm'],
  audio: ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac'],
};

/** SVG is an inert image. Scripts, external dependencies and SMIL are outside this contract. */
export function validateStaticSvg(text: string) {
  if (
    !/<svg[\s>]/i.test(text) ||
    /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<\s*(script|foreignObject|animate\w*|set|audio|video|iframe|object|embed)\b|\son\w+\s*=|@import/i.test(
      text,
    )
  )
    throw new Error(
      'SVG содержит неподдерживаемые активные элементы. Используйте статичный SVG и ключевые кадры таймлайна.',
    );
  for (const match of text.matchAll(
    /(?:\b(?:xlink:)?href\s*=\s*["']([^"']*)["']|url\s*\(\s*["']?([^)'"\s]+))/gi,
  )) {
    if (!(match[1] ?? match[2]).startsWith('#'))
      throw new Error('SVG не должен ссылаться на внешние материалы.');
  }
  if (/javascript\s*:|&#|\\[0-9a-f]{1,6}/i.test(text))
    throw new Error('Закодированные активные ссылки в SVG не поддерживаются.');
}
async function fingerprint(path: string, type: VideoAsset['type']) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || !before.size || before.size > 2 * 1024 ** 3)
      throw new Error('Материал пуст, слишком велик или не является файлом.');
    const extension = extname(path).toLowerCase();
    if (!extensions[type].includes(extension))
      throw new Error(`Расширение материала не соответствует типу ${type}.`);
    if (extension === '.svg') validateStaticSvg(await readText(path));
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await file.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error('Материал изменился во время чтения. Откройте монтаж повторно.');
    return { size: after.size, sha256: hash.digest('hex') };
  } finally {
    await file.close();
  }
}
export async function readVideoProject(
  root: string,
  projectId: string,
  manifestPath: string,
): Promise<ValidatedVideoProject> {
  const match = /^agents\/([a-zA-Z0-9_-]+)\/output\/(.+\.pistudio\.json)$/.exec(manifestPath);
  if (!match) throw new Error('Выберите .pistudio.json внутри output агента.');
  const prefix = `agents/${match[1]}/output`;
  const outputRoot = await safePath(root, prefix);
  const manifestSource = await readText(await safePath(outputRoot, match[2]));
  const manifest = parseVideoManifest(JSON.parse(manifestSource));
  const parent = match[2].split('/').slice(0, -1);
  const state = resolveOutputReference(parent, manifest.state);
  if (!state) throw new Error('Путь таймлайна выходит за output агента.');
  const timelineSource = await readText(await safePath(outputRoot, state));
  const timeline = parseVideoTimeline(JSON.parse(timelineSource));
  const assets = [];
  for (const asset of timeline.assets) {
    const relative = resolveOutputReference(parent, asset.src);
    if (!relative) throw new Error(`Материал выходит за output агента: ${asset.id}`);
    try {
      const metadata = await fingerprint(await safePath(outputRoot, relative), asset.type);
      const projectPath = `${prefix}/${relative}`;
      assets.push({
        ...asset,
        ...metadata,
        projectPath,
        url: `studio-media://output/${encodeURIComponent(projectId)}/${projectPath.split('/').map(encodeURIComponent).join('/')}?v=${metadata.sha256}`,
      });
    } catch (error) {
      throw new Error(
        `Материал «${asset.id}»: ${error instanceof Error ? error.message : 'ошибка чтения'}`,
        { cause: error },
      );
    }
  }
  const revision = createHash('sha256')
    .update(manifestSource)
    .update('\0')
    .update(timelineSource)
    .update('\0')
    .update(
      JSON.stringify(assets.map(({ id, projectPath, sha256 }) => ({ id, projectPath, sha256 }))),
    )
    .digest('hex');
  return { manifest, timeline, manifestPath, revision, assets };
}
