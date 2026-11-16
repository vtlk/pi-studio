const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, rm, realpath } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
(async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-native-bundle-')));
  try {
    for (const name of ['userData', 'videos']) await mkdir(join(root, name));
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [join(__dirname, 'smoke-native-bundle.cjs')], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '', PI_STUDIO_NATIVE_QA_ROOT: root },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '',
        timedOut = false;
      child.stdout.on('data', (b) => (output += b));
      child.stderr.on('data', (b) => (output += b));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, 65000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 || timedOut) reject(Error(output || 'Native bundle child failed'));
        else {
          console.log(output);
          resolve();
        }
      });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
