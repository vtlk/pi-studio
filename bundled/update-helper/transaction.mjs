import { mkdir, rename, readdir, rm, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { verifyInventory } from './inventory.mjs';
import {
  paths,
  identity,
  sameIdentity,
  exists,
  atomicJson,
  authenticated,
  executable,
} from './protocol.mjs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}
async function phase(job, state, fields = {}) {
  await atomicJson(paths(job).phase, { nonce: job.nonce, state, ...fields });
}
export async function finish(job, status, reason) {
  const p = paths(job);
  await mkdir(dirname(p.result), { recursive: true, mode: 0o700 });
  await atomicJson(p.result, {
    id: job.id,
    nonce: job.nonce,
    status,
    reason,
    version: job.version,
    previousVersion: job.oldVersion,
    at: Date.now(),
  });
  await phase(job, status);
}
async function owned(job, path, expected) {
  if (!sameIdentity(await identity(path), expected))
    throw new Error('Application directory identity changed.');
}
async function move(job, from, to, expected) {
  await owned(job, from, expected);
  if (await exists(to)) throw new Error('Application destination is already occupied.');
  await mkdir(dirname(to), { recursive: true, mode: 0o700 });
  const until = Date.now() + 10000;
  for (;;) {
    try {
      await rename(from, to);
      break;
    } catch (error) {
      if (!['EACCES', 'EPERM', 'EBUSY'].includes(error.code) || Date.now() > until) throw error;
      if (await exists(to)) throw new Error('Application destination changed while waiting.');
      await sleep(100);
    }
  }
  if (process.platform !== 'win32') {
    for (const directory of new Set([dirname(from), dirname(to)])) {
      const handle = await open(directory, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }
  await owned(job, to, expected);
}
function launch(job, failed = false) {
  const env = { ...process.env };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH']) delete env[name];
  const child = spawn(
    executable(job.target, job.platform),
    [
      `${failed ? '--pistudio-update-failed' : '--pistudio-update'}=${job.id}`,
      `--pistudio-user-data=${job.userData}`,
    ],
    { cwd: dirname(job.target), detached: true, windowsHide: true, stdio: 'ignore', env },
  );
  let exited = false,
    error;
  child.once('exit', () => {
    exited = true;
  });
  child.once('error', (value) => {
    exited = true;
    error = value;
  });
  child.unref();
  return { child, running: () => !exited && !!child.pid && alive(child.pid), error: () => error };
}
async function startupPids(job) {
  const p = paths(job),
    result = [];
  if (!(await exists(p.startups))) return result;
  for (const name of await readdir(p.startups)) {
    if (!/^\d+\.json$/.test(name)) continue;
    const marker = await authenticated(join(p.startups, name), job);
    if (
      marker &&
      Number(name.slice(0, -5)) === marker.pid &&
      marker.exe === executable(job.target, job.platform) &&
      alive(marker.pid)
    )
      result.push(marker.pid);
  }
  return result;
}
async function cancelled(job) {
  return !!(await authenticated(paths(job).cancel, job));
}

export async function perform(job) {
  const p = paths(job);
  await owned(job, job.target, job.oldIdentity);
  await owned(job, p.candidate, job.newIdentity);
  await mkdir(p.startups, { recursive: true, mode: 0o700 });
  await atomicJson(p.ready, { nonce: job.nonce, pid: process.pid });
  await phase(job, 'waiting');
  const deadline = Date.now() + job.limits.exitMs;
  while (true) {
    if (await cancelled(job)) {
      await finish(job, 'cancelled', 'cancelled-before-replacement');
      return;
    }
    const consent = await authenticated(p.commit, job);
    const starting = await startupPids(job);
    if (consent && !alive(job.oldPid) && starting.length === 0) break;
    if (Date.now() > deadline) throw new Error('The previous application did not close in time.');
    if (!consent && !alive(job.oldPid)) {
      await finish(job, 'cancelled', 'exited-without-commit');
      return;
    }
    await sleep(50);
  }
  if (await cancelled(job)) {
    await finish(job, 'cancelled', 'cancelled-before-replacement');
    return;
  }
  await phase(job, 'moving-previous');
  // Recheck after the old app exits: the user may have added materials while we waited.
  await verifyInventory(job.target, job.platform);
  await verifyInventory(p.candidate, job.platform);
  await move(job, job.target, p.previous, job.oldIdentity);
  await phase(job, 'moving-next');
  if (await cancelled(job)) throw new Error('Update cancelled during replacement.');
  await move(job, p.candidate, job.target, job.newIdentity);
  await phase(job, 'launching');
  const launched = launch(job);
  await phase(job, 'launching', { newPid: launched.child.pid });
  const healthDeadline = Date.now() + job.limits.healthMs;
  while (Date.now() < healthDeadline) {
    if (await cancelled(job)) throw new Error('Update cancelled before startup acknowledgement.');
    const health = await authenticated(p.health, job);
    if (
      health &&
      health.version === job.version &&
      health.pid === launched.child.pid &&
      health.exe === executable(job.target, job.platform) &&
      launched.running()
    ) {
      await owned(job, job.target, job.newIdentity);
      await owned(job, p.previous, job.oldIdentity);
      await verifyInventory(p.previous, job.platform);
      await phase(job, 'committing');
      await rm(p.previous, { recursive: true });
      await finish(job, 'committed', 'startup-confirmed');
      return;
    }
    if (!launched.running())
      throw new Error('The new application exited before confirming startup.');
    await sleep(50);
  }
  throw new Error('Startup acknowledgement timed out.');
}

/** Recovery never signals processes and never removes an unknown directory occupying the app path. */
export async function recover(job, reason) {
  const p = paths(job);
  const durable = await authenticated(p.phase, job);
  if (
    ['committing', 'committed'].includes(durable?.state) &&
    (await exists(job.target)) &&
    sameIdentity(await identity(job.target), job.newIdentity)
  ) {
    if (await exists(p.previous)) {
      await owned(job, p.previous, job.oldIdentity);
      await rm(p.previous, { recursive: true });
    }
    await finish(job, 'committed', 'durable-commit-recovered');
    return;
  }
  if (!(await exists(p.previous))) {
    if ((await exists(job.target)) && sameIdentity(await identity(job.target), job.oldIdentity)) {
      const rolledBack = durable?.state === 'restoring-previous';
      await finish(job, rolledBack ? 'rolled-back' : 'failed', reason);
      if (!alive(job.oldPid) && (await authenticated(p.commit, job)) && !(await cancelled(job)))
        launch(job, true);
      return;
    }
    await finish(job, 'recovery-required', 'previous-application-not-found');
    return;
  }
  await owned(job, p.previous, job.oldIdentity);
  // A worker may have exited immediately after a completed commit or before writing result.
  // No new process is force-closed, even if its startup became unresponsive.
  await atomicJson(p.abort, { nonce: job.nonce });
  await sleep(300);
  const previousPhase = await authenticated(p.phase, job);
  const extra = Number.isSafeInteger(previousPhase?.newPid) ? previousPhase.newPid : undefined;
  const deadline = Date.now() + job.limits.abortMs;
  while ((await startupPids(job)).length || (extra && alive(extra))) {
    if (Date.now() > deadline) {
      await finish(job, 'recovery-required', 'new-application-still-running');
      return;
    }
    await sleep(50);
  }
  if (await exists(job.target)) {
    if (!sameIdentity(await identity(job.target), job.newIdentity)) {
      await finish(job, 'recovery-required', 'application-path-changed');
      return;
    }
    await move(job, job.target, p.rejected, job.newIdentity);
  }
  await phase(job, 'restoring-previous');
  await move(job, p.previous, job.target, job.oldIdentity);
  await finish(job, 'rolled-back', reason);
  if (!alive(job.oldPid)) launch(job, true);
}
