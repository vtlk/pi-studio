import { createHash, randomUUID } from 'node:crypto';
import type { ProjectAgentProfile } from '../../shared/project.ts';

// Immutable identities of retired configuration keys/resources; no feature/tool text is shipped.
const retiredSections = new Set([
  '8ee2aa9d0e9ab6386c27da4b8e5021004e0a79cef29cbe6d285544a653aacf42',
  '95aabf35181675229594fc7484c8069868ef40f489895fe578585e1dc6424e98',
]);
const retiredIds = new Set(['72c1c1cb542f477d7271ea48b3d1e446e36d07010bcb2ea752b5c30b1f4454a7']);
const retiredSources = new Set([
  'e60627da723fdb62ce95c1d5791705d4b2f8a21cdea8d461d6b914eb4c6ecdaf',
]);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function retiredBuiltin(id: unknown, source?: unknown) {
  return (
    (typeof id === 'string' && retiredIds.has(hash(id))) ||
    (typeof source === 'string' && retiredSources.has(hash(source)))
  );
}
function cleanProfile(value: unknown, additional: ReadonlySet<string>) {
  if (!object(value)) return value;
  let result = value;
  const retired = (id: unknown) =>
    typeof id === 'string' && (retiredBuiltin(id) || additional.has(id));
  if (Array.isArray(value.mcps)) {
    const mcps = value.mcps.filter((id) => !retired(id));
    if (mcps.length !== value.mcps.length) result = { ...result, mcps };
  }
  if (object(value.capabilitySettings)) {
    const entries = Object.entries(value.capabilitySettings);
    const current = entries.filter(([key]) => !(key.startsWith('mcps:') && retired(key.slice(5))));
    if (current.length !== entries.length)
      result = { ...result, capabilitySettings: Object.fromEntries(current) };
  }
  return result;
}
/** Runtime snapshots can still contain an obsolete pinned assignment; it grants no tools. */
export function withoutRetiredResources<T extends ProjectAgentProfile>(agent: T): T {
  return cleanProfile(agent, new Set()) as unknown as T;
}
/** Data-only compatibility. Caller validates the whole result before one atomic settings write. */
export function retireLegacyFeatures(value: unknown, createId = randomUUID) {
  if (!object(value) || value.schemaVersion !== 1 || !object(value.sections))
    return { document: value, changed: false };
  const previous = value.sections;
  const sections = { ...previous };
  let changed = false;
  for (const key of Object.keys(sections))
    if (retiredSections.has(hash(key))) {
      delete sections[key];
      changed = true;
    }
  const removed = new Set<string>();
  if (Array.isArray(sections.resources)) {
    const resources = sections.resources.filter((resource) => {
      const obsolete =
        object(resource) &&
        resource.kind === 'mcps' &&
        retiredBuiltin(resource.id, resource.source);
      if (obsolete && typeof resource.id === 'string') removed.add(resource.id);
      return !obsolete;
    });
    if (resources.length !== sections.resources.length) {
      sections.resources = resources;
      changed = true;
    }
  }
  for (const key of ['agents', 'systemAgents'])
    if (Array.isArray(sections[key])) {
      const profiles = sections[key].map((profile) => cleanProfile(profile, removed));
      if (profiles.some((profile, index) => profile !== (sections[key] as unknown[])[index])) {
        sections[key] = profiles;
        changed = true;
      }
    }
  if (Array.isArray(sections.systemAgents)) {
    const systems = sections.systemAgents;
    const former = systems.filter(
      (profile) =>
        object(profile) && ['character', 'location'].includes(String(profile.systemRole)),
    );
    if (former.length) {
      if (sections.agents !== undefined && !Array.isArray(sections.agents))
        throw Error('Некорректный каталог агентов. Данные не изменены.');
      const agents = [...((sections.agents ?? []) as unknown[])];
      const ids = new Set(agents.map((profile) => (object(profile) ? profile.id : undefined)));
      const moved: unknown[] = [];
      for (const item of former) {
        const { systemRole: _role, ...profile } = item as Record<string, unknown>;
        if (ids.has(profile.id))
          throw Error('ID перенесённого системного агента уже используется. Данные не изменены.');
        ids.add(profile.id);
        agents.push(profile);
        moved.push(profile.id);
      }
      sections.agents = agents;
      sections.systemAgents = systems.filter((profile) => !former.includes(profile));
      // Never guess between existing teams. Only actual former profiles justify this team.
      if (Array.isArray(sections.agentTeams) && sections.agentTeams.length > 1)
        sections.agentTeams = [
          ...sections.agentTeams,
          { id: createId(), name: 'Перенесённые агенты', agentIds: moved },
        ];
      changed = true;
    }
  }
  return { document: changed ? { ...value, sections } : value, changed };
}
