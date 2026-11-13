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
  const launches: { project: string; agent: string; message?: string }[] = [];
  const tasks: Promise<unknown>[] = [];
  let activated = 0;
  const host: RunHost = new RunHost({
    bridge,
    bootstraps: join(root, 'boots'),
    prepare: async (request) => {
      await hooks.prepare?.(request.projectId, request.agentId);
      const projectRoot = join(root, request.projectId),
        cwd = join(projectRoot, request.agentId);
      await mkdir(join(cwd, 'sessions'), { recursive: true });
      await mkdir(join(cwd, 'output'), { recursive: true });
      const project = { id: request.projectId, agents: [] } as unknown as WorkspaceProject;
      const run = {
        projectRoot,
        project,
        agent: {
          profile: { id: request.agentId },
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
    beforeRequest: async (run) => hooks.request?.(run),
    activateTerminal: async () => {
      activated++;
    },
    openTerminal: async (_node, script, path) => {
      const boot = JSON.parse(await readFile(path, 'utf8'));
      const envelope = await (
        await fetch(boot.url + '/context', { headers: { Authorization: 'Bearer ' + boot.token } })
      ).json();
      transports.set(`${envelope.record.projectId}/${envelope.record.agentId}`, boot);
      launches.push({
        project: envelope.record.projectId,
        agent: envelope.record.agentId,
        message: envelope.firstMessage,
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
    status,
    children,
    activated: () => activated,
  };
}

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
