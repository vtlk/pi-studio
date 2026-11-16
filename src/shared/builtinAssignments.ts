import type { Agent } from './studio.ts';
import { builtinResources } from './builtinResources.ts';

type Profile = Pick<Agent, 'mcps' | 'capabilitySettings'> & { systemRole?: string };

export function requiredBuiltinMcpIds(profile: {
  systemRole?: string;
  mcps?: readonly string[];
}): string[] {
  return profile.systemRole === 'assistant'
    ? builtinResources.map((resource) => resource.id)
    : ['pistudio-project'];
}

export function hasBuiltinMcp(profile: Profile, id: string) {
  return (
    requiredBuiltinMcpIds(profile).includes(id) ||
    (profile.mcps.includes(id) && profile.capabilitySettings?.[`mcps:${id}`]?.enabled !== false)
  );
}

/** Required assignments are canonical in storage as well as in the constructor UI. */
export function normalizeBuiltinAssignments<T extends Profile>(profile: T): T {
  const required = requiredBuiltinMcpIds(profile);
  const mcps = [...new Set([...required, ...profile.mcps])];
  const disabled = required.filter(
    (id) => profile.capabilitySettings?.[`mcps:${id}`]?.enabled === false,
  );
  if (mcps.join('\0') === profile.mcps.join('\0') && !disabled.length) return profile;
  return {
    ...profile,
    mcps,
    ...(disabled.length
      ? {
          capabilitySettings: {
            ...profile.capabilitySettings,
            ...Object.fromEntries(disabled.map((id) => [`mcps:${id}`, { enabled: true }])),
          },
        }
      : {}),
  };
}
