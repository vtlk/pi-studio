import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { privateDirectory } from '../src/main/updates/privateDirectory.ts';
import { i18n } from '../src/shared/i18n/index.ts';

const sid = 'S-1-5-21-100-200-300-1001';
test('Windows update staging resolves the current SID without PowerShell and grants only SID-based access', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-acl-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const account of ['DESKTOP\\User', "ДОМЕН\\Имя, O'Brien $x", 'WORK\\"quoted"']) {
    const calls: { file: string; args: string[] }[] = [];
    const stage = join(root, "Update O'Brien $x " + calls.length);
    await privateDirectory(stage, {
      platform: 'win32',
      env: { SystemRoot: 'D:\\Windows' },
      execute: async (file, args, options) => {
        calls.push({ file, args });
        assert.equal(options.windowsHide, true);
        assert.equal(options.timeout, 10000);
        assert.equal(options.maxBuffer, 16384);
        if (file.endsWith('whoami.exe')) {
          assert.deepEqual(args, ['/user', '/fo', 'csv', '/nh']);
          return { stdout: `"${account.replaceAll('"', '""')}","${sid}"\r\n`, stderr: '' };
        }
        assert.equal(file, 'D:\\Windows\\System32\\icacls.exe');
        assert.deepEqual(args, [
          stage,
          '/inheritance:r',
          '/grant:r',
          `*${sid}:(OI)(CI)F`,
          '*S-1-5-18:(OI)(CI)F',
        ]);
        return { stdout: '', stderr: '' };
      },
    });
    assert.equal(calls[0].file, 'D:\\Windows\\System32\\whoami.exe');
    assert.equal(calls.length, 2);
    assert.equal((await stat(stage)).isDirectory(), true);
  }
});
test('ambiguous or invalid identity output never reaches the ACL command', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-acl-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const stdout of [
    '',
    sid,
    `"Name","${sid}"\n"Other","${sid}"`,
    `"Name","${sid} /grant Everyone:F"`,
    '"Name","S-1-bad"',
  ]) {
    let calls = 0;
    await assert.rejects(
      privateDirectory(join(root, 'stage'), {
        platform: 'win32',
        execute: async (file) => {
          calls++;
          assert.ok(file.endsWith('whoami.exe'));
          return { stdout, stderr: '' };
        },
      }),
    );
    assert.equal(calls, 1);
  }
});
test('identity and ACL failures stop staging with localized messages rather than a raw subprocess command', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-acl-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = i18n.language;
  t.after(() => i18n.changeLanguage(original));
  for (const language of ['ru', 'en']) {
    await i18n.changeLanguage(language);
    for (const failing of ['whoami.exe', 'icacls.exe']) {
      const expected =
        failing === 'whoami.exe'
          ? i18n.t('error.privateDirectory.couldNotDetermineTheUpdate')
          : i18n.t('error.privateDirectory.couldNotProtectTheUpdate');
      await assert.rejects(
        privateDirectory(join(root, 'stage'), {
          platform: 'win32',
          execute: async (file) => {
            if (file.endsWith(failing)) throw Error('Command failed: hidden details');
            return { stdout: `"Name","${sid}"`, stderr: '' };
          },
        }),
        (error) =>
          error instanceof Error &&
          error.message === expected &&
          !error.message.includes('Command failed'),
      );
    }
  }
});
test('POSIX staging retains owner-only permissions and starts no Windows tools', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permission check');
  const root = await mkdtemp(join(tmpdir(), 'pistudio-acl-posix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = join(root, 'stage');
  await privateDirectory(stage, {
    platform: 'darwin',
    execute: async () => {
      throw Error('Unexpected command');
    },
  });
  assert.equal((await stat(stage)).mode & 0o777, 0o700);
});
