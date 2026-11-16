import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

/** Read-only observation: never launches Chrome, removes clones or touches browser profiles. */
export async function browserCloneSnapshot() {
  if (process.platform !== 'darwin') return { available: false, names: [] };
  const directory = resolve(tmpdir(), '../X/com.google.Chrome.code_sign_clone');
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return {
      available: true,
      names: entries
        .filter(
          (entry) => entry.isDirectory() && /^code_sign_clone\.[a-zA-Z0-9]{6}$/.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort(),
    };
  } catch (error) {
    return { available: error.code === 'ENOENT', names: [] };
  }
}

export async function recordBrowserCloneAudit(root, operation, before) {
  if (!/^[a-z-]+$/.test(operation)) throw Error('Invalid clone audit operation.');
  const after = await browserCloneSnapshot();
  const added =
    before.available && after.available
      ? after.names.filter((name) => !before.names.includes(name))
      : null;
  const report = {
    checkedAt: new Date().toISOString(),
    operation,
    before,
    after,
    newClones: added,
    noNewRetainedClonesObserved: added === null ? null : added.length === 0,
    processOwnershipInferred: false,
    browserOrProfileModified: false,
  };
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(
    join(root, 'artifacts', `mac-${operation}-browser-clones-proof.json`),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    added === null
      ? 'Browser clone audit unavailable.'
      : `Browser clone audit: ${added.length} new directories observed; ownership is not inferred.`,
  );
  return report;
}
