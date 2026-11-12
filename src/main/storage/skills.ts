import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { readText } from './files.ts';
import { record } from './validation.ts';
import { libraryStandards } from '../../shared/libraryStandards.ts';
import type { Resource, SkillDocument } from '../../shared/resources.ts';

export function parseSkill(content: string) {
  const normalized = content.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match || match[1].length > 20_000)
    throw new Error('SKILL.md должен начинаться с YAML-заголовка name/description (до 20 КБ).');
  const document = parseDocument(match[1], { uniqueKeys: true, logLevel: 'silent' });
  if (document.errors.length || document.warnings.length)
    throw new Error('Некорректный YAML-заголовок SKILL.md.');
  const metadata = record(document.toJS({ maxAliasCount: 50 }));
  if (
    typeof metadata.name !== 'string' ||
    metadata.name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name)
  )
    throw new Error('Имя skill: до 64 строчных латинских букв, цифр и одиночных дефисов.');
  if (
    typeof metadata.description !== 'string' ||
    !metadata.description.trim() ||
    metadata.description.length > 1024
  )
    throw new Error('description навыка обязателен и не должен быть длиннее 1024 символов.');
  return { name: metadata.name, description: metadata.description.trim(), content };
}
export async function inspectSkill(source: string): Promise<SkillDocument> {
  if (typeof source !== 'string' || !isAbsolute(source) || source.includes('\0'))
    throw new Error('Нужен полный путь к папке skill или SKILL.md.');
  const selected = await realpath(source);
  const file = (await lstat(selected)).isDirectory() ? join(selected, 'SKILL.md') : selected;
  if (basename(file) !== 'SKILL.md')
    throw new Error('Выберите SKILL.md или папку, содержащую этот файл.');
  const canonicalFile = await realpath(file);
  if (basename(canonicalFile) !== 'SKILL.md')
    throw new Error('Ссылка должна указывать на файл с именем SKILL.md.');
  return { ...parseSkill(await readText(canonicalFile)), source: dirname(canonicalFile) };
}
export async function importSkill(source: string, existing: Resource[]): Promise<Resource> {
  const skill = await inspectSkill(source);
  if (Object.hasOwn(libraryStandards, skill.name))
    throw new Error('Этот стандарт уже поставляется со Studio. Откройте его в каталоге Skills.');
  const previous = existing.find(
    (resource) => resource.kind === 'skills' && resource.source === skill.source,
  );
  if (
    existing.some(
      (resource) =>
        resource.kind === 'skills' && resource.name === skill.name && resource.id !== previous?.id,
    )
  )
    throw new Error(
      'Skill с таким именем уже есть в каталоге. Pi не может однозначно выбрать два навыка с одинаковым именем.',
    );
  return {
    id:
      previous?.id ??
      `skill-${createHash('sha256').update(skill.source).digest('hex').slice(0, 24)}`,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    kind: 'skills',
    localSkill: true,
    version: 'Текущий локальный файл',
    transport: '',
    args: '',
    credential: '',
    contents: '',
    createdAt: previous?.createdAt ?? Date.now(),
  };
}
