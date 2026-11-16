import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJob, paths, authenticated } from './protocol.mjs';
import { recover } from './transaction.mjs';

const journal = process.argv[2];
const job = await loadJob(journal);
const child = spawn(
  process.execPath,
  [join(dirname(fileURLToPath(import.meta.url)), 'worker.mjs'), journal],
  { cwd: job.userData, windowsHide: true, stdio: 'ignore' },
);
const code = await new Promise((resolve) => {
  child.once('error', () => resolve(-1));
  child.once('exit', (value) => resolve(value));
});
const result = await authenticated(paths(job).result, job);
if (
  !result ||
  !['committed', 'rolled-back', 'cancelled', 'failed', 'recovery-required'].includes(result.status)
)
  await recover(job, code === 0 ? 'helper-stopped-without-result' : 'helper-process-failed');
