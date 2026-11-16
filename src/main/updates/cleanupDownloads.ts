import { lstat, realpath, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, readJson } from '../../../bundled/update-helper/protocol.mjs';

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
  }
}
/** Discard only our abandoned download directories, not unknown files or a live owner's work. */
export async function cleanupDownloads(root: string) {
  if (!(await exists(root))) return;
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error('Папка загрузок перенаправлена. Очистка отменена.');
  for (const name of await readdir(root)) {
    if (!/^download-[A-Za-z0-9]{6}$/.test(name)) continue;
    const directory = join(root, name),
      stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(directory)) !== directory)
      continue;
    const entries = await readdir(directory);
    if (!entries.length) {
      await rm(directory, { recursive: true });
      continue;
    }
    if (
      entries.some((file) => !['owner.json', 'package.zip'].includes(file)) ||
      !entries.includes('owner.json')
    )
      continue;
    const owner = await readJson(join(directory, 'owner.json'));
    if (
      owner.schema !== 1 ||
      typeof owner.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(owner.id) ||
      !Number.isSafeInteger(owner.pid) ||
      Number(owner.pid) < 1 ||
      alive(Number(owner.pid))
    )
      continue;
    let ordinary = true;
    for (const file of entries) {
      const child = await lstat(join(directory, file));
      if (!child.isFile() || child.isSymbolicLink()) ordinary = false;
    }
    if (ordinary) await rm(directory, { recursive: true });
  }
}
