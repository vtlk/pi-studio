const { spawn } = require('node:child_process');
const { mkdtemp, realpath, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
(async () => {
  const name = process.argv[2];
  if (!['claude-code', 'native-extensions'].includes(name))
    throw Error('Choose claude-code or native-extensions');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-provider-ui-')));
  try {
    await new Promise((done, fail) => {
      const child = spawn(require('electron'), [join(__dirname, `smoke-${name}-ui.cjs`)], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '', PI_STUDIO_PROVIDER_UI_QA_ROOT: root },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '',
        timedOut = false;
      child.stdout.on('data', (b) => (log += b));
      child.stderr.on('data', (b) => (log += b));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, 70000);
      child.once('error', fail);
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code || timedOut) fail(Error(log));
        else {
          console.log(log);
          done();
        }
      });
    });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
