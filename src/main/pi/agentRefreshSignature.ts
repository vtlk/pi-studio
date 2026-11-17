import { createHash } from 'node:crypto';
import type { Agent } from '../../shared/studio.ts';
import type { ProjectAgentProfile } from '../../shared/project.ts';
import type { Resource } from '../../shared/resources.ts';
import { canonicalJson } from '../../shared/canonicalJson.ts';
import { optionalBuiltinMcps } from '../../shared/builtinResources.ts';

export const refreshDigest = (value: unknown) =>
  createHash('sha256')
    .update(canonicalJson(value) ?? '')
    .digest('hex');

/** In-memory comparison only: never persist or send instruction/configuration snapshots. */
export function agentRefreshSignature(
  saved: ProjectAgentProfile,
  current: Agent,
  resources: Resource[],
) {
  const ids = new Set([
    ...saved.skills,
    ...saved.mcps,
    ...saved.plugins,
    ...current.mcps.filter((id) => optionalBuiltinMcps.some((item) => item.id === id)),
  ]);
  return refreshDigest({
    profile: saved,
    model: current.model,
    mainInstruction: current.mainInstruction ?? '',
    instructions: current.instructions.filter((item) => item.enabled),
    optionalMcps: current.mcps
      .filter((id) => optionalBuiltinMcps.some((item) => item.id === id))
      .map((id) => [id, current.capabilitySettings?.[`mcps:${id}`]?.enabled !== false]),
    resources: resources
      .filter((resource) => ids.has(resource.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(({ check: _check, ...resource }) => resource),
  });
}
