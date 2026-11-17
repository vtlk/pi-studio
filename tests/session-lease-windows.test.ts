import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hasLiveSessionLease } from '../src/main/storage/sessionLease.ts';

const pid = 12345,
  runId = 'test-existing-dialogue';
const command = `node.exe C:/PiStudio/session.mjs C:/Bootstraps/${runId}.json`;
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-lease-windows-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, '.pistudio-session-lock.json'), JSON.stringify({ pid, runId }));
  return root;
}

test('a proven dead Pi PID skips cold PowerShell/CIM entirely and preserves the lease file', async (t) => {
  const root = await fixture(t);
  const before = await readFile(join(root, '.pistudio-session-lock.json'));
  assert.equal(
    await hasLiveSessionLease(root, {
      platform: 'win32',
      exists: () => false,
      execute: async () => {
        throw Error('CIM must not run for a dead process');
      },
    }),
    false,
  );
  assert.deepEqual(await readFile(join(root, '.pistudio-session-lock.json')), before);
});

test('a live Windows Pi process requires matching PID and exact run command, with a cold-start budget', async (t) => {
  const root = await fixture(t);
  assert.equal(
    await hasLiveSessionLease(root, {
      platform: 'win32',
      exists: () => true,
      execute: async (_, args, options) => {
        assert.equal(options.timeout, 15000);
        assert.equal(options.windowsHide, true);
        const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
        assert.ok(script.includes(`ProcessId = ${pid}`));
        return { stdout: JSON.stringify({ ProcessId: pid, CommandLine: command }) };
      },
    }),
    true,
  );
  assert.equal(
    await hasLiveSessionLease(root, {
      platform: 'win32',
      exists: () => true,
      execute: async () => ({
        stdout: JSON.stringify({ ProcessId: pid, CommandLine: 'other.exe' }),
      }),
    }),
    false,
  );
});

test('Windows query failures, missing command lines and timeouts never imply that a live dialogue is closed', async (t) => {
  const root = await fixture(t);
  for (const failure of [
    Object.assign(Error('CIM denied'), { code: 1 }),
    Object.assign(Error('cold start timed out'), { killed: true }),
  ])
    await assert.rejects(
      hasLiveSessionLease(root, {
        platform: 'win32',
        exists: () => true,
        execute: async () => {
          throw failure;
        },
      }),
    );
  for (const value of [
    null,
    { ProcessId: pid, CommandLine: null },
    { ProcessId: 999, CommandLine: command },
  ])
    await assert.rejects(
      hasLiveSessionLease(root, {
        platform: 'win32',
        exists: () => true,
        execute: async () => ({ stdout: JSON.stringify(value) }),
      }),
    );
});

test('a process exiting during CIM inspection is safely recognized as closed', async (t) => {
  const root = await fixture(t);
  let checks = 0;
  assert.equal(
    await hasLiveSessionLease(root, {
      platform: 'win32',
      exists: () => ++checks === 1,
      execute: async () => ({ stdout: '' }),
    }),
    false,
  );
});

test('an inconclusive native liveness probe still uses the command identity rather than bypassing the lock', async (t) => {
  const root = await fixture(t);
  assert.equal(
    await hasLiveSessionLease(root, {
      platform: 'win32',
      exists: () => undefined,
      execute: async () => ({ stdout: JSON.stringify({ ProcessId: pid, CommandLine: command }) }),
    }),
    true,
  );
});
