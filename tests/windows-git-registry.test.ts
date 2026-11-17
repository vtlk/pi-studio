import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsGitInstallRoots } from '../src/main/pi/windowsGitRegistry.ts';
import { findWindowsBash } from '../src/main/pi/windowsBash.ts';
import { findGit, gitRequirementReady } from '../src/main/pi/git.ts';
import { piEnvironment } from '../src/main/pi/platform.ts';

test('registry discovery reads user/machine and both views with UTF-8, hidden, bounded, read-only PowerShell', async () => {
  const root = "E:\\Программы O'Brien $x\\Git";
  let queries = 0;
  const found = await windowsGitInstallRoots(async (_file, args, options) => {
    queries++;
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 5000);
    assert.equal(options.encoding, 'utf8');
    assert.equal(options.maxBuffer, 16384);
    const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
    for (const fragment of [
      'CurrentUser',
      'LocalMachine',
      'Registry64',
      'Registry32',
      "OpenSubKey('Software\\GitForWindows')",
      "GetValue('InstallPath'",
      'OutputEncoding',
    ])
      assert.ok(script.includes(fragment), fragment);
    assert.doesNotMatch(script, /SetValue|DeleteSubKey|Start-Process|Set-ItemProperty/);
    return { stdout: '\uFEFF' + JSON.stringify([root, root.toUpperCase(), 'C:\\Git']), stderr: '' };
  });
  assert.equal(queries, 1);
  assert.deepEqual(found, [root, 'C:\\Git']);
});

test('malformed, network and relative registry values do not cause shell execution or false discovery', async () => {
  for (const stdout of ['bad JSON', '{}', 'null'])
    assert.deepEqual(await windowsGitInstallRoots(async () => ({ stdout, stderr: '' })), []);
  assert.deepEqual(
    await windowsGitInstallRoots(async () => ({
      stdout: JSON.stringify([
        'relative',
        'C:relative',
        '\\\\server\\share',
        '\\\\?\\C:\\Git',
        5,
        'E:/Git',
      ]),
      stderr: '',
    })),
    ['E:\\Git'],
  );
  assert.deepEqual(
    await windowsGitInstallRoots(async () => {
      throw Error('registry unavailable');
    }),
    [],
  );
});

test('custom Git Bash is found in registry even with stale PATH and reaches the private Pi environment', async () => {
  const root = "E:\\Программы O'Brien $x\\Git";
  const bash = root + '\\bin\\bash.exe';
  const git = root + '\\cmd\\git.exe';
  const env = { Path: 'C:\\Windows\\System32' };
  assert.equal(
    await findWindowsBash(
      env,
      async (path) => path === bash,
      async () => [root],
    ),
    bash,
  );
  assert.equal(
    await findGit(
      'win32',
      env,
      async (path) => path === git,
      async () => [root],
    ),
    git,
  );
  const child = piEnvironment('C:\\Pi\\node', env, 'win32', [root + '\\bin']);
  assert.deepEqual(child.PATH.split(';').slice(0, 3), [
    'C:\\Pi\\node',
    root + '\\bin',
    'C:\\Windows\\System32',
  ]);
  assert.equal(child.Path, undefined);
  assert.equal(env.Path, 'C:\\Windows\\System32');
});

test('git.exe alone cannot satisfy the Windows Git Bash check', async () => {
  const root = 'E:\\MinGit';
  const available = async (path: string) => path === root + '\\cmd\\git.exe';
  assert.equal(await findGit('win32', {}, available, async () => [root]), root + '\\cmd\\git.exe');
  await assert.rejects(
    findWindowsBash({}, available, async () => [root]),
    /Git/,
  );
  assert.equal(await gitRequirementReady('win32', {}, available, async () => [root]), false);
  assert.equal(
    await gitRequirementReady(
      'win32',
      {},
      async (path) => path === root + '\\bin\\bash.exe',
      async () => [root],
    ),
    true,
  );
});

test('portable Git cmd on PATH resolves its sibling Bash without a registry or an installer', async () => {
  const bash = 'E:\\Portable Git\\bin\\bash.exe';
  let queries = 0;
  assert.equal(
    await findWindowsBash(
      { PATH: '"E:\\Portable Git\\cmd"' },
      async (path) => path === bash,
      async () => {
        queries++;
        return [];
      },
    ),
    bash,
  );
  assert.equal(queries, 0);
});
