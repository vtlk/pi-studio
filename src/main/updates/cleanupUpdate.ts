import { t } from '../../shared/i18n/index.ts';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  paths,
  exists,
  identity,
  sameIdentity,
  authenticated,
  readJson,
  validateJob,
  loadJob,
  type UpdateJob,
} from '../../../bundled/update-helper/protocol.mjs';
import { verifyInventory } from '../../../bundled/update-helper/inventory.mjs';

function alive(pid: unknown) {
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
  }
}
/** Only a completed, path-bound transaction; never remove a still-needed previous application. */
export async function cleanupUpdate(job: UpdateJob) {
  const p = paths(job),
    result = await authenticated(p.result, job);
  if (
    !result ||
    !['committed', 'rolled-back', 'failed', 'cancelled'].includes(String(result.status))
  )
    return false;
  const expected = result.status === 'committed' ? job.newIdentity : job.oldIdentity;
  if (!sameIdentity(await identity(job.target), expected))
    throw new Error(t('error.cleanupUpdate.theAppPathChangedTemporary'));
  if (await exists(job.stage)) {
    // loadJob checks canonical paths and private staging, including before recursive cleanup.
    await loadJob(p.journal);
    for (const file of ['runner.json', 'ready.json']) {
      const marker = await authenticated(join(job.stage, file), job);
      if (marker && alive(marker.pid)) return false;
    }
    if (await exists(p.previous))
      throw new Error(t('error.cleanupUpdate.thePreviousAppIsRetained'));
    for (const root of [p.candidate, p.rejected])
      if (await exists(root)) {
        if (!sameIdentity(await identity(root), job.newIdentity))
          throw new Error(t('error.cleanupUpdate.theTemporaryAppChanged'));
        await verifyInventory(root, job.platform);
      }
    const allowed = new Set([
      'next',
      'previous',
      'rejected',
      'helper',
      'startups',
      'ready.json',
      'commit.json',
      'cancel.json',
      'health.json',
      'abort-startup.json',
      'phase.json',
      'runner.json',
    ]);
    if ((await readdir(job.stage)).some((name) => !allowed.has(name)))
      throw new Error(t('error.cleanupUpdate.theTemporaryFolderContainsAdditional'));
  }
  // Removing this pointer first also makes a crash during cleanup safe for ordinary startup.
  if (await exists(p.active)) {
    const active = await readJson(p.active);
    if (active.id === job.id && active.target === job.target) await rm(p.active);
  }
  await rm(job.stage, { recursive: true, force: true });
  await rm(p.journal, { force: true });
  return true;
}
/** Recover cleanup interrupted after pointer removal. Only this installation's known journals. */
export async function cleanupFinishedUpdates(userData: string, target: string) {
  const directory = join(userData, 'updates/transactions');
  if (!(await exists(directory))) return true;
  const names = await readdir(directory);
  if (names.length > 100) throw new Error(t('error.cleanupUpdate.tooManyUnfinishedUpdateRecords'));
  let finished = true;
  for (const name of names)
    if (/^[a-f0-9-]{36}\.json$/.test(name)) {
      const job = validateJob(await readJson(join(directory, name)));
      if (
        job.userData === userData &&
        job.target === target &&
        paths(job).journal === join(directory, name)
      ) {
        const result = await authenticated(paths(job).result, job);
        if (
          result &&
          ['committed', 'rolled-back', 'failed', 'cancelled'].includes(String(result.status))
        )
          finished = (await cleanupUpdate(job)) && finished;
      }
    }
  return finished;
}
