// Own signed host + nonactivating AppKit target. No production app/data/desktop capture.
const assert = require('node:assert/strict');
const {
  mkdtemp,
  realpath,
  mkdir,
  cp,
  rename,
  readFile,
  writeFile,
  rm,
} = require('node:fs/promises');
const { constants } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const modelMode = process.argv.includes('--model');
const repository = resolve(__dirname, '..');
const identity = process.env.PI_STUDIO_SIGN_IDENTITY;
assert.equal(process.platform, 'darwin');
assert.equal(
  process.env.PI_STUDIO_NATIVE_DESKTOP_QA,
  '1',
  'Desktop QA is opt-in and may request macOS consent. Run only during an explicitly agreed awake test window.',
);
assert.ok(identity && identity !== '-');
const run = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', timeout: 60000, stdio: 'pipe' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(file) {
  return readFile(file, 'utf8')
    .then(JSON.parse)
    .catch(() => undefined);
}
async function until(read, predicate, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await sleep(80);
  }
  throw Error('Native Computer QA condition timed out');
}
(async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-native-computer-')));
  const nonce = randomUUID(),
    bundle = join(root, 'Pi Studio QA.app');
  let fixture, driverPid;
  try {
    for (const name of ['userData', 'videos']) await mkdir(join(root, name));
    let modelSelection;
    if (modelMode) {
      const selectionFile = join(root, 'model-selection.json');
      console.log(
        run(process.execPath, [
          '--experimental-strip-types',
          join(repository, 'scripts/fixtures/native-computer-selection.ts'),
          selectionFile,
        ]),
      );
      modelSelection = await json(selectionFile);
      assert.ok(modelSelection);
      await writeFile(join(root, 'visual-code.txt'), randomBytes(4).toString('hex').toUpperCase(), {
        mode: 0o600,
      });
    }
    await cp(join(repository, 'node_modules/electron/dist/Electron.app'), bundle, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    await rename(
      join(bundle, 'Contents/MacOS/Electron'),
      join(bundle, 'Contents/MacOS/Pi Studio QA'),
    );
    const plist = join(bundle, 'Contents/Info.plist');
    for (const [key, value] of Object.entries({
      CFBundleIdentifier: 'studio.pi.desktop',
      CFBundleExecutable: 'Pi Studio QA',
      CFBundleName: 'Pi Studio QA',
      CFBundleDisplayName: 'Pi Studio QA',
    }))
      run('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
    run('/usr/bin/plutil', ['-replace', 'LSUIElement', '-bool', 'true', plist]);
    await rm(join(bundle, 'Contents/Resources/default_app.asar'), { force: true });
    const source = join(bundle, 'Contents/Resources/app');
    await mkdir(source);
    await cp(
      join(repository, 'scripts/fixtures/native-computer-main.cjs'),
      join(source, 'main.cjs'),
    );
    await cp(join(repository, 'scripts/offscreen-main.cjs'), join(source, 'offscreen-main.cjs'));
    const { rolldown } = await import('rolldown');
    const build = await rolldown({
      input: join(repository, 'scripts/fixtures/native-computer-runtime.ts'),
      platform: 'node',
      external: ['@trycua/cua-driver', 'electron', 'jsonc-parser'],
    });
    try {
      await build.write({ file: join(source, 'computer-runtime.cjs'), format: 'cjs' });
    } finally {
      await build.close();
    }
    await cp(join(repository, 'out/renderer'), join(source, 'out/renderer'), { recursive: true });
    for (const name of [
      '@trycua/cua-driver',
      '@trycua/cua-driver-darwin-arm64',
      '@ubjs/core',
      '@ubjs/node',
      'jsonc-parser',
    ]) {
      await cp(join(repository, 'node_modules', name), join(source, 'node_modules', name), {
        recursive: true,
      });
    }
    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({ name: 'pi-studio-qa', main: 'main.cjs', version: '1.0.0' }),
    );
    run('/usr/bin/xattr', ['-cr', bundle]);
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', identity, bundle]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    const requirement = (path) => run('/usr/bin/codesign', ['-d', '-r-', path]).trim();
    assert.equal(requirement(bundle), requirement('/Users/user1/Applications/Pi Studio.app'));
    const config = join(root, 'config.json');
    await writeFile(config, JSON.stringify({ root, repository, nonce, modelSelection }), {
      mode: 0o600,
    });
    run('/usr/bin/open', [
      '-g',
      '-n',
      '-a',
      bundle,
      '--args',
      '--qa-config=' + config,
      '--user-data-dir=' + join(root, 'userData'),
    ]);
    const ready = await until(async () => {
      const starting = await json(join(root, 'driver-starting.json'));
      if (starting?.nonce === nonce) driverPid = starting.pid;
      const failure = await json(join(root, 'failure.json'));
      if (failure) throw Error(failure.stack);
      return json(join(root, 'driver-ready.json'));
    }, Boolean);
    assert.equal(ready.nonce, nonce);
    driverPid = ready.pid;
    console.log(
      JSON.stringify({ phase: 'promptless-permissions', permissions: ready.permissions }),
    );
    if (ready.permissions.accessibility && ready.permissions.screenRecording) {
      const binary = join(root, 'native-computer-target');
      run('/usr/bin/swiftc', [
        join(repository, 'scripts/fixtures/native-computer.swift'),
        '-o',
        binary,
      ]);
      fixture = spawn(binary, [root, nonce], { stdio: 'ignore' });
      await until(
        () => json(join(root, 'target-state.json')),
        (state) => state?.nonce === nonce,
      );
    }
    const result = await until(
      async () => {
        const failure = await json(join(root, 'failure.json'));
        if (failure) throw Error(failure.stack);
        const result = await json(join(root, 'result.json'));
        if (!result && driverPid) {
          try {
            process.kill(driverPid, 0);
          } catch {
            throw Error('Owned native QA host exited before its result');
          }
        }
        return result;
      },
      Boolean,
      modelMode ? 240000 : 60000,
    );
    assert.equal(result.nonce, nonce);
    await until(async () => {
      try {
        process.kill(driverPid, 0);
        return false;
      } catch {
        return true;
      }
    }, Boolean);
    await mkdir(join(repository, 'artifacts'), { recursive: true });
    const proof = {
      checkedAt: new Date().toISOString(),
      ...result,
      signedIdentityMatchesInstalled: true,
      nativePermissionProbePrompt: false,
      ownTargetOnly: true,
      actualModelLoop: result.actualModelLoop ?? false,
      installedApplicationOrUserDataChanged: false,
    };
    await writeFile(
      join(
        repository,
        modelMode
          ? 'artifacts/native-computer-model-proof.json'
          : 'artifacts/native-computer-desktop-proof.json',
      ),
      JSON.stringify(proof, null, 2) + '\n',
    );
    const state = await json(join(root, 'window-before.json'));
    if (state)
      await writeFile(
        join(repository, 'artifacts/native-computer-window.json'),
        JSON.stringify(state, null, 2) + '\n',
      );
    await cp(
      join(root, 'window-before.png'),
      join(repository, 'artifacts/native-computer-window.png'),
    ).catch(() => {});
    await cp(
      join(root, 'window-after.png'),
      join(repository, 'artifacts/native-computer-after.png'),
    ).catch(() => {});
    await cp(
      join(root, 'overlay.png'),
      join(repository, 'artifacts/native-computer-overlay.png'),
    ).catch(() => {});
    for (const name of ['edit-result', 'click-result']) {
      const data = await json(join(root, name + '.json'));
      if (data)
        await writeFile(
          join(repository, 'artifacts/native-computer-' + name + '.json'),
          JSON.stringify(data, null, 2) + '\n',
        );
    }
    console.log(JSON.stringify(proof));
  } catch (error) {
    const failure = {};
    for (const name of [
      'failure',
      'window-before',
      'edit-result',
      'click-result',
      'target-state',
      'overlay-error',
      'native-metadata',
      'surface-state',
    ]) {
      const value = await json(join(root, name + '.json'));
      if (value) failure[name] = value;
    }
    await writeFile(
      join(repository, 'artifacts/native-computer-failure.json'),
      JSON.stringify(failure, null, 2) + '\n',
    );
    throw error;
  } finally {
    if (fixture && fixture.exitCode === null) fixture.kill('SIGTERM');
    if (fixture)
      await new Promise((done) =>
        fixture.exitCode !== null || fixture.signalCode !== null
          ? done()
          : fixture.once('exit', done),
      );
    const owned = () =>
      run('/bin/ps', ['-axo', 'pid=', '-o', 'command='])
        .split('\n')
        .flatMap((row) => {
          const match = row.trim().match(/^(\d+)\s+(.+)$/);
          return match && match[2].startsWith(bundle + '/Contents/') ? [Number(match[1])] : [];
        });
    for (const pid of owned()) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
    for (let i = 0; i < 50 && owned().length; i++) await sleep(100);
    for (const pid of owned()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    await until(
      async () => owned(),
      (pids) => pids.length === 0,
      5000,
    );
    try {
      run(
        '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
        ['-u', bundle],
      );
    } catch {
      /* An unlaunched temporary bundle may not have a LaunchServices record. */
    }
    await rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
