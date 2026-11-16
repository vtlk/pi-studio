import { loadJob } from './protocol.mjs';
import { perform, recover } from './transaction.mjs';

const job = await loadJob(process.argv[2]);
try {
  await perform(job);
} catch {
  await recover(job, 'installation-or-startup-failed');
}
