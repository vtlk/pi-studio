import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadinessChecks } from '../src/main/onboarding/ReadinessChecks.ts';
import {
  OnboardingReadiness,
  type OnboardingScope,
} from '../src/main/onboarding/OnboardingReadiness.ts';
import { missingMcpExecutable } from '../src/main/onboarding/mcpExecutable.ts';
import { browserMcp, computerMcp } from '../src/shared/builtinResources.ts';
import type { ConnectionReadiness, McpReadiness } from '../src/shared/onboardingReadiness.ts';
import type { ComputerState } from '../src/shared/computer.ts';
const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise<void>((done) => setImmediate(done));
};

test('readiness checks bound concurrency, deduplicate requests, expire successes and discard late results from old scopes', async () => {
  let now = 100,
    calls = 0;
  const checks = new ReadinessChecks(() => now, 1);
  let finish!: (value: string) => void;
  checks.read(
    'a',
    'old',
    () =>
      new Promise<string>((done) => {
        finish = done;
        calls++;
      }),
    'checking',
    1000,
  );
  checks.read(
    'a',
    'old',
    async () => {
      calls++;
      return 'duplicate';
    },
    'checking',
    1000,
  );
  checks.read(
    'a',
    'new',
    async () => {
      calls++;
      return 'new';
    },
    'checking',
    1000,
  );
  checks.read(
    'removed',
    '1',
    async () => {
      throw Error('Removed queued scope ran');
    },
    'checking',
    1000,
  );
  assert.equal(calls, 1);
  checks.retain(new Set(['a']));
  finish('STALE');
  await flush();
  const read = (force = false) =>
    checks.read(
      'a',
      'new',
      async () => {
        calls++;
        return 'revoked';
      },
      'checking',
      1000,
      force,
    );
  assert.equal(read(), 'new');
  assert.equal(calls, 2);
  now += 1001;
  assert.equal(read(), 'new');
  await flush();
  assert.equal(read(), 'revoked');
  assert.equal(calls, 3);
  checks.close();
  read(true);
  assert.equal(calls, 3);
});

function fixture() {
  const observed: boolean[] = [];
  let now = 100,
    auth: ConnectionReadiness = 'not_ready',
    mcp: McpReadiness = 'needs_auth';
  let missing = false,
    revision = 'config-and-key-1',
    ready = true,
    terminal = false;
  let computer: ComputerState = {
    version: 'fixture',
    phase: 'permissions_required',
    permissions: { accessibility: false, screenRecording: false },
  };
  let browser = { headlessInstalled: false, headedInstalled: false, headedSupported: true };
  let keyStored = false,
    imageRevision = 'key-1';
  const counts = {
    mcp: 0,
    auth: 0,
    permissions: 0,
    images: 0,
    browser: 0,
    terminal: 0,
    guarded: 0,
  };
  const scope: OnboardingScope = {
    folder: '/fixture',
    agents: [
      {
        id: 'agent',
        name: 'Agent',
        enabled: true,
        instructions: [],
        skills: [],
        plugins: [],
        mcps: ['external', browserMcp.id, computerMcp.id, 'pistudio-project', 'manual'],
      },
    ],
    teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }],
    connections: [
      {
        id: 'model',
        name: 'Model',
        purpose: 'pi',
        providerId: 'test',
        endpoint: '',
        account: '',
        createdAt: 1,
      },
    ],
    resources: [
      {
        ...browserMcp,
        id: 'external',
        source: 'pi:external',
        check: { status: 'available', checkedAt: 1 },
      },
    ],
    reports: [
      {
        id: 'packet',
        teamId: 'team',
        teamName: 'Team',
        createdAt: 1,
        handoff: 'pending',
        agents: [],
        requirements: [],
        requiresImages: true,
        mcps: ['external', browserMcp.id, computerMcp.id, 'pistudio-project'].map((resourceId) => ({
          resourceId,
          authorization: { required: 'unknown', methods: [], fields: [] },
        })),
      },
    ],
  };
  const service = new OnboardingReadiness(
    {
      scope: async (folder) => {
        assert.equal(folder, scope.folder);
        return structuredClone(scope);
      },
      connection: async (folder, id) => {
        assert.equal(folder, '/fixture');
        assert.equal(id, 'model');
        counts.auth++;
        return auth;
      },
      probeMcp: async (folder, id) => {
        assert.equal(folder, '/fixture');
        assert.equal(id, 'external');
        return { revision, missing };
      },
      checkMcp: async () => {
        counts.mcp++;
        return mcp;
      },
      computer: async () => {
        counts.permissions++;
        return computer;
      },
      browser: async () => {
        counts.browser++;
        return browser;
      },
      imageRevision: async () => imageRevision,
      imageStatus: async () => ({ keyStored, authentication: 'unchecked', modelIds: [] }),
      checkImages: async () => {
        counts.images++;
        return { keyStored, authentication: 'ready', modelIds: ['image-model'] };
      },
      terminal: async () => {
        counts.terminal++;
        return terminal;
      },
      runtimeReady: () => ready,
      observeTeam: async (_folder, _packageId, ready) => {
        observed.push(ready);
      },
      run: async (action) => {
        counts.guarded++;
        return action();
      },
      windows: true,
    },
    new ReadinessChecks(() => now),
  );
  return {
    scope,
    service,
    observed,
    counts,
    ready() {
      auth = 'ready';
      mcp = 'available';
      terminal = true;
      computer = {
        version: 'fixture',
        phase: 'ready',
        permissions: { accessibility: true, screenRecording: true },
      };
      browser = { ...browser, headlessInstalled: true };
      keyStored = true;
      scope.connections.push({ ...scope.connections[0], id: 'images', purpose: 'images' });
      scope.imageTool = { connectionId: 'images', modelId: 'image-model' };
    },
    revoke() {
      auth = 'not_ready';
      mcp = 'needs_auth';
      revision = 'config-and-key-2';
      imageRevision = 'key-2';
      keyStored = false;
      computer = { version: 'fixture', phase: 'permissions_required' };
    },
    missing() {
      missing = true;
    },
    installed() {
      missing = false;
    },
    stopRuntime() {
      ready = false;
    },
    advance() {
      now += 31000;
    },
  };
}

test('native readiness checks current authorization, imported servers and builtin permissions/components, never historical available flags or manual MCPs', async () => {
  const f = fixture();
  await f.service.read('/fixture');
  await flush();
  const pending = await f.service.read('/fixture');
  assert.equal(pending.connections.model, 'not_ready');
  assert.equal(pending.mcps.external, 'needs_auth');
  assert.equal(pending.computer?.phase, 'permissions_required');
  assert.equal(pending.browser?.headlessInstalled, false);
  assert.equal(pending.terminal, 'missing');
  assert.equal(pending.images, 'not_ready');
  assert.deepEqual(Object.keys(pending.mcps), ['external']);
  const calls = f.counts.mcp;
  await f.service.read('/fixture');
  assert.equal(f.counts.mcp, calls, 'Polling does not respawn a healthy check before its TTL');
  f.ready();
  await f.service.read('/fixture', true);
  await flush();
  const complete = await f.service.read('/fixture');
  assert.equal(complete.connections.model, 'ready');
  assert.equal(complete.mcps.external, 'available');
  assert.equal(complete.computer?.phase, 'ready');
  assert.equal(complete.browser?.headlessInstalled, true);
  assert.equal(complete.terminal, 'ready');
  assert.equal(complete.images, 'ready');
  f.revoke();
  const invalidated = await f.service.read('/fixture');
  assert.equal(
    invalidated.mcps.external,
    'checking',
    'Changed config/secret revision immediately revokes old readiness',
  );
  assert.equal(invalidated.images, 'not_ready');
  await flush();
  f.advance();
  await f.service.read('/fixture');
  await flush();
  const revoked = await f.service.read('/fixture');
  assert.equal(revoked.mcps.external, 'needs_auth');
  assert.equal(revoked.connections.model, 'not_ready');
  assert.equal(revoked.computer?.phase, 'permissions_required');
  f.scope.reports = [];
  await f.service.read('/fixture', true);
  await flush();
  const unrelated = await f.service.read('/fixture');
  assert.deepEqual(unrelated.mcps, {});
  assert.equal(unrelated.computer, undefined);
  assert.equal(unrelated.browser, undefined);
  assert.equal(unrelated.images, undefined);
  f.service.close();
});

test('missing executable/config creates install readiness without executing it; preparation is mandatory and old workspace reads cannot be used', async () => {
  const f = fixture();
  f.missing();
  assert.equal((await f.service.read('/fixture')).mcps.external, 'missing');
  await flush();
  assert.equal(f.counts.mcp, 0);
  f.installed();
  await f.service.read('/fixture');
  await flush();
  assert.equal((await f.service.read('/fixture')).mcps.external, 'needs_auth');
  assert.equal(f.counts.mcp, 1);
  f.stopRuntime();
  const before = { ...f.counts };
  const blocked = await f.service.read('/fixture', true);
  await flush();
  assert.equal(blocked.connections.model, 'checking');
  assert.deepEqual(f.counts, before);
  await assert.rejects(f.service.read('/different-studio'));
  f.service.close();
});

test('executable probe checks filesystem/PATH only and respects executable permissions without launching anything', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-mcp-probe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const command = join(root, 'server');
  await writeFile(command, 'THIS MUST NEVER BE EXECUTED');
  await chmod(command, 0o755);
  assert.equal(await missingMcpExecutable({ command }, ''), false);
  assert.equal(await missingMcpExecutable({ command: 'server' }, root), false);
  assert.equal(await missingMcpExecutable({ command: join(root, 'missing') }, root), true);
  assert.equal(await missingMcpExecutable({ url: 'https://example.invalid' }, ''), false);
  if (process.platform !== 'win32') {
    await chmod(command, 0o644);
    assert.equal(await missingMcpExecutable({ command }, ''), true);
  }
});
