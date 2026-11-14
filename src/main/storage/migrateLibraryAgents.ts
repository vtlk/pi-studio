import type { StudioSections } from '../../shared/storage.ts';
import type { Agent } from '../../shared/studio.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import { libraryMcpId } from '../../shared/builtinResources.ts';

/** One atomic settings transition; existing job folders and canonical transcripts are untouched. */
export function migrateLibraryAgents(sections: StudioSections): StudioSections | undefined {
  const systems = sections.systemAgents as SystemAgent[] | undefined;
  const creators = systems?.filter((item) => item.systemRole !== 'assistant');
  if (!creators?.length) return;
  const agents = [...((sections.agents ?? []) as Agent[])];
  const assignments = {
    characters: '',
    locations: '',
    ...((sections.libraryAgents as object) ?? {}),
  };
  for (const { systemRole, ...profile } of creators) {
    if (agents.some((item) => item.id === profile.id))
      throw new Error('ID библиотечного агента уже занят. Настройки не изменены.');
    agents.push({
      ...profile,
      mcps: [...new Set([...profile.mcps, libraryMcpId])],
    });
    const kind = systemRole === 'character' ? 'characters' : 'locations';
    if (!assignments[kind]) assignments[kind] = profile.id;
  }
  return {
    ...sections,
    agents,
    systemAgents: systems!.filter((item) => item.systemRole === 'assistant'),
    libraryAgents: assignments,
  };
}
