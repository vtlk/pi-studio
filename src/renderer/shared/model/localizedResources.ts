import { t, type MessageKey } from '../../../shared/i18n/index.ts';
import { builtinResource } from '../../../shared/builtinResources.ts';
import type { Resource } from '../../../shared/resources.ts';
const labels: Record<string, { name: MessageKey; description: MessageKey }> = {
  'pistudio-project': { name: 'builtin.project.name', description: 'builtin.project.description' },
  'pistudio-browser': { name: 'builtin.browser.name', description: 'builtin.browser.description' },
  'pistudio-computer': {
    name: 'builtin.computer.name',
    description: 'builtin.computer.description',
  },
  'pistudio-administration': {
    name: 'builtin.administration.name',
    description: 'builtin.administration.description',
  },
  'pistudio-team': { name: 'builtin.team.name', description: 'builtin.team.description' },
};
/** Built-in metadata is read-only and resolved by stable ID, including older saved labels. */
export function resourceLabel(resource: Resource, field: 'name' | 'description'): string;
export function resourceLabel(
  resource: Resource | undefined,
  field: 'name' | 'description',
): string | undefined;
export function resourceLabel(resource: Resource | undefined, field: 'name' | 'description') {
  if (!resource) return undefined;
  const canonical = builtinResource(resource.id);
  const key = labels[resource.id]?.[field];
  return canonical && key ? t(key) : resource[field];
}

export function resourceVersion(resource: Resource): string {
  return resource.version === 'Текущий локальный файл'
    ? t('resource.currentLocalFile')
    : resource.version;
}
