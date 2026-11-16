import { readFile } from 'node:fs/promises';

/** Existing transports must honor saved assignment changes before every new browser call. */
export async function browserAssigned(binding) {
  if (typeof binding.studioFile !== 'string' || typeof binding.agentId !== 'string') return false;
  try {
    const { sections } = JSON.parse(await readFile(binding.studioFile, 'utf8'));
    const profile = [...(sections.agents ?? []), ...(sections.systemAgents ?? [])].find(
      (agent) => agent.id === binding.agentId,
    );
    return (
      !!profile &&
      (profile.systemRole === 'assistant' ||
        (profile.mcps?.includes('pistudio-browser') &&
          profile.capabilitySettings?.['mcps:pistudio-browser']?.enabled !== false))
    );
  } catch {
    return false;
  }
}
