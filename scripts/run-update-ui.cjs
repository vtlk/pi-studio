const { mkdtemp, rm, readFile, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

(async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-update-ui-'));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [join(__dirname, 'smoke-updates-ui.cjs')], {
        stdio: 'inherit',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '', PI_STUDIO_UPDATE_UI_ROOT: root },
      });
      let forced,
        timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        forced = setTimeout(() => child.kill('SIGKILL'), 3000);
      }, 75000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(deadline);
        clearTimeout(forced);
        if (code === 0 && !timedOut) resolve();
        else reject(Error('Owned update UI process failed to complete.'));
      });
    });
    await rm(root, { recursive: true, force: true });
    const file = 'artifacts/update-ui-proof.json';
    const proof = JSON.parse(await readFile(file, 'utf8'));
    proof.actualChildExitVerified = true;
    proof.temporaryProfileRemovedAfterExit = true;
    await writeFile(file, JSON.stringify(proof, null, 2) + '\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
