import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunUpdateGuard } from '../src/main/pi/RunUpdateGuard.ts';
import { assertRunsIdle } from '../src/main/pi/assertRunsIdle.ts';
import type { LiveRun } from '../src/main/pi/RunTypes.ts';
import { UpdateCoordinator } from '../src/main/updates/UpdateCoordinator.ts';
import type { VerifiedUpdate } from '../src/main/updates/githubReleases.ts';

function chats() {
  const chain = Symbol('armed');
  const live = new Map<string, LiveRun>();
  for (const [index, status] of ['waiting', 'stopped', 'error', 'ready'].entries()) {
    const projectId = `project-${index}`;
    live.set(projectId, {
      run: {
        project: { id: projectId },
        record: { projectId },
        agent: { profile: { id: 'agent' } },
      },
      status,
      request: { autoContinue: index < 3 },
      chain,
      embedded: { alive: true, state: { phase: 'ready', working: false } },
      blocked: false,
    } as unknown as LiveRun);
  }
  const chains = new Map([...live.keys()].map((key) => [key, chain]));
  const closed: string[] = [];
  const host = {
    assertIdle: () => assertRunsIdle(new Set(), new Set(), [], live.values()),
    stopAgent: async (id: string) => {
      closed.push(id);
      live.delete(id);
    },
  };
  const guard = new RunUpdateGuard(host, live, chains, () => false);
  return { live, chains, closed, guard };
}

test('idle Pi processes and dormant automatic modes allow update; real work and pending handoffs block it', async () => {
  const { live, guard, closed, chains } = chats();
  guard.assertIdle();
  const first = live.get('project-0')!;
  first.embedded!.state.working = true;
  assert.throws(() => guard.assertIdle());
  first.embedded!.state.working = false;
  first.status = 'running';
  assert.throws(() => guard.assertIdle());
  first.status = 'ready';
  assert.throws(() => guard.assertIdle(), /цепочки|chain/);
  first.blocked = true;
  guard.assertIdle();
  first.blocked = false;
  first.status = 'waiting';
  const lease = guard.hold();
  assert.throws(() => guard.assertOpen());
  assert.equal(chains.size, 0);
  await lease.drainIdle();
  assert.equal(closed.length, 4);
  lease.verify();
  lease.release();
  guard.assertOpen();
});

test('one authorized update automatically resumes after busy chat settles; unsaved edits still defer it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-idle-chat-update-'));
  const { live, guard, closed } = chats();
  const busy = live.get('project-0')!;
  busy.status = 'running';
  busy.embedded!.state.working = true;
  const order: string[] = [];
  let quits = 0;
  const update = {
    offer: { version: '0.2.0-alpha.102', bytes: 1, notes: 'Fixture', releaseUrl: '' },
    manifest: {
      schema: 1,
      appId: 'studio.pi.desktop',
      version: '0.2.0-alpha.102',
      platform: 'darwin',
      arch: 'arm64',
      minOs: '13.0.0',
      format: 'mac-zip',
      sourceCommit: 'a'.repeat(40),
      archive: {
        name: 'Pi-Studio-0.2.0-alpha.102-mac-arm64.zip',
        sha256: 'b'.repeat(64),
        bytes: 1,
        unpackedBytes: 1,
      },
    },
    archiveUrl: '',
    manifestUrl: '',
  } as VerifiedUpdate;
  const coordinator = new UpdateCoordinator({
    target: { version: '0.2.0-alpha.101', platform: 'darwin', arch: 'arm64', osVersion: '15.0.0' },
    publicKey: 'controlled fixture',
    cacheRoot: root,
    check: async () => update,
    download: async ({ destination }) => {
      await writeFile(destination, 'x');
      return { path: destination, root: 'Pi Studio.app', entryCount: 1, unpackedBytes: 1 };
    },
    installer: {
      prepare: async () => ({
        arm: async () => {
          order.push('arm');
        },
        commit: async () => {
          order.push('commit');
        },
        dispose: async () => {},
      }),
    },
    idle: () => {
      try {
        guard.assertIdle();
        return true;
      } catch {
        return false;
      }
    },
    acquire: () => {
      try {
        return guard.hold();
      } catch {
        return undefined;
      }
    },
    flushMain: async () => {
      order.push('flush');
    },
    quit: () => {
      quits++;
      order.push('quit');
    },
  });
  t.after(async () => {
    await coordinator.close();
    await rm(root, { recursive: true, force: true });
  });
  await coordinator.request();
  coordinator.report({ saved: true });
  coordinator.wake();
  assert.equal(coordinator.read().phase, 'waiting');
  assert.equal(coordinator.read().prepareToken, undefined);
  assert.deepEqual(closed, []);
  // Settled RPC and completed lifecycle persistence agree: the same process stays alive.
  busy.embedded!.state.working = false;
  busy.status = 'waiting';
  coordinator.report({ saved: false });
  coordinator.wake();
  assert.equal(coordinator.read().prepareToken, undefined);
  // Ordinary periodic renderer reports are enough; no second Update click or wake call.
  const timer = setInterval(() => {
    const state = coordinator.read();
    coordinator.report({
      saved: true,
      ...(state.prepareToken ? { token: state.prepareToken } : {}),
    });
  }, 100);
  t.after(() => clearInterval(timer));
  for (let i = 0; i < 60 && !quits; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(quits, 1);
  assert.equal(closed.length, 4);
  assert.deepEqual(order, ['flush', 'arm', 'commit', 'quit']);
});
