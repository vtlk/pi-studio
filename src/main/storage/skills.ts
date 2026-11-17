import { t } from '../../shared/i18n/index.ts';
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { readText } from './files.ts';
import { record } from './validation.ts';
import type { StudioStore } from './StudioStore.ts';
import type { Resource, SkillDocument } from '../../shared/resources.ts';

export function parseSkill(content: string) {
  const normalized = content.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match || match[1].length > 20_000) throw new Error(t('error.skills.skillMdMustStartWith'));
  const document = parseDocument(match[1], { uniqueKeys: true, logLevel: 'silent' });
  if (document.errors.length || document.warnings.length)
    throw new Error(t('error.skills.invalidSkillMdYamlFront'));
  const metadata = record(document.toJS({ maxAliasCount: 50 }));
  if (
    typeof metadata.name !== 'string' ||
    metadata.name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name)
  )
    throw new Error(t('error.skills.skillNameUpToLowercase'));
  if (
    typeof metadata.description !== 'string' ||
    !metadata.description.trim() ||
    metadata.description.length > 1024
  )
    throw new Error(t('error.skills.aSkillDescriptionIsRequired'));
  return { name: metadata.name, description: metadata.description.trim(), content };
}
export async function inspectSkill(source: string): Promise<SkillDocument> {
  if (typeof source !== 'string' || !isAbsolute(source) || source.includes('\0'))
    throw new Error(t('error.skills.aFullPathToThe'));
  const selected = await realpath(source);
  const file = (await lstat(selected)).isDirectory() ? join(selected, 'SKILL.md') : selected;
  if (basename(file) !== 'SKILL.md') throw new Error(t('error.skills.selectSkillMdOrA'));
  const canonicalFile = await realpath(file);
  if (basename(canonicalFile) !== 'SKILL.md') throw new Error(t('error.skills.theLinkMustPointTo'));
  return { ...parseSkill(await readText(canonicalFile)), source: dirname(canonicalFile) };
}
export async function importSkill(source: string, existing: Resource[]): Promise<Resource> {
  const skill = await inspectSkill(source);
  const previous = existing.find(
    (resource) => resource.kind === 'skills' && resource.source === skill.source,
  );
  if (
    existing.some(
      (resource) =>
        resource.kind === 'skills' && resource.name === skill.name && resource.id !== previous?.id,
    )
  )
    throw new Error(t('error.skills.aSkillWithThisName'));
  return {
    id:
      previous?.id ??
      `skill-${createHash('sha256').update(skill.source).digest('hex').slice(0, 24)}`,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    kind: 'skills',
    localSkill: true,
    ...(previous?.managedSkill ? { managedSkill: true } : {}),
    version: 'Текущий локальный файл',
    transport: '',
    args: '',
    credential: '',
    contents: '',
    createdAt: previous?.createdAt ?? Date.now(),
  };
}
export async function importLocalSkill(store: StudioStore, args: Record<string, unknown>) {
  if (typeof args.path !== 'string') throw Error(t('error.setupAdministration.aFullSkillPathIs'));
  const resources = store.bootstrap().sections.resources as Resource[];
  const resource = await importSkill(args.path, resources);
  await store.saveSection('resources', [
    resource,
    ...resources.filter((item) => item.id !== resource.id),
  ]);
  return { resource, loadedInAgentSession: false };
}
