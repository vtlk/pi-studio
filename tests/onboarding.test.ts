import test from 'node:test';
import assert from 'node:assert/strict';
import {
  onboardingTasks,
  reconcileOnboarding,
  completedTaskLifetime,
  parseOnboardingRecords,
} from '../src/shared/onboarding.ts';
import { describeMcpAuthorization, parseMcpAuthorization } from '../src/shared/mcpAuthorization.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { Connection } from '../src/shared/connections.ts';
import type { Resource } from '../src/shared/resources.ts';
import type { TeamImportReport } from '../src/shared/teamPackage.ts';
import { teamMcpSetupPrompt } from '../src/main/teams/handoffTeamImport.ts';
import { parseUpdateView } from '../src/main/updates/UpdateViewStore.ts';
import type { OnboardingReadiness } from '../src/shared/onboardingReadiness.ts';
import { browserMcp, computerMcp } from '../src/shared/builtinResources.ts';

const connection: Connection = {
  id: 'local',
  name: 'Local',
  providerId: 'receiver',
  purpose: 'pi',
  endpoint: '',
  account: '',
  createdAt: 1,
};
const agent: Agent = {
  id: 'agent',
  name: 'Agent',
  enabled: true,
  skills: [],
  mcps: ['mcp'],
  plugins: [],
  instructions: [],
};
const ready = (value: Agent): Agent => ({
  ...value,
  model: {
    connectionId: connection.id,
    provider: connection.providerId,
    id: 'receiver-model',
    reasoning: 'off',
    temperature: '',
  },
});
const team = { id: 'team', name: 'Team', agentIds: [agent.id] };
const resource: Resource = {
  id: 'mcp',
  name: 'Server',
  kind: 'mcps',
  source: 'pi:server',
  version: '',
  description: '',
  transport: 'http',
  args: '',
  credential: '',
  contents: '',
  createdAt: 1,
};
const report: TeamImportReport = {
  id: 'import',
  teamId: team.id,
  teamName: team.name,
  createdAt: 1,
  handoff: 'pending',
  agents: [],
  requirements: ['Old import-time warning'],
  mcps: [
    { resourceId: resource.id, authorization: { required: 'yes', methods: ['oauth'], fields: [] } },
  ],
};

test('fresh startup detects missing connection and every model, including disabled profiles and assistant; no manual completion state', () => {
  const assistant = { ...agent, id: 'assistant', name: 'Assistant', mcps: [], enabled: false };
  const tasks = onboardingTasks([agent, assistant], [team], [], [], []);
  assert.deepEqual(
    tasks.filter((task) => !task.complete).map((task) => task.id),
    ['connection', 'agent:agent', 'agent:assistant'],
  );
  const configured = onboardingTasks(
    [ready(agent), ready(assistant)],
    [team],
    [connection],
    [],
    [],
  );
  assert.ok(configured.every((task) => task.complete));
  assert.equal(
    onboardingTasks([ready(agent)], [team], [{ ...connection, providerId: 'different' }], [], [])[1]
      .complete,
    false,
  );
  assert.equal(
    onboardingTasks([ready(agent)], [team], [{ ...connection, purpose: 'images' }], [], [])[1]
      .complete,
    false,
  );
  assert.equal(onboardingTasks([ready(agent)], [team], [], [], [])[1].complete, false);
  const noReasoning = { ...ready(agent), model: { ...ready(agent).model!, reasoning: '' } };
  assert.equal(onboardingTasks([noReasoning], [team], [connection], [], [])[1].complete, false);
});

test('MCP completion follows native checks, not the import report or credential label; current assignments and deletion are respected', () => {
  const candidates = (resources: Resource[], reports = [report]) =>
    onboardingTasks([ready(agent)], [team], [connection], resources, reports);
  assert.equal(
    candidates([{ ...resource, credential: 'keychain:pistudio-mcp' }]).at(-1)?.complete,
    false,
  );
  assert.equal(
    candidates([{ ...resource, check: { status: 'available', checkedAt: 10 } }]).at(-1)?.complete,
    true,
  );
  assert.equal(
    candidates([{ ...resource, check: { status: 'needs_auth', checkedAt: 11 } }]).at(-1)?.complete,
    false,
  );
  assert.equal(candidates([]).at(-1)?.complete, false);
  assert.equal(
    candidates([resource], [report, { ...report, id: 'another' }]).filter((task) => task.resourceId)
      .length,
    1,
  );
  assert.equal(
    onboardingTasks(
      [{ ...ready(agent), mcps: [] }],
      [team],
      [connection],
      [resource],
      [report],
    ).filter((task) => task.resourceId).length,
    0,
  );
  assert.equal(
    onboardingTasks(
      [{ ...ready(agent), capabilitySettings: { 'mcps:mcp': { enabled: false } } }],
      [team],
      [connection],
      [resource],
      [report],
    ).filter((task) => task.resourceId).length,
    0,
  );
  assert.equal(
    onboardingTasks([ready(agent)], [], [connection], [resource], [report]).filter(
      (task) => task.resourceId,
    ).length,
    0,
  );
  const unknown = {
    ...report,
    mcps: [
      {
        resourceId: resource.id,
        authorization: { required: 'unknown' as const, methods: [], fields: [] },
      },
    ],
  };
  assert.equal(candidates([resource], [unknown]).at(-1)?.kind, 'mcp-check');
  assert.equal(
    candidates([{ ...resource, check: { status: 'needs_auth', checkedAt: 12 } }], [unknown]).at(-1)
      ?.kind,
    'mcp-auth',
  );
});

test('pending tasks never expire; completions survive restart for two hours and become pending again when settings regress', () => {
  const pending = onboardingTasks([agent], [team], [], [], []);
  const start = 1_000_000;
  const initial = reconcileOnboarding([], pending, start);
  assert.equal(initial.length, 2);
  assert.deepEqual(
    reconcileOnboarding(initial, pending, start + completedTaskLifetime * 100),
    initial,
  );
  const configured = onboardingTasks([ready(agent)], [team], [connection], [], []);
  assert.deepEqual(
    reconcileOnboarding([], configured, start),
    [],
    'No fake completed tasks on a ready startup',
  );
  const completed = reconcileOnboarding(initial, configured, start + 1);
  assert.ok(completed.every((record) => record.completedAt === start + 1));
  const restarted = parseOnboardingRecords(JSON.parse(JSON.stringify(completed)));
  assert.equal(reconcileOnboarding(restarted, configured, start + completedTaskLifetime).length, 2);
  assert.equal(
    reconcileOnboarding(restarted, configured, start + 1 + completedTaskLifetime).length,
    0,
  );
  assert.deepEqual(reconcileOnboarding(restarted, pending, start + 2), initial);
  assert.equal(
    reconcileOnboarding(initial, pending.slice(0, 1), start + 2).length,
    1,
    'Deleted targets disappear',
  );
  assert.deepEqual(
    parseOnboardingRecords([
      { id: 'bad', completedAt: 'yesterday' },
      null,
      { id: 'ok' },
      { id: 'ok' },
    ]),
    [{ id: 'ok' }],
  );
});

test('portable authorization metadata contains requirements and field names only, preserving unknown instead of guessing anonymous access', () => {
  const metadata = describeMcpAuthorization({
    url: 'https://example.invalid/mcp',
    headers: { Authorization: '${API_TOKEN}', Accept: 'application/json' },
    env: { PRIVATE: '${KEY}' },
    oauth: { clientSecret: '${SECRET}' },
  });
  assert.equal(metadata.required, 'yes');
  assert.deepEqual(metadata.methods, ['oauth', 'parameters']);
  assert.deepEqual(metadata.fields, [
    { section: 'env', name: 'PRIVATE' },
    { section: 'headers', name: 'Authorization' },
    { section: 'oauth', name: 'clientSecret' },
  ]);
  assert.equal(JSON.stringify(metadata).includes('API_TOKEN'), false);
  assert.deepEqual(parseMcpAuthorization(metadata), metadata);
  assert.equal(
    describeMcpAuthorization({ url: 'https://example.invalid/mcp' }).required,
    'unknown',
  );
  assert.equal(describeMcpAuthorization({ command: 'server' }).required, 'unknown');
  assert.equal(
    describeMcpAuthorization({ command: 'server', env: { NODE_ENV: 'production' } }).required,
    'unknown',
    'An ordinary environment parameter does not prove an authorization requirement',
  );
  assert.deepEqual(
    describeMcpAuthorization(
      { url: 'https://example.invalid' },
      { status: 'needs_auth', checkedAt: 1 },
    ).methods,
    ['oauth'],
  );
  assert.deepEqual(describeMcpAuthorization({ auth: { provider: 'test' } }).methods, ['provider']);
  assert.throws(() => parseMcpAuthorization({ required: 'no', methods: ['oauth'], fields: [] }));
  assert.throws(() =>
    parseMcpAuthorization({ required: 'yes', methods: ['oauth'], fields: [], token: 'SECRET' }),
  );
  assert.throws(() =>
    parseMcpAuthorization({
      required: 'yes',
      methods: ['parameters'],
      fields: [{ section: 'env', name: 'KEY', value: 'SECRET' }],
    }),
  );
});

test('assistant task is scoped to exact team/package and explicitly excludes model selection and production launches', () => {
  const prompt = teamMcpSetupPrompt('Same name', 'exact-team', 'exact-import');
  assert.ok(prompt.includes('exact-team'));
  assert.ok(prompt.includes('exact-import'));
  assert.ok(prompt.includes('Same name'));
  assert.match(prompt, /Не выбирай|Do not choose/);
  assert.match(prompt, /не запускай производственных агентов|do not launch production agents/i);
});

test('update view preserves Onboarding and rejects arbitrary pages', () => {
  assert.deepEqual(parseUpdateView({ page: 'onboarding' }), {
    page: 'onboarding',
    projectId: undefined,
  });
  assert.deepEqual(parseUpdateView({ page: 'unknown' }), { page: 'projects' });
});

test('creation tasks are last, exclude the service assistant, disappear immediately and never add a Play task', () => {
  const assistant = {
    ...ready(agent),
    id: 'assistant',
    mcps: [],
    systemRole: 'assistant' as const,
  };
  const state: OnboardingReadiness = {
    folder: '/fixture',
    terminal: 'ready',
    connections: { [connection.id]: 'ready' },
    mcps: {},
  };
  const start = onboardingTasks([assistant], [], [connection], [], [], {
    readiness: state,
    projectCount: 0,
  });
  assert.deepEqual(
    start.slice(-3).map((task) => [task.kind, task.complete]),
    [
      ['create-team', false],
      ['create-agent', false],
      ['create-project', false],
    ],
  );
  const initial = reconcileOnboarding([], start, 1);
  const withTeam = onboardingTasks([assistant], [team], [connection], [], [], {
    readiness: state,
    projectCount: 0,
  });
  assert.equal(
    reconcileOnboarding(initial, withTeam, 2).some((task) => task.id === 'create-team'),
    false,
  );
  const complete = onboardingTasks([assistant, ready(agent)], [team], [connection], [], [], {
    readiness: state,
    projectCount: 1,
  });
  assert.deepEqual(reconcileOnboarding(initial, complete, 3), []);
  assert.equal(
    complete.some((task) => String(task.kind).includes('play')),
    false,
  );
  const imagesOnly = onboardingTasks(
    [assistant],
    [],
    [{ ...connection, purpose: 'images' }],
    [],
    [],
  );
  assert.equal(imagesOnly.find((task) => task.id === 'connection')?.complete, false);
});

test('authorization is independent of a saved connection; imported built-ins follow live permissions/components and manual resources stay out', () => {
  const profile = { ...ready(agent), mcps: ['mcp', browserMcp.id, computerMcp.id, 'manual'] };
  const imported: TeamImportReport = {
    ...report,
    mcps: [
      ...report.mcps!,
      ...[browserMcp.id, computerMcp.id, 'pistudio-project'].map((resourceId) => ({
        resourceId,
        authorization: { required: 'no' as const, methods: [], fields: [] },
      })),
    ],
  };
  const state: OnboardingReadiness = {
    folder: '/fixture',
    terminal: 'missing',
    connections: { [connection.id]: 'not_ready' },
    mcps: { mcp: 'missing' },
    computer: { version: 'qa', phase: 'permissions_required' },
    browser: { headedInstalled: false, headlessInstalled: false, headedSupported: true },
    images: 'not_ready',
  };
  const candidates = () =>
    onboardingTasks(
      [profile],
      [team],
      [connection],
      [{ ...resource, check: { status: 'available', checkedAt: 1 } }],
      [imported],
      { readiness: state, projectCount: 0 },
    );
  let tasks = candidates();
  assert.equal(tasks.find((task) => task.id === `connection:${connection.id}`)?.complete, false);
  assert.equal(tasks.find((task) => task.id === 'mcp:mcp')?.kind, 'mcp-install');
  assert.equal(tasks.find((task) => task.kind === 'computer')?.complete, false);
  assert.equal(tasks.find((task) => task.kind === 'browser')?.complete, false);
  assert.equal(
    tasks.some((task) => task.resourceId === 'manual' || task.resourceId === 'pistudio-project'),
    false,
  );
  state.terminal = 'ready';
  state.connections[connection.id] = 'ready';
  state.mcps.mcp = 'available';
  state.computer = { version: 'qa', phase: 'ready' };
  state.browser.headlessInstalled = true;
  state.images = 'ready';
  tasks = candidates();
  assert.ok(
    tasks.filter((task) => !task.kind.startsWith('create-')).every((task) => task.complete),
  );
  state.computer.phase = 'permissions_required';
  state.mcps.mcp = 'needs_auth';
  assert.equal(candidates().find((task) => task.kind === 'computer')?.complete, false);
  assert.equal(candidates().find((task) => task.id === 'mcp:mcp')?.complete, false);
  assert.equal(
    onboardingTasks([profile], [team], [connection], [], [], {
      readiness: { ...state, computer: undefined, browser: undefined, images: undefined },
      projectCount: 1,
    }).some((task) => task.resourceId),
    false,
  );
});

test('a background recheck preserves the original completion time, but confirmed revocation resets it', () => {
  const pending = {
    id: 'mcp:server',
    kind: 'mcp-check' as const,
    name: 'Server',
    complete: false,
    checking: true,
  };
  const history = [{ id: pending.id, completedAt: 123 }];
  assert.deepEqual(reconcileOnboarding(history, [pending], 500), history);
  assert.deepEqual(reconcileOnboarding(history, [{ ...pending, checking: false }], 500), [
    { id: pending.id },
  ]);
});
