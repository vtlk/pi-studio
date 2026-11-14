import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import type { LibraryStore } from './LibraryStore.ts';
import { characterSvgFrame } from '../../shared/characterSvgFrame.ts';
import { previewOptions, type PreviewRenderer } from './previewOptions.ts';
import { readText, safePath } from '../storage/files.ts';
import { validatePngBytes } from '../storage/png.ts';

export async function renderLibraryPreview(
  library: LibraryStore,
  outputRoot: string,
  args: Record<string, unknown>,
  render: PreviewRenderer,
) {
  if (typeof args.token !== 'string') throw new Error('Нужен идентификатор подготовки.');
  const frame = previewOptions(args);
  const source = await library.previewSource(outputRoot, args.token);
  if (args.character !== undefined && !source.character)
    throw new Error('Для параметров персонажа нужен совместимый SVG/rig.json.');
  if (args.camera !== undefined && source.manifest.kind !== 'locations')
    throw new Error('Камера поддерживается только для локаций.');
  const vector = source.manifest.files.vector;
  const svg = source.character
    ? characterSvgFrame(source.character, frame.character, frame.time)
    : vector
      ? await readText(await safePath(source.root, vector))
      : undefined;
  const bytes = svg
    ? Buffer.from(svg)
    : await readFile(await safePath(source.root, source.manifest.files.reference));
  const data = `data:image/${svg ? 'svg+xml' : 'png'};base64,${bytes.toString('base64')}`;
  const png = await render(data, { ...frame, transparent: source.manifest.kind === 'characters' });
  validatePngBytes(png);
  if (png.readUInt32BE(16) !== frame.width || png.readUInt32BE(20) !== frame.height)
    throw new Error('Рендер вернул неверный размер кадра.');
  const current = await library.previewSource(outputRoot, args.token);
  if (JSON.stringify(source.files) !== JSON.stringify(current.files))
    throw new Error('Исходники изменились во время рендера. Повторите контрольный кадр явно.');
  await mkdir(await safePath(outputRoot, 'previews', true), { recursive: true });
  const relative = `previews/library-${randomUUID()}.png`;
  const path = await safePath(outputRoot, relative, true);
  await writeFile(path, png, { flag: 'wx', mode: 0o600 });
  return {
    path,
    outputRelativePath: relative,
    width: frame.width,
    height: frame.height,
    sha256: createHash('sha256').update(png).digest('hex'),
    id: source.manifest.id,
    version: source.manifest.version,
    published: false,
    instruction:
      'Read this PNG with the native read tool to inspect it. Copy a chosen frame to the manifest preview path before validate/publish; this call changes no source, reference or publication.',
  };
}
