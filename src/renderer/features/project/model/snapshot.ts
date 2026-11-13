import type { Agent } from '@/entities/studio/types';
import type { ProjectAgent, ProjectAgentProfile } from './workspace.types';

function projectProfile(agent: Agent): ProjectAgentProfile {
  const { instructions: _instructions, mainInstruction: _mainInstruction, ...settings } = agent;
  return structuredClone(settings);
}

export function getCurrentAgentInstructions(agentId: string, agents: Agent[]) {
  const agent = agents.find((item) => item.id === agentId);
  if (!agent) return undefined;
  return [
    agent.mainInstruction ?? '',
    ...agent.instructions.filter((item) => item.enabled).map((item) => item.content),
  ].filter(Boolean);
}

export function snapshotAgents(agents: Agent[]): ProjectAgent[] {
  return agents.map((profile) => ({
    profile: projectProfile(profile),
    outputPath: `agents/${profile.id}/output`,
    entries: [],
  }));
}

export function compareAgents(
  snapshot: ProjectAgent[],
  current: Agent[],
  excludedIds: string[] = [],
) {
  const savedById = new Map(snapshot.map((item) => [item.profile.id, item.profile]));
  const currentIds = new Set(current.map((item) => item.id));
  return {
    added: current.filter((item) => !savedById.has(item.id) && !excludedIds.includes(item.id)),
    changed: current.filter((item) => {
      const saved = savedById.get(item.id);
      return saved && JSON.stringify(saved) !== JSON.stringify(projectProfile(item));
    }),
    missing: snapshot
      .filter((item) => !currentIds.has(item.profile.id))
      .map((item) => item.profile),
  };
}

export function refreshSnapshot(
  snapshot: ProjectAgent[],
  current: Agent[],
  updateExisting: boolean,
  excludedIds: string[] = [],
) {
  const diff = compareAgents(snapshot, current, excludedIds);
  const changed = new Map(diff.changed.map((item) => [item.id, item]));
  return [
    ...snapshotAgents(diff.added),
    ...snapshot.map((item) => {
      const next = changed.get(item.profile.id);
      return updateExisting && next ? { ...item, profile: projectProfile(next) } : item;
    }),
  ];
}
