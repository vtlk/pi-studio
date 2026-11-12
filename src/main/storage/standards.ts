import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  libraryStandards,
  type LibraryStandard,
  type StandardFile,
} from '../../shared/libraryStandards.ts';
import { atomicJson, atomicText, isMissing, readJson, readText, safePath } from './files.ts';
import { record } from './validation.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const packageRelative = '.pistudio/packages/pi-studio-library';
export function standardPath(skill: LibraryStandard, file: StandardFile) {
  if (
    !Object.hasOwn(libraryStandards, skill) ||
    !['SKILL.md', 'references/standard.md'].includes(file)
  )
    throw new Error('Неизвестный стандарт библиотеки.');
  return `${packageRelative}/skills/${skill}/${file}`;
}
/** Store only the latest bundled hashes. Never archive skill/reference instruction text. */
export async function installStandards(root: string, bundled: string) {
  const registryPath = await safePath(root, '.pistudio/package-hashes.json', true);
  let previous: Record<string, unknown> = {};
  try {
    previous = record(await readJson(registryPath));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const current: Record<string, string> = {};
  for (const skill of Object.keys(libraryStandards) as LibraryStandard[]) {
    for (const file of ['SKILL.md', 'references/standard.md'] as const) {
      const relative = standardPath(skill, file);
      const target = await safePath(root, relative, true);
      const shipped = await readFile(join(bundled, 'skills', skill, file), 'utf8');
      let content: string | undefined;
      try {
        content = await readFile(target, 'utf8');
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      if (content === undefined || hash(content) === previous[relative]) {
        await mkdir(await safePath(root, relative.split('/').slice(0, -1).join('/'), true), {
          recursive: true,
        });
        await atomicText(target, shipped);
      }
      current[relative] = hash(shipped);
    }
  }
  await atomicJson(
    await safePath(root, `${packageRelative}/package.json`, true),
    JSON.parse(await readFile(join(bundled, 'package.json'), 'utf8')),
  );
  await atomicJson(registryPath, current);
}
export async function readStandard(root: string, skill: LibraryStandard, file: StandardFile) {
  const source = await safePath(root, standardPath(skill, file));
  return { content: await readText(source), source };
}
export async function writeStandard(
  root: string,
  skill: LibraryStandard,
  file: StandardFile,
  content: string,
) {
  if (typeof content !== 'string' || content.length > 500_000 || !content.trim())
    throw new Error('Стандарт не может быть пустым или длиннее 500000 символов.');
  const source = await safePath(root, standardPath(skill, file));
  // File replacement is atomic, like studio/project documents; no backup text or revision log.
  await atomicText(source, content);
  return { content, source };
}
