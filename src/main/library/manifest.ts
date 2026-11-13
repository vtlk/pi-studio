import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import { validatePngBytes } from '../storage/png.ts';
import type { LibraryKind, LibraryManifest } from '../../shared/library.ts';
import { readJson, readText, safePath } from '../storage/files.ts';
import { record, stableId } from '../storage/validation.ts';
import { validateStaticSvg } from '../video/readVideoProject.ts';
import { parseCharacterSvg } from '../../shared/characterSvg.ts';
import { parseCharacterRig } from '../../shared/parseCharacterRig.ts';

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
  if (data.rig !== undefined) throw new Error('Ссылка на rig.json задаётся в files.rig.');
  if (files.rig !== undefined && (data.kind !== 'characters' || files.vector === undefined))
    throw new Error('Анимационный риг поддерживается только для персонажа с SVG.');
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
      ...(files.rig === undefined ? {} : { rig: path(files.rig, '.json') }),
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
    validatePngBytes(await file.readFile());
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
  let character;
  if (manifest.files.rig && manifest.files.vector) {
    const { svg, parts } = parseCharacterSvg(
      await readText(await safePath(root, manifest.files.vector)),
    );
    const rigPath = await safePath(root, manifest.files.rig);
    const text = await readText(rigPath);
    character = { svg, rig: parseCharacterRig(JSON.parse(text), parts) };
  }
  const after = await Promise.all(paths.map((path) => signature(root, path)));
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Материал изменился во время проверки. Повторите действие.');
  return {
    manifest,
    files: paths.map((path, index) => ({ path, signature: after[index] })),
    character,
  };
}
