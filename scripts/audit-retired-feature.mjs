import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(process.argv[2] ?? '.');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const matches = [],
  files = [];
const markers =
  /pistudio-library|pi-studio-library|Pi Studio\s*(?:·\s*)?Library|Pi Studio\s*·\s*Библиотека|библиоте(?:к|ч)[а-яё]*|library_(?:get|list|read|prepare|validate|publish|render|search)|libraryAgents|hiddenLibraryIds|library-bootstraps|library-runs/iu;
async function scan(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) return;
  const name = relative(root, path);
  if (info.isDirectory()) {
    if (/(?:^|\/)(?:library-runtime|saxes|xmlchars)(?:\/|$)/.test(name)) matches.push(name);
    for (const item of await readdir(path)) await scan(join(path, item));
  } else if (info.isFile()) {
    const bytes = await readFile(path);
    files.push([name, createHash('sha256').update(bytes).digest('hex')]);
    if (/\.(?:c?js|mjs|json|css|html|md|txt)$/.test(name) && markers.test(bytes.toString('utf8')))
      matches.push(name);
  }
}
for (const name of ['out', 'bundled/pi-bridge', 'bundled/pi-claude-code', 'bundled/update-helper'])
  await scan(join(root, name));
// Explicitly excluded from native distributions after their only consumer was removed.
for (const dependency of ['saxes', 'xmlchars'])
  try {
    await lstat(join(root, 'node_modules', dependency));
    matches.push('node_modules/' + dependency);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
if (matches.length) throw Error('Retired feature remains: ' + matches.join(', '));
files.sort(([a], [b]) => a.localeCompare(b));
const proof = {
  checkedAt: new Date().toISOString(),
  version,
  checkedFiles: files.length,
  aggregateSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  retiredSemanticMarkersAbsent: true,
  exclusiveParserDependenciesAbsent: true,
  scope:
    'Own compiled main/preload/renderer and shipped bridges/helper; generic OS and third-party library names are not a product feature.',
  runtimeAcceptance: false,
};
if (process.argv[3])
  await writeFile(resolve(process.argv[3]), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof));
