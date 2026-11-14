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
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value)),
  );
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return actual === expected;
}
