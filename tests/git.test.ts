import test from 'node:test';
import assert from 'node:assert/strict';
import { findGit } from '../src/main/pi/git.ts';
import { piEnvironment } from '../src/main/pi/platform.ts';

test('Git installed per user on Windows is found with stale PATH and is available to new Pi children', async () => {
  const input = {
    Path: 'C:\\Windows\\System32',
    LOCALAPPDATA: "D:\\Users\\O'Brien Тест\\AppData\\Local",
  };
  const installed = "D:\\Users\\O'Brien Тест\\AppData\\Local\\Programs\\Git\\cmd\\git.exe";
  assert.equal(await findGit('win32', input, async (file) => file === installed), installed);
  const env = piEnvironment('C:\\Pi\\node', input, 'win32');
  assert.ok(env.PATH.split(';').includes(installed.slice(0, -8)));
  assert.equal(env.Path, undefined);
  assert.equal(input.Path, 'C:\\Windows\\System32');
});

test('Git supports quoted portable Windows paths and reports missing installations', async () => {
  const input = {
    PATH: '"E:\\Portable Git\\cmd";E:\\PORTABLE GIT\\cmd',
    ProgramFiles: 'C:\\Program Files',
  };
  const probes: string[] = [];
  assert.equal(
    await findGit('win32', input, async (file) => {
      probes.push(file);
      return false;
    }),
    undefined,
  );
  assert.equal(probes.filter((file) => /portable/i.test(file)).length, 1);
  assert.equal(
    await findGit('win32', input, async (file) => file.startsWith('E:')),
    'E:\\Portable Git\\cmd\\git.exe',
  );
});

test('macOS git shim cannot complete onboarding without installed developer tools; no program is executed', async () => {
  const probes: string[] = [];
  const env = { PATH: '/usr/bin:/opt/homebrew/bin:.' };
  assert.equal(
    await findGit('darwin', env, async (file) => {
      probes.push(file);
      return false;
    }),
    undefined,
  );
  assert.equal(probes.includes('/usr/bin/git'), false);
  const actual = '/Library/Developer/CommandLineTools/usr/bin/git';
  assert.equal(await findGit('darwin', env, async (file) => file === actual), actual);
  assert.equal(
    await findGit('linux', { PATH: '/usr/bin' }, async (file) => file === '/usr/bin/git'),
    '/usr/bin/git',
  );
});
