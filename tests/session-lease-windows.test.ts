import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hasLiveSessionLease } from '../src/main/storage/sessionLease.ts';
import { windowsSessionProcess } from '../src/main/storage/windowsSessionProcess.ts';

const pid = 12345,
  runId = 'test-existing-dialogue';
const command = `node.exe C:/PiStudio/session.mjs C:/Bootstraps/${runId}.json`;
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-lease-windows-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '.pistudio-session-lock.json'), JSON.stringify({ pid, runId }));
  return root;
}
const noShell = async () => {
  throw Error('PowerShell/CIM must never run for Windows lease checks');
};

test('a proven dead Pi PID skips native queries and preserves the lease file', async (t) => {
  const root = await fixture(t),
    before = await readFile(join(root, '.pistudio-session-lock.json'));
  assert.equal(
    await hasLiveSessionLease(root, {
      platform: 'win32',
      exists: () => false,
      execute: noShell,
      windowsProcess: async () => {
        throw Error('Dead PID needs no query');
      },
    }),
    false,
  );
  assert.deepEqual(await readFile(join(root, '.pistudio-session-lock.json')), before);
});
test('a live Windows Pi is matched to its exact PID and command without PowerShell, even when CIM is broken', async (t) => {
  const root = await fixture(t);
  assert.equal(
    await hasLiveSessionLease(root, {
      platform: 'win32',
      exists: () => true,
      execute: noShell,
      windowsProcess: async (id) => {
        assert.equal(id, pid);
        return { pid, commandLine: command };
      },
    }),
    true,
  );
  assert.equal(
    await hasLiveSessionLease(root, {
      platform: 'win32',
      exists: () => true,
      execute: noShell,
      windowsProcess: async () => ({ pid, commandLine: 'other.exe' }),
    }),
    false,
  );
});
test('a complete native snapshot resolves stale/reused Windows PIDs without deleting a lease or histories', async (t) => {
  const root = await fixture(t),
    before = await readFile(join(root, '.pistudio-session-lock.json'));
  for (const exists of [() => true, () => undefined])
    assert.equal(
      await hasLiveSessionLease(root, {
        platform: 'win32',
        exists,
        execute: noShell,
        windowsProcess: async () => null,
      }),
      false,
    );
  assert.deepEqual(await readFile(join(root, '.pistudio-session-lock.json')), before);
});
test('native query failures or an inaccessible command line never authorize opening a second Pi', async (t) => {
  const root = await fixture(t);
  for (const windowsProcess of [
    async () => {
      throw Error('Native query failed');
    },
    async () => ({ pid, commandLine: '' }),
    async () => ({ pid: 999, commandLine: command }),
  ])
    await assert.rejects(
      hasLiveSessionLease(root, {
        platform: 'win32',
        exists: () => true,
        execute: noShell,
        windowsProcess,
      }),
    );
});
test('a process exiting during native inspection is recognized as closed', async (t) => {
  const root = await fixture(t);
  let checks = 0;
  assert.equal(
    await hasLiveSessionLease(root, {
      platform: 'win32',
      exists: () => ++checks === 1,
      execute: noShell,
      windowsProcess: async () => {
        throw Error('Process exited');
      },
    }),
    false,
  );
});
test('native snapshot requires its own PID as proof of a complete enumeration', async () => {
  for (const rows of [[], [{ pid: pid, commandLine: command }]])
    await assert.rejects(
      windowsSessionProcess(pid, { selfPid: 42, snapshot: (cb) => cb(rows) }),
      /incomplete/,
    );
  assert.equal(
    await windowsSessionProcess(pid, { selfPid: 42, snapshot: (cb) => cb([{ pid: 42 }]) }),
    null,
  );
  assert.deepEqual(
    await windowsSessionProcess(pid, {
      selfPid: 42,
      snapshot: (cb, flags) => {
        assert.equal(flags, 2);
        cb([{ pid: 42 }, { pid, commandLine: command }]);
      },
    }),
    { pid, commandLine: command },
  );
});
test('native snapshot rejects ambiguity, inaccessible command lines, hung callbacks and a missing DLL', async () => {
  for (const rows of [
    [{ pid: 42 }, { pid }, { pid }],
    [{ pid: 42 }, { pid, commandLine: '' }],
  ])
    await assert.rejects(windowsSessionProcess(pid, { selfPid: 42, snapshot: (cb) => cb(rows) }));
  await assert.rejects(
    windowsSessionProcess(pid, { timeout: 10, snapshot: () => {} }),
    /timed out/,
  );
  await assert.rejects(
    windowsSessionProcess(pid, {
      snapshot: () => {
        throw Error('DLL missing');
      },
    }),
    /DLL missing/,
  );
});

test('production Microsoft JS adapter passes the command-line flag into the native snapshot API', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const exports: Record<string, unknown> = {};
  const native = {
    getProcessList(callback: (rows: unknown[]) => void, flags: number) {
      assert.equal(flags, 2);
      setImmediate(() => callback([{ pid: 42 }, { pid, commandLine: command }]));
    },
  };
  runInNewContext(
    await readFile('node_modules/@vscode/windows-process-tree/lib/index.js', 'utf8'),
    {
      exports,
      module: { exports },
      process: { platform: 'win32' },
      require: (name: string) => (name === 'util' ? require('node:util') : native),
    },
  );
  const snapshot = exports.getAllProcesses as NonNullable<
    Parameters<typeof windowsSessionProcess>[1]
  >['snapshot'];
  assert.deepEqual(await windowsSessionProcess(pid, { selfPid: 42, snapshot }), {
    pid,
    commandLine: command,
  });
});

test('native failures are localized and give a bounded diagnostic code without command lines or paths', async (t) => {
  const { changeLanguage } = await import('../src/shared/i18n/index.ts');
  const { WindowsProcessQueryError } = await import('../src/main/storage/windowsSessionProcess.ts');
  const root = await fixture(t);
  t.after(() => changeLanguage('ru'));
  for (const language of ['ru', 'en'] as const) {
    await changeLanguage(language);
    await assert.rejects(
      hasLiveSessionLease(root, {
        platform: 'win32',
        exists: () => true,
        windowsProcess: async () => {
          throw new WindowsProcessQueryError('access', 'UNTRUSTED_COMMAND_AND_SECRET');
        },
      }),
      (error: Error) => {
        assert.match(error.message, /native_access/);
        assert.match(error.message, /12345/);
        assert.doesNotMatch(error.message, /UNTRUSTED_COMMAND_AND_SECRET/);
        assert.match(error.message, language === 'ru' ? /не разрешила/ : /did not allow/);
        return true;
      },
    );
  }
});
