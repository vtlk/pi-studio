import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, writeFile, lstat, readlink } from 'node:fs/promises';
import { join, relative } from 'node:path';

function location(root, platform) {
  return join(
    root,
    platform === 'darwin'
      ? 'Contents/Resources/app/installation-files.json'
      : 'resources/app/installation-files.json',
  );
}
async function entries(root, platform) {
  const index = location(root, platform),
    result = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name),
        name = relative(root, path).split('\\').join('/');
      if (path === index) continue;
      if (entry.isDirectory()) {
        result.push([name, 'directory']);
        await walk(path);
      } else if (entry.isSymbolicLink()) {
        result.push([name, 'link', await readlink(path)]);
      } else if (entry.isFile()) {
        let hash;
        if (platform === 'win32') {
          const digest = createHash('sha256');
          for await (const chunk of createReadStream(path)) digest.update(chunk);
          hash = digest.digest('hex');
        }
        result.push(hash ? [name, 'file', hash] : [name, 'file']);
      } else throw new Error('Unexpected special file in the application directory.');
      if (result.length > 100000) throw new Error('Application inventory is too large.');
    }
  }
  await walk(root);
  // A Mac-built Windows archive must compare identically under any installed locale.
  return result.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}
export async function writeInventory(root, platform) {
  const data = { schema: 1, platform, entries: await entries(root, platform) };
  await writeFile(location(root, platform), JSON.stringify(data) + '\n', {
    flag: 'wx',
    mode: 0o644,
  });
}
export async function verifyInventory(root, platform) {
  const index = location(root, platform),
    info = await lstat(index);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 ** 2)
    throw new Error('Invalid application inventory.');
  const expected = JSON.parse(await readFile(index, 'utf8'));
  if (
    expected.schema !== 1 ||
    expected.platform !== platform ||
    !Array.isArray(expected.entries) ||
    JSON.stringify(expected.entries) !== JSON.stringify(await entries(root, platform))
  )
    throw new Error(
      'Application contains changed or additional files; automatic replacement is unsafe.',
    );
}
