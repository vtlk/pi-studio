import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LibraryStore } from '../../src/main/library/LibraryStore.ts';
import { writeLibraryFixture } from './library.mjs';
const [root, kind, title, existingId] = process.argv.slice(2);
if (!root || !title || !['characters', 'locations'].includes(kind))
  throw new Error('Fixture arguments required');
const output = join(root, '.pistudio/library-qa/output');
await mkdir(output, { recursive: true });
const library = new LibraryStore(root);
const prepared = await library.prepare(output, {
  kind,
  title,
  ...(existingId ? { existingId } : {}),
});
await writeLibraryFixture(prepared);
console.log(JSON.stringify(await library.publish(output, prepared.token)));
