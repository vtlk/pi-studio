import { t } from '../../shared/i18n/index.ts';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Resource, SkillWriteRequest } from '../../shared/resources.ts';
import type { StudioStore } from './StudioStore.ts';
import { atomicText, readText, safePath } from './files.ts';
import { parseSkill } from './skills.ts';
import { stableId } from './validation.ts';

export async function saveManagedSkill(store: StudioStore, request: SkillWriteRequest) {
  if (!request || request.folder !== store.folder)
    throw new Error(t('registerTeamHandlers.studioFolderChanged'));
  if (
    typeof request.name !== 'string' ||
    typeof request.description !== 'string' ||
    typeof request.content !== 'string' ||
    request.content.length > 200_000 ||
    !request.content.trim()
  )
    throw new Error(t('error.managedSkills.enterASkillNameDescription'));
  const content = `---\nname: ${JSON.stringify(request.name.trim())}\ndescription: ${JSON.stringify(request.description.trim())}\n---\n\n${request.content.trim()}\n`;
  const parsed = parseSkill(content);
  const resources = store.bootstrap().sections.resources as Resource[];
  const previous = request.id ? resources.find((item) => item.id === request.id) : undefined;
  if (request.id && (!previous?.managedSkill || previous.kind !== 'skills'))
    throw new Error(t('error.managedSkills.thisSkillWasNotCreated'));
  if (
    resources.some(
      (item) => item.kind === 'skills' && item.name === parsed.name && item.id !== previous?.id,
    )
  )
    throw new Error(t('error.managedSkills.aSkillWithThisName'));
  const id = previous?.id ?? `skill-${randomUUID()}`;
  stableId(id);
  const source = await safePath(store.folder, `.pistudio/skills/${id}`, true);
  const file = await safePath(store.folder, `.pistudio/skills/${id}/SKILL.md`, true);
  if (
    previous &&
    (previous.source !== source || (await readText(file)) !== request.previousContent)
  )
    throw new Error(t('error.managedSkills.theSkillChangedSinceOpening'));
  const resource: Resource = {
    id,
    name: parsed.name,
    description: parsed.description,
    kind: 'skills',
    source,
    localSkill: true,
    managedSkill: true,
    version: 'Текущий локальный файл',
    transport: '',
    args: '',
    credential: '',
    contents: '',
    createdAt: previous?.createdAt ?? Date.now(),
  };
  await atomicText(join(source, 'SKILL.md'), content);
  await store.saveSection(
    'resources',
    [resource, ...resources.filter((item) => item.id !== id)].sort(
      (a, b) => b.createdAt - a.createdAt,
    ),
  );
  return resource;
}
