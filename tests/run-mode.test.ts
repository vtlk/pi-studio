import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { RunHost } from '../src/main/pi/RunHost.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import type { SessionBinding, WorkspaceProject } from '../src/shared/project.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check(), 'transport condition timed out');
}
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-chain-mode-')));
  const cli = join(root, 'pi'),
    bridge = join(root, 'session.mjs');
  await writeFile(
    cli,
    '#!/bin/sh\ncase "$1" in\n --version) echo 1.5.2;;\n --help) echo "pi mcp --session <path|id> --fork <path|id>";;\nesac\n',
    { mode: 0o700 },
  );
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.5.2' }),
  );
  await writeFile(
    bridge,
    `
import {readFile,writeFile} from 'node:fs/promises';
const boot=JSON.parse(await readFile(process.argv[2],'utf8'));
const headers={Authorization:'Bearer '+boot.token,'Content-Type':'application/json'};
const event=data=>fetch(boot.url+'/event',{method:'POST',headers,body:JSON.stringify(data)});
const envelope=await(await fetch(boot.url+'/context',{headers})).json();
await event({type:'hello',pid:process.pid});
const file=envelope.sessionPath||envelope.record.sessionDirectory+'/history.jsonl';
if(!envelope.sessionPath)await writeFile(file,JSON.stringify({type:'session',id:'fixture'})+'\\n');
await event({type:'bound',sessionId:'fixture',sessionFile:file});
setInterval(()=>void event({type:'heartbeat'}),1000);
process.on('SIGTERM',()=>void event({type:'stopped'}).finally(()=>process.exit(0)));
`,
  );
  const hooks: {
    prepare?: (project: string, agent: string) => Promise<void>;
    completed?: (run: PreparedRun) => Promise<void>;
    request?: (run: PreparedRun) => Promise<void>;
  } = {};
  const bindings = new Map<string, SessionBinding>();
  const status = new Map<string, string>();
  const transports = new Map<string, { url: string; token: string }>();
  const children: ChildProcess[] = [],
    exits: Promise<unknown>[] = [];
  const launches: { project: string; agent: string; message?: string; title?: string }[] = [];
  const names = { agent: 'Сценарист «А»', project: 'Проект "Б" $()' };
  const tasks: Promise<unknown>[] = [];
  const notices: (string | undefined)[] = [];
  const activatedPids: number[] = [];
  const activatedTitles: (string | undefined)[] = [];
  const host: RunHost = new RunHost({
    bridge,
    bootstraps: join(root, 'boots'),
    prepare: async (request) => {
      await hooks.prepare?.(request.projectId, request.agentId);
      const projectRoot = join(root, request.projectId),
        cwd = join(projectRoot, request.agentId);
      await mkdir(join(cwd, 'sessions'), { recursive: true });
      await mkdir(join(cwd, 'output'), { recursive: true });
      const project = {
        id: request.projectId,
        name: names.project,
        agents: [],
      } as unknown as WorkspaceProject;
      const run = {
        projectRoot,
        project,
        agent: {
          profile: { id: request.agentId, name: names.agent },
          session: bindings.get(`${request.projectId}/${request.agentId}`),
        },
        record: {
          projectId: request.projectId,
          agentId: request.agentId,
          runId: randomUUID(),
          cwd,
          sessionDirectory: join(cwd, 'sessions'),
          output: join(cwd, 'output'),
        },
        resources: {},
        instructions: '',
      } as PreparedRun;
      return { run, piPath: cli };
    },
    update: async (run, next, binding) => {
      const key = `${run.project.id}/${run.agent.profile.id}`;
      status.set(key, next);
      if (binding) bindings.set(key, binding);
      return run.project;
    },
    read: async (run) => run.project,
    failureChanged: (_run, failure) => {
      notices.push(failure);
    },
    beforeRequest: async (run) => hooks.request?.(run),
    activateTerminal: async (pid, title) => {
      activatedPids.push(pid);
      activatedTitles.push(title);
    },
    openTerminal: async (_node, script, path, title) => {
      const boot = JSON.parse(await readFile(path, 'utf8'));
      const envelope = await (
        await fetch(boot.url + '/context', { headers: { Authorization: 'Bearer ' + boot.token } })
      ).json();
      assert.equal(title, envelope.terminalTitle, 'OS tab and Pi use the same title');
      transports.set(`${envelope.record.projectId}/${envelope.record.agentId}`, boot);
      launches.push({
        project: envelope.record.projectId,
        agent: envelope.record.agentId,
        message: envelope.firstMessage,
        title,
      });
      const child = spawn(process.execPath, [script, path], { stdio: 'ignore' });
      children.push(child);
      exits.push(
        new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        }),
      );
    },
    completed: (run) => {
      const go = host.continuation(run);
      if (!go) return Promise.resolve();
      const work = (async () => {
        await hooks.completed?.(run);
        await go(
          { projectId: run.project.id, agentId: 'next', autoContinue: true },
          'new stage input',
        );
        assert.equal(
          await go({ projectId: run.project.id, agentId: 'next', autoContinue: true }, 'duplicate'),
          undefined,
        );
      })();
      tasks.push(work);
      return work;
    },
  });
  t.after(async () => {
    host.close();
    await Promise.allSettled(exits);
    await rm(root, { recursive: true, force: true });
  });
  const event = async (project: string, agent: string, data: object) => {
    const boot = transports.get(`${project}/${agent}`)!;
    return fetch(boot.url + '/event', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + boot.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  };
  const request = async (project = 'p', agent = 'first') =>
    assert.equal(
      (await event(project, agent, { type: 'request', message: 'explicit new input' })).ok,
      true,
    );
  const finish = async (project = 'p', agent = 'first') => {
    await writeFile(join(root, project, agent, 'output/result.txt'), 'validated');
    const boot = transports.get(`${project}/${agent}`)!;
    const response = await fetch(boot.url + '/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + boot.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'complete_stage', arguments: { outputs: ['result.txt'] } },
      }),
    });
    assert.equal(response.ok, true);
    assert.equal((await event(project, agent, { type: 'settled', outcome: 'completed' })).ok, true);
  };
  const launch = (autoContinue: boolean, project = 'p', agent = 'first') =>
    host.launch({
      projectId: project,
      agentId: agent,
      autoContinue,
      ...(!bindings.has(`${project}/${agent}`) ? { firstMessage: 'first input' } : {}),
    });
  return {
    host,
    hooks,
    launch,
    request,
    finish,
    event,
    launches,
    tasks,
    notices,
    status,
    children,
    activated: () => activatedPids.length,
    activatedPids,
    activatedTitles,
    names,
  };
}

test(
  'launch, running activation and exact idle resume retain titles without replaying input',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    await f.launch(false);
    assert.equal(f.launches[0].title, 'Сценарист «А» · Проект "Б" $()');
    await f.request();
    const child = f.children[0];
    await f.launch(false);
    assert.deepEqual(f.activatedPids, [child.pid]);
    assert.deepEqual(f.activatedTitles, [f.launches[0].title]);
    assert.equal(f.launches.length, 1);
    await f.finish();
    f.names.agent = 'Сцены';
    f.names.project = 'После переименования';
    await f.launch(false);
    assert.equal(f.launches[1].title, 'Сцены · После переименования');
    assert.equal(f.launches[1].message, undefined);
    f.names.agent = 'Монтаж';
    f.names.project = 'Второй проект';
    await f.launch(false, 'other', 'second');
    assert.equal(f.launches[2].title, 'Монтаж · Второй проект');
    assert.equal(f.children[1].exitCode, null, 'The other dialogue stays open');
  },
);

test(
  'a next-stage preparation refusal reports the paused chain without losing prior readiness',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    let attempts = 0;
    f.hooks.prepare = async (_project, agent) => {
      if (agent === 'next') {
        attempts++;
        throw new Error('PRIVATE_NEXT_AGENT_AUTH_ERROR');
      }
    };
    await f.launch(true);
    await f.request();
    await f.finish();
    await until(() => f.notices.includes('continuation'));
    assert.equal(f.status.get('p/first'), 'ready');
    assert.equal(f.launches.length, 1);
    assert.equal(attempts, 1);
    assert.equal(JSON.stringify(f.notices).includes('PRIVATE'), false);
    await f.event('p', 'first', { type: 'stopped' });
    await until(() => f.status.get('p/first') === 'ready');
    await f.request();
    await f.finish();
    assert.equal(attempts, 1, 'A failed chain must stay disarmed on subsequent input');
    assert.equal(f.status.get('p/first'), 'ready');
  },
);

test(
  'clearing output cancels a pending chain and readiness without killing the bound dialogue',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    f.hooks.completed = async (run) => {
      const file = join(run.record.sessionDirectory, 'history.jsonl');
      const before = await readFile(file);
      f.host.outputsCleared(run.project.id, run.agent.profile.id);
      assert.equal(f.host.continuation(run), undefined);
      assert.deepEqual(await readFile(file), before);
    };
    await f.launch(true);
    await f.request();
    assert.throws(() => f.host.assertIdle('p'), /Дождитесь завершения/);
    await f.finish();
    await Promise.all(f.tasks);
    assert.equal(f.launches.length, 1, 'No next stage after outputs were cleared');
    await f.event('p', 'first', { type: 'stopped' });
    await until(() => f.status.get('p/first') === 'idle');
    assert.equal(f.children[0].exitCode, null);
  },
);

test(
  'ordinary opening of a running dialogue disables the chain; rearming waits for a new request',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    await f.launch(true);
    await f.request();
    const child = f.children[0];
    await f.launch(false);
    assert.equal(f.activated(), 1);
    assert.equal(f.activatedPids[0], child.pid);
    assert.equal(f.children.length, 1);
    assert.equal(child.exitCode, null);
    await f.finish();
    assert.equal(f.tasks.length, 0);
    await f.request();
    await f.launch(true);
    await f.finish();
    assert.equal(
      f.tasks.length,
      0,
      'Dropdown while running must not promote the in-flight old request',
    );
    const gate = deferred();
    f.hooks.completed = async () => gate.promise;
    await f.request();
    await f.finish();
    assert.equal(f.tasks.length, 1);
    await f.launch(false);
    gate.resolve();
    await f.tasks[0];
    assert.equal(
      f.launches.filter((item) => item.agent === 'next').length,
      0,
      'A delayed completion must not undo manual cancellation',
    );
    assert.equal(f.launches[1].message, undefined, 'Ordinary resume never sends a user message');
  },
);

test(
  'manual intent cancels a handoff already preparing another agent; other projects remain independent',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t),
      gate = deferred();
    let preparing = false;
    f.hooks.prepare = async (project, agent) => {
      if (project === 'p' && agent === 'next') {
        preparing = true;
        await gate.promise;
      }
    };
    await f.launch(true);
    await f.request();
    await f.finish();
    await until(() => preparing);
    await f.launch(false);
    await f.launch(true, 'other');
    await f.request('other');
    await f.finish('other');
    gate.resolve();
    await Promise.all(f.tasks);
    assert.equal(
      f.launches.filter((item) => item.project === 'p' && item.agent === 'next').length,
      0,
    );
    assert.equal(
      f.launches.filter((item) => item.project === 'other' && item.agent === 'next').length,
      1,
    );
    assert.equal(
      f.launches.find((item) => item.project === 'other' && item.agent === 'next')?.message,
      'new stage input',
    );
  },
);

test(
  'cancellation during automatic request admission never sends generation and closes only the idle target',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t),
      gate = deferred();
    let admitting = false;
    f.hooks.request = async (run) => {
      if (run.agent.profile.id === 'next') {
        admitting = true;
        await gate.promise;
      }
    };
    await f.launch(true);
    await f.request();
    await f.finish();
    await until(() => f.launches.some((item) => item.agent === 'next'));
    await f.tasks[0];
    const response = f.event('p', 'next', {
      type: 'request',
      message: 'automatic input waiting for admission',
    });
    await until(() => admitting);
    await f.launch(false);
    gate.resolve();
    assert.equal((await response).ok, false);
    await until(() => f.children[1].exitCode !== null);
    assert.notEqual(f.status.get('p/next'), 'running');
    assert.equal(
      f.children[2].exitCode,
      null,
      'The manually reopened source dialogue must remain open',
    );
  },
);

test(
  'manual requests of different agents in one project run concurrently while project mutations stay guarded',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    await f.launch(false, 'p', 'first');
    await f.request('p', 'first');
    await f.launch(false, 'p', 'second');
    await f.request('p', 'second');
    assert.equal(f.status.get('p/first'), 'running');
    assert.equal(f.status.get('p/second'), 'running');
    assert.throws(() => f.host.assertIdle('p'), /Дождитесь/);
    await f.launch(false, 'p', 'first');
    assert.equal(f.children.length, 2, 'Reopening an active agent activates its existing dialogue');
    assert.equal(f.activated(), 1);
    assert.equal(f.activatedPids[0], f.children[0].pid);
    await f.finish('p', 'first');
    assert.equal(f.status.get('p/first'), 'ready');
    assert.equal(f.status.get('p/second'), 'running');
    assert.throws(() => f.host.assertIdle('p'), /Дождитесь/);
    await f.request('p', 'second');
    await f.finish('p', 'second');
    assert.equal(f.status.get('p/second'), 'ready');
    f.host.assertIdle('p');
    assert.equal(f.launches.length, 2);
  },
);

test(
  'opening a separate manual agent preserves the running automatic chain',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    await f.launch(true);
    await f.request();
    await f.launch(false, 'p', 'side');
    await f.request('p', 'side');
    await f.finish();
    await Promise.all(f.tasks);
    assert.equal(f.launches.filter((l) => l.agent === 'next').length, 1);
    assert.equal(f.status.get('p/side'), 'running');
    assert.equal(f.children[1].exitCode, null);
  },
);

test(
  'a legacy terminal chain does not replace an independently opened next dialogue',
  { timeout: 15000 },
  async (t) => {
    for (const running of [false, true]) {
      const f = await fixture(t);
      await f.launch(false, 'p', 'next');
      if (running) await f.request('p', 'next');
      const child = f.children[0];
      await f.launch(true);
      await f.request();
      await f.finish();
      await until(() => f.notices.includes('continuation'));
      await Promise.allSettled(f.tasks);
      assert.equal(f.status.get('p/first'), 'ready');
      assert.equal(child.exitCode, null, 'Manually opened Pi remains alive');
      assert.equal(f.launches.length, 2, 'No automatic second instance or message');
      await f.request('p', 'next');
      await f.finish('p', 'next');
    }
  },
);

test(
  'update lease rejects active work/chains and new transport requests; idle cleanup preserves exact resume',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    await f.launch(true);
    const dormant = f.host.updates.hold();
    dormant.verify();
    dormant.release(); // An idle armed dialogue is no longer active chain work.
    await f.launch(false);
    await f.request();
    assert.throws(() => f.host.updates.hold(), /Дождитесь/);
    await f.finish();
    const before = f.launches.length;
    const lease = f.host.updates.hold();
    await assert.rejects(f.launch(false, 'p', 'other'), /обновление/);
    const denied = await f.event('p', 'first', {
      type: 'request',
      message: 'must not be admitted',
    });
    assert.equal(denied.ok, false);
    assert.equal(f.status.get('p/first'), 'ready');
    assert.equal(f.launches.length, before);
    lease.verify();
    await lease.drainIdle();
    lease.release();
    await assert.rejects(lease.drainIdle(), /завершено/);
    await f.launch(false);
    assert.equal(
      f.launches.at(-1).message,
      undefined,
      'Resume sends no new input after a cancelled update',
    );
    const current = f.host.updates.hold();
    lease.release();
    await assert.rejects(f.launch(false, 'p', 'other'), /обновление/);
    current.release();
  },
);

test(
  'a closed automatic Pi leaves no active update blocker or reusable continuation permission',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    await f.launch(true);
    const child = f.children.at(-1)!;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await exited;
    await until(() => {
      try {
        f.host.updates.assertIdle();
        return true;
      } catch {
        return false;
      }
    });
    const lease = f.host.updates.hold();
    lease.verify();
    lease.release();
    assert.equal(f.launches.length, 1);
  },
);
