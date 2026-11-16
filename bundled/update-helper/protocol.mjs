import { dirname, join, isAbsolute, relative, basename, sep } from 'node:path';
import { lstat, realpath, readFile, open, rename } from 'node:fs/promises';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function validateJob(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.schema !== 1 ||
    !uuid.test(value.id) ||
    !uuid.test(value.nonce) ||
    !['darwin', 'win32'].includes(value.platform) ||
    !Number.isSafeInteger(value.oldPid) ||
    value.oldPid < 1 ||
    ![value.target, value.stage, value.userData].every(
      (path) => typeof path === 'string' && isAbsolute(path) && !path.includes('\0'),
    ) ||
    value.stage !== join(dirname(value.target), `.pistudio-update-${value.id}`) ||
    value.target === dirname(value.target) ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.version) ||
    typeof value.oldVersion !== 'string' ||
    ![value.oldIdentity, value.newIdentity].every(
      (identity) =>
        identity &&
        ['dev', 'ino', 'birthtimeNs'].every(
          (key) => typeof identity[key] === 'string' && /^\d+$/.test(identity[key]),
        ),
    ) ||
    !value.limits ||
    !['exitMs', 'healthMs', 'abortMs'].every(
      (key) =>
        Number.isInteger(value.limits[key]) &&
        value.limits[key] >= 50 &&
        value.limits[key] <= 180000,
    )
  )
    throw new Error('Invalid update transaction metadata.');
  const inside = relative(value.target, value.userData);
  if (!inside || !(inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)))
    throw new Error('User data must stay outside the replaceable application.');
  return value;
}
export function paths(job) {
  const root = job.platform === 'darwin' ? 'Pi Studio.app' : 'Pi Studio';
  return {
    candidate: join(job.stage, 'next', root),
    previous: join(job.stage, 'previous', basename(job.target)),
    rejected: join(job.stage, 'rejected', basename(job.target)),
    journal: join(job.userData, 'updates/transactions', `${job.id}.json`),
    result: join(job.userData, 'updates/results', `${job.id}.json`),
    active: join(job.userData, 'updates/active.json'),
    ready: join(job.stage, 'ready.json'),
    commit: join(job.stage, 'commit.json'),
    cancel: join(job.stage, 'cancel.json'),
    health: join(job.stage, 'health.json'),
    abort: join(job.stage, 'abort-startup.json'),
    phase: join(job.stage, 'phase.json'),
    startups: join(job.stage, 'startups'),
  };
}
export function executable(root, platform) {
  return join(root, platform === 'darwin' ? 'Contents/MacOS/Pi Studio' : 'Pi Studio.exe');
}
export async function identity(path) {
  const value = await lstat(path, { bigint: true });
  if (!value.isDirectory() || value.isSymbolicLink() || (await realpath(path)) !== path)
    throw new Error('Update path is not an ordinary canonical directory.');
  return {
    dev: value.dev.toString(),
    ino: value.ino.toString(),
    birthtimeNs: value.birthtimeNs.toString(),
  };
}
export function sameIdentity(left, right) {
  return left && right && ['dev', 'ino', 'birthtimeNs'].every((key) => left[key] === right[key]);
}
export async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
export async function readJson(path) {
  const value = await lstat(path);
  if (!value.isFile() || value.isSymbolicLink() || value.size > 65536)
    throw new Error('Invalid update status file.');
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function atomicJson(path, data) {
  const temporary = path + `.write-${process.pid}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(data) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  // Persist the directory entry on platforms that support directory fsync.
  if (process.platform !== 'win32') {
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
export async function authenticated(path, job) {
  if (!(await exists(path))) return undefined;
  const value = await readJson(path);
  return value.nonce === job.nonce ? value : undefined;
}
export async function loadJob(journal) {
  const job = validateJob(await readJson(journal));
  if (paths(job).journal !== journal) throw new Error('Unbound update journal.');
  const stage = await lstat(job.stage);
  if (
    !stage.isDirectory() ||
    stage.isSymbolicLink() ||
    (process.platform !== 'win32' && stage.mode & 0o077)
  )
    throw new Error('Update staging is not private.');
  if ((await realpath(job.stage)) !== job.stage) throw new Error('Update staging was redirected.');
  return job;
}
