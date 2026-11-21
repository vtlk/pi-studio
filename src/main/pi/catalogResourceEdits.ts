import { createHash } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';
import { builtinResource, reservedMcpName } from '../../shared/builtinResources.ts';
import { t } from '../../shared/i18n/index.ts';
import type { Resource } from '../../shared/resources.ts';
import type { StudioStore } from '../storage/StudioStore.ts';
import { atomicText, readText, safePath } from '../storage/files.ts';
import { inspectSkill, parseSkill } from '../storage/skills.ts';
import { boolean, stableId, text } from '../storage/validationFields.ts';
import { editNativeMcpOptions } from './nativeMcp.ts';
import { settingsOutput } from './settingsOutput.ts';

const revision = (content: string) => createHash('sha256').update(content).digest('hex');

function resourceRecord(store: StudioStore, value: unknown, kind: 'skills' | 'mcps') {
  const id = stableId(value);
  if (builtinResource(id)) throw Error(t('ProfileEdit.builtinResource'));
  const resources = store.bootstrap().sections.resources as Resource[];
  const resource = resources.find((item) => item.id === id && item.kind === kind);
  if (!resource) throw Error(t('error.setupAdministration.resourceMissingFromTheCatalog'));
  const save = (value: Resource) =>
    store.saveSection(
      'resources',
      resources.map((item) => (item.id === id ? value : item)),
    );
  return { resource, resources, save };
}

function ownedSkillPath(store: StudioStore, resource: Resource) {
  if (!resource.localSkill || !isAbsolute(resource.source)) return;
  const path = relative(store.folder, resource.source).split(sep).join('/');
  if (
    /^\.pistudio\/skills\/[a-zA-Z0-9_-]+$/.test(path) ||
    /^\.pistudio\/team-imports\/[a-zA-Z0-9_-]+\/resources\/[a-zA-Z0-9_-]+\/files$/.test(path) ||
    /^\.pistudio\/setup-assistant\/(?:agents\/[a-zA-Z0-9_-]+\/)?output(?:\/|$)/.test(path)
  )
    return `${path}/SKILL.md`;
}

export async function inspectCatalogSkill(store: StudioStore, resource: Resource) {
  const path = ownedSkillPath(store, resource);
  const skill = path
    ? parseSkill(await readText(await safePath(store.folder, path)))
    : await inspectSkill(resource.source);
  return { ...skill, editable: !!path };
}

export async function readSkill(store: StudioStore, args: Record<string, unknown>) {
  const { resource } = resourceRecord(store, args.resource_id, 'skills');
  const skill = await inspectCatalogSkill(store, resource);
  return settingsOutput(
    {
      resourceId: resource.id,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      revision: revision(skill.content),
      editable: skill.editable,
    },
    args,
    { tool: 'read_skill', target: { resource_id: resource.id } },
  );
}

export async function editSkill(store: StudioStore, args: Record<string, unknown>) {
  const { resource, resources, save } = resourceRecord(store, args.resource_id, 'skills');
  const path = ownedSkillPath(store, resource);
  if (!path) throw Error(t('ProfileEdit.linkedSkill'));
  const file = await safePath(store.folder, path);
  const old = await readText(file);
  if (args.revision !== revision(old)) throw Error(t('SettingsRead.changed'));
  const updated = parseSkill(text(args.content));
  if (updated.content.includes('\0')) throw Error(t('ProfileEdit.invalid'));
  if (
    resources.some(
      (item) => item.kind === 'skills' && item.id !== resource.id && item.name === updated.name,
    )
  )
    throw Error(t('error.managedSkills.aSkillWithThisName'));
  const { check: _stale, ...previous } = resource;
  await atomicText(file, updated.content);
  try {
    await save({ ...previous, name: updated.name, description: updated.description });
  } catch (error) {
    if ((await readText(file)) === updated.content) await atomicText(file, old);
    throw error;
  }
  return {
    resourceId: resource.id,
    revision: revision(updated.content),
    loadedInAgentSession: false,
  };
}

export async function editMcp(store: StudioStore, args: Record<string, unknown>) {
  const { resource, save } = resourceRecord(store, args.resource_id, 'mcps');
  const name = args.display_name === undefined ? undefined : text(args.display_name, 500).trim();
  const description = args.description === undefined ? undefined : text(args.description, 2000);
  const enabled = args.native_enabled === undefined ? undefined : boolean(args.native_enabled);
  const timeout = args.timeout_seconds;
  const exposure = args.exposure;
  if (
    (name === undefined &&
      description === undefined &&
      enabled === undefined &&
      timeout === undefined &&
      exposure === undefined) ||
    name === '' ||
    (timeout !== undefined &&
      (typeof timeout !== 'number' ||
        !Number.isSafeInteger(timeout) ||
        timeout < 1 ||
        timeout > 21600)) ||
    (exposure !== undefined &&
      exposure !== 'codemode' &&
      exposure !== 'deferred' &&
      exposure !== 'direct' &&
      exposure !== 'hidden')
  )
    throw Error(t('ProfileEdit.invalid'));
  const native = resource.source.startsWith('pi:') ? resource.source.slice(3) : undefined;
  const changesNative = enabled !== undefined || timeout !== undefined || exposure !== undefined;
  const updated = {
    ...resource,
    name: name ?? resource.name,
    description: description ?? resource.description,
  };
  if (changesNative) {
    if (!native || !/^[a-zA-Z0-9_-]+$/.test(native) || reservedMcpName(native))
      throw Error(t('ProfileEdit.nativeMcpRequired'));
    delete updated.check;
    await editNativeMcpOptions(native, { enabled, timeout, exposure }, () => save(updated));
  } else await save(updated);
  return { resourceId: resource.id, name: updated.name, loadedInAgentSession: false };
}
