import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { RunChannel, SessionEventError } from '../src/main/pi/RunChannel.ts';
import { RunLifecycle } from '../src/main/pi/RunLifecycle.ts';
import { studioTerminalProfile } from '../src/main/pi/terminal-close/windowsProfile.ts';
import { checkRunLiveness } from '../src/main/pi/runLiveness.ts';
import type { LiveRun } from '../src/main/pi/RunTypes.ts';
import { sessionRequest } from '../bundled/pi-bridge/session-request.mjs';

test('Windows handshake reports a profile failure immediately without accepting a foreign terminal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-handshake-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', { value: platform }));
  const lifecycle = new RunLifecycle({} as never);
  let failure: Error | undefined;
  const live = {
    run: { record: { cwd: root, runId: 'owned' } },
    fail: (error: Error) => {
      failure = error;
    },
  } as unknown as LiveRun;
  for (const terminalIdentity of [
    undefined,
    {
      kind: 'windows-terminal',
      sessionId: '12345678-1234-1234-1234-123456789abc',
      profileId: '{11111111-1111-1111-1111-111111111111}',
    },
  ]) {
    failure = undefined;
    await assert.rejects(
      lifecycle.event(live, {
        type: 'hello',
        pid: process.pid,
        terminalIdentity: terminalIdentity as never,
      }),
      SessionEventError,
    );
    assert.ok(failure instanceof SessionEventError);
    assert.match(failure.message, /Windows Terminal/);
    assert.equal(live.pid, undefined);
  }
  const terminalIdentity = {
    kind: 'windows-terminal' as const,
    sessionId: '{12345678-1234-1234-1234-123456789abc}',
    profileId: studioTerminalProfile,
  };
  await lifecycle.event(live, { type: 'hello', pid: process.pid, terminalIdentity });
  assert.deepEqual(live.terminalIdentity, terminalIdentity);
  assert.equal(
    JSON.parse(await readFile(join(root, '.pistudio-session-lock.json'), 'utf8')).pid,
    process.pid,
  );
});

test('authenticated bridge preserves a controlled handshake reason, hides other errors and rejects stale capabilities', async (t) => {
  const channel = new RunChannel();
  t.after(() => channel.close());
  let profileError = true;
  const bootstrap = await channel.add(
    'probe',
    { resources: { mcpServers: [] } } as never,
    async () => {
      if (profileError) throw new SessionEventError('SECRET_ERROR_DETAIL');
      throw Error('SECRET_ERROR_DETAIL');
    },
    async () => ({}),
  );
  const request = sessionRequest(bootstrap);
  await assert.rejects(request('event', { type: 'hello' }), (error: Error) => {
    assert.match(error.message, /Restart Windows Terminal/);
    assert.equal(error.message.includes('SECRET_ERROR_DETAIL'), false);
    assert.equal(error.message.includes(bootstrap.token), false);
    return true;
  });
  await assert.rejects(
    sessionRequest({ ...bootstrap, language: 'ru' })('event', { type: 'hello' }),
    /Перезапустите Windows Terminal/,
  );
  profileError = false;
  await assert.rejects(request('event', { type: 'hello' }), /HTTP 400/);
  await assert.rejects(sessionRequest({ ...bootstrap, token: 'wrong' })('context'), /HTTP 403/);
  channel.remove('probe');
  await assert.rejects(request('context'), /HTTP 403/);
});

test('terminal handshake failure exits cleanly before loading SDK or creating a dialogue', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-bridge-child-'));
  const channel = new RunChannel();
  t.after(async () => {
    channel.close();
    await rm(root, { recursive: true, force: true });
  });
  const bootstrap = await channel.add(
    'child',
    { resources: { mcpServers: [] } } as never,
    async () => {
      throw new SessionEventError('SECRET_ERROR_DETAIL');
    },
    async () => ({}),
  );
  const path = join(root, 'bootstrap.json');
  await writeFile(path, JSON.stringify({ ...bootstrap, sdk: 'must-not-load' }));
  const child = spawn(process.execPath, ['bundled/pi-bridge/session.mjs', path], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let stderr = '',
    stdout = '';
  child.stderr.on('data', (bytes) => {
    stderr += bytes.toString();
  });
  child.stdout.on('data', (bytes) => {
    stdout += bytes.toString();
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 1);
  assert.match(stderr, /Restart Windows Terminal/);
  for (const privateText of [
    bootstrap.token,
    'SECRET_ERROR_DETAIL',
    'must-not-load',
    'at runSession',
  ])
    assert.equal(stderr.includes(privateText), false);
  assert.equal(stdout, '');
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('liveness gives startup its launch deadline and still retires dead or disconnected sessions', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 30_000 });
  const opening = new Set(['cold']);
  const live = new Map<string, LiveRun>([
    ['cold', { heartbeat: 5_000, pid: process.pid, run: { record: { runId: 'cold' } } } as LiveRun],
    [
      'stale',
      { heartbeat: 5_000, pid: process.pid, run: { record: { runId: 'stale' } } } as LiveRun,
    ],
  ]);
  const lost: string[] = [],
    removed: string[] = [];
  const state = {
    live,
    opening,
    retiring: new Map(),
    lifecycle: {
      processLost: async (run: LiveRun) => {
        lost.push(run.run.record.runId);
      },
    } as RunLifecycle,
    dependencies: {} as never,
    remove: (id: string) => {
      removed.push(id);
    },
  };
  await checkRunLiveness(state);
  assert.deepEqual(removed, ['stale']);
  assert.equal(
    live.has('cold'),
    true,
    'Cold Terminal/SDK startup must not lose its capability after 20 seconds',
  );
  opening.delete('cold');
  await checkRunLiveness(state);
  assert.deepEqual(
    removed,
    ['stale', 'cold'],
    'The normal heartbeat deadline resumes after opening',
  );
  live.set('dead', {
    heartbeat: 30_000,
    pid: 2_147_483_647,
    run: { record: { runId: 'dead' } },
  } as LiveRun);
  opening.add('dead');
  await checkRunLiveness(state);
  assert.deepEqual(lost, ['stale', 'cold', 'dead'], 'A proven-dead startup is retired immediately');
  assert.equal(live.size, 0);
});
