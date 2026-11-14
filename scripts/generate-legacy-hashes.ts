import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { initialAgents } from '../src/renderer/fixtures/agents.ts';
import { exampleConnections } from '../src/renderer/fixtures/connections.ts';
import { exampleResources } from '../src/renderer/fixtures/resources.ts';
import { canonicalJson } from '../src/shared/canonicalJson.ts';

// Compatibility identifiers only. Never import example texts into the native renderer.
const hashes = (items: { id: string; kind?: string }[]) =>
  Object.fromEntries(
    items.map((item) => [
      item.kind ? `${item.kind}:${item.id}` : item.id,
      createHash('sha256').update(canonicalJson(item)!).digest('hex'),
    ]),
  );
const contents = `${JSON.stringify(
  {
    agents: hashes(initialAgents),
    connections: hashes(exampleConnections),
    resources: hashes(exampleResources),
  },
  null,
  2,
)}\n`;
const target = new URL(
  '../src/renderer/features/settings/model/legacyTemplateHashes.json',
  import.meta.url,
);
try {
  const existing = await readFile(target, 'utf8');
  if (existing !== contents)
    throw new Error(
      'Historical template hashes are immutable. Preserve this registry and add a separate version for changed examples.',
    );
  console.log('Verified historical SHA-256 identifiers; no changes.');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  await writeFile(target, contents);
  console.log('Created historical SHA-256 identifiers; no example texts stored.');
}
