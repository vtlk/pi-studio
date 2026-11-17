import { t } from '../../shared/i18n/index.ts';
import type { StudioSections } from '../../shared/storage.ts';
import type { Agent } from '../../shared/studio.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import type { Resource } from '../../shared/resources.ts';
import { parseSection, stableId } from './validation.ts';

export function skillTargetIds(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw Error(t('error.remoteSkill.agents'));
  const ids = value.map(stableId);
  if (new Set(ids).size !== ids.length) throw Error(t('error.remoteSkill.agents'));
  return ids;
}

export function assertSkillTargets(sections: StudioSections, ids: string[]) {
  const profiles = [...(sections.agents as Agent[]), ...(sections.systemAgents as SystemAgent[])];
  if (ids.some((id) => !profiles.some((agent) => agent.id === id)))
    throw Error(t('error.remoteSkill.agents'));
}

/** Resource and exact current constructor assignments share a single atomic settings write. */
export function assignedSkillSections(sections: StudioSections, resource: Resource, ids: string[]) {
  assertSkillTargets(sections, ids);
  const resources = sections.resources as Resource[];
  if (
    resources.some(
      (item) => item.id === resource.id || (item.kind === 'skills' && item.name === resource.name),
    )
  )
    throw Error(t('error.remoteSkill.collision'));
  const assign = <T extends Agent>(agent: T): T =>
    !ids.includes(agent.id)
      ? agent
      : {
          ...agent,
          skills: [...agent.skills, resource.id],
          capabilitySettings: {
            ...agent.capabilitySettings,
            [`skills:${resource.id}`]: { enabled: true },
          },
        };
  const agents = parseSection('agents', (sections.agents as Agent[]).map(assign));
  const systemAgents = parseSection(
    'systemAgents',
    (sections.systemAgents as SystemAgent[]).map(assign),
  );
  parseSection('agentCatalog', { agents, teams: sections.agentTeams });
  return {
    ...sections,
    agents,
    systemAgents,
    resources: parseSection('resources', [resource, ...resources]),
  };
}
