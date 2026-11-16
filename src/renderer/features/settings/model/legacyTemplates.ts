import { canonicalJson } from '../../../../shared/canonicalJson.ts';
import hashes from './legacyTemplateHashes.json' with { type: 'json' };

/** Match the full historical value, including instructions/model/settings, without bundling it. */
export async function matchesLegacyTemplate(
  value: { id: string; kind?: string },
  section: keyof typeof hashes,
) {
  const key = section === 'resources' ? `${value.kind}:${value.id}` : value.id;
  const expected = (hashes[section] as Record<string, string>)[key];
  if (!expected) return false;
  const candidates: unknown[] = [value];
  // The current storage schema adds this required MCP without changing user configuration.
  // Match that exact schema projection too; all other historical fields remain byte-verified.
  if (section === 'agents' && 'mcps' in value && Array.isArray(value.mcps)) {
    if (value.mcps.includes('pistudio-project'))
      candidates.push({ ...value, mcps: value.mcps.filter((id) => id !== 'pistudio-project') });
  }
  for (const candidate of candidates) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalJson(candidate)),
    );
    const actual = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    if (actual === expected) return true;
  }
  return false;
}
