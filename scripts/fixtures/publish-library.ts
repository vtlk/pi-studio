import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LibraryStore } from '../../src/main/library/LibraryStore.ts';
import { writeLibraryFixture } from './library.mjs';
import { characterFixture } from './character-rig.ts';
const [root, kind, title, existingId] = process.argv
  .slice(2)
  .filter((argument) => argument !== '--rig' && !argument.startsWith('--category='));
if (!root || !title || !['characters', 'locations'].includes(kind))
  throw new Error('Fixture arguments required');
const category = process.argv.find((argument) => argument.startsWith('--category='))?.slice(11);
const output = join(root, '.pistudio/library-qa/output');
await mkdir(output, { recursive: true });
const library = new LibraryStore(root);
const prepared = await library.prepare(output, {
  kind,
  title,
  ...(category ? { category } : {}),
  ...(existingId ? { existingId } : {}),
});
await writeLibraryFixture(prepared);
if (process.argv.includes('--rig')) {
  const { svg, rig } = characterFixture();
  await writeFile(join(prepared.stagingDirectory, 'art.svg'), svg);
  await writeFile(join(prepared.stagingDirectory, 'rig.json'), JSON.stringify(rig));
  await writeFile(
    join(prepared.stagingDirectory, 'asset.json'),
    JSON.stringify({
      ...prepared.manifest,
      files: { ...prepared.manifest.files, vector: 'art.svg', rig: 'rig.json' },
    }),
  );
}
console.log(JSON.stringify(await library.publish(output, prepared.token)));
