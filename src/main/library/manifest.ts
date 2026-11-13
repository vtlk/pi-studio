import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import type { LibraryKind, LibraryManifest } from '../../shared/library.ts';
import { readJson, readText, safePath } from '../storage/files.ts';
import { record, stableId } from '../storage/validation.ts';
import { validateStaticSvg } from '../video/readVideoProject.ts';

export function libraryKind(value: unknown): LibraryKind {
  if (value !== 'characters' && value !== 'locations')
    throw new Error('Неизвестный раздел библиотеки.');
  return value;
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max)
    throw new Error('Некорректное поле материала библиотеки.');
  return value;
}
function path(value: unknown, extension: string) {
  const name = text(value, 500);
  if (extname(name).toLowerCase() !== extension) throw new Error(`Нужен файл ${extension}.`);
  return name;
}
export function parseLibraryManifest(value: unknown): LibraryManifest {
  const data = record(value),
    files = record(data.files);
  if (data.schemaVersion !== 1) throw new Error('Неподдерживаемый формат asset.json.');
  if (!Number.isSafeInteger(data.version) || (data.version as number) < 1)
    throw new Error('Версия материала должна быть положительным целым числом.');
  if (typeof data.createdAt !== 'number' || !Number.isFinite(data.createdAt) || data.createdAt < 0)
    throw new Error('Некорректная дата материала.');
  const title = text(data.title, 500).trim();
  if (!title) throw new Error('Нужно название материала.');
  if (files.rig !== undefined || data.rig !== undefined)
    throw new Error(
      'Динамические rig.json ещё не поддерживаются. Публикуйте эталон/статичный SVG; не выдавайте его за готовый анимационный риг.',
    );
  return {
    schemaVersion: 1,
    id: stableId(data.id),
    kind: libraryKind(data.kind),
    version: data.version as number,
    title,
    description: text(data.description ?? '', 20000),
    category: text(data.category ?? '', 200),
    createdAt: data.createdAt,
    files: {
      reference: path(files.reference, '.png'),
      preview: path(files.preview, '.png'),
      ...(files.vector === undefined ? {} : { vector: path(files.vector, '.svg') }),
    },
  };
}
export async function signature(root: string, relative: string) {
  const file = await open(
    await safePath(root, relative),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || !info.size || info.size > 32 * 1024 ** 2)
      throw new Error('Файл материала пуст или превышает 32 МБ.');
    return `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  } finally {
    await file.close();
  }
}
async function png(root: string, relative: string) {
  const file = await open(
    await safePath(root, relative),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const bytes = await file.readFile();
    if (
      bytes.length < 57 ||
      bytes.length > 32 * 1024 ** 2 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new Error('Некорректный PNG материала.');
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (!width || !height || width > 16384 || height > 16384)
      throw new Error('Размер PNG вне поддерживаемого диапазона.');
    const compressed: Buffer[] = [];
    let offset = 8,
      ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset),
        end = offset + 12 + length;
      if (end > bytes.length) throw new Error('PNG обрезан.');
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
        throw new Error('Контрольная сумма PNG не совпадает.');
      if (offset === 8 && (type !== 'IHDR' || length !== 13))
        throw new Error('Некорректный заголовок PNG.');
      if (type === 'acTL') throw new Error('Для эталона и превью нужен статичный PNG, не APNG.');
      if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
      if (type === 'IEND') {
        if (length !== 0 || end !== bytes.length) throw new Error('Некорректное завершение PNG.');
        ended = true;
        break;
      }
      offset = end;
    }
    if (!ended || !compressed.length) throw new Error('PNG не содержит полного изображения.');
    try {
      inflateSync(Buffer.concat(compressed), { maxOutputLength: 128 * 1024 ** 2 });
    } catch {
      throw new Error('PNG повреждён или превышает 128 МБ в распакованном виде.');
    }
  } finally {
    await file.close();
  }
}
export async function validateLibraryDirectory(root: string) {
  const manifestBefore = await signature(root, 'asset.json');
  const manifest = parseLibraryManifest(await readJson(await safePath(root, 'asset.json')));
  const paths = ['asset.json', ...new Set(Object.values(manifest.files))];
  const before = await Promise.all(paths.map((path) => signature(root, path)));
  if (before[0] !== manifestBefore) throw new Error('asset.json изменился во время чтения.');
  await png(root, manifest.files.reference);
  await png(root, manifest.files.preview);
  if (manifest.files.vector)
    validateStaticSvg(await readText(await safePath(root, manifest.files.vector)));
  const after = await Promise.all(paths.map((path) => signature(root, path)));
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Материал изменился во время проверки. Повторите действие.');
  return { manifest, files: paths.map((path, index) => ({ path, signature: after[index] })) };
}
