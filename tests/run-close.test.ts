import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { RunHost } from '../src/main/pi/RunHost.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import type { WorkspaceProject } from '../src/shared/project.ts';

// Exercise the real host, loopback channel and liveness timer with a disposable transport child.
// This test makes no model request and does not open Terminal.
test(
  'graceful close and a dead bridge both end waiting/running without starting another stage',
  { timeout: 20000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'pistudio-run-close-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const cli = join(root, 'pi');
    await writeFile(
      cli,
      '#!/bin/sh\ncase "$1" in\n --version) echo 1.5.2;;\n --help) echo "pi mcp --session <path|id> --fork <path|id>";;\nesac\n',
      { mode: 0o700 },
    );
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.5.2' }),
    );
    const bridge = join(root, 'transport.mjs');
    await writeFile(
      bridge,
      `
import { readFile, writeFile } from 'node:fs/promises';
const bootstrap = JSON.parse(await readFile(process.argv[2], 'utf8'));
const headers = {Authorization: 'Bearer ' + bootstrap.token, 'Content-Type':'application/json'};
const event = async (data) => {
  const response = await fetch(bootstrap.url + '/event', {method:'POST',headers,body:JSON.stringify(data)});
  if (!response.ok) throw new Error('Transport rejected');
};
const envelope = await (await fetch(bootstrap.url + '/context', {headers})).json();
await event({type:'hello',pid:process.pid});
const path = envelope.record.sessionDirectory + '/test.jsonl';
await writeFile(path, JSON.stringify({type:'session',id:'test'}) + '\\n');
if (process.argv[3] === 'running') await event({type:'request',message:'transport test'});
await event({type:'bound',sessionId:'test',sessionFile:path});
setInterval(() => {}, 1000);
process.on('SIGTERM', () => void event({type:'stopped'}).finally(() => process.exit(0)));
`,
    );
    for (const [mode, signal] of [
      ['waiting', 'SIGTERM'],
      ['waiting', 'SIGKILL'],
      ['running', 'SIGKILL'],
    ] as const) {
      const cwd = join(root, `${mode}-${signal}`);
      await mkdir(join(cwd, 'sessions'), { recursive: true });
      const project = { id: 'project', agents: [] } as unknown as WorkspaceProject;
      const run = {
        projectRoot: root,
        project,
        agent: { profile: { id: 'agent' } },
        record: { runId: `${mode}-${signal}`, cwd, sessionDirectory: join(cwd, 'sessions') },
        instructions: '',
        resources: {},
      } as PreparedRun;
      let child: ChildProcess | undefined,
        status = '',
        completions = 0;
      const host = new RunHost({
        bootstraps: join(root, 'boots'),
        bridge,
        prepare: async () => ({ run, piPath: cli }),
        update: async (_run, next) => {
          status = next;
          return project;
        },
        read: async () => project,
        completed: async () => {
          completions++;
        },
        openTerminal: async (_node, script, bootstrap) => {
          child = spawn(process.execPath, [script, bootstrap, mode], { stdio: 'ignore' });
        },
      });
      try {
        await host.launch({
          projectId: 'project',
          agentId: 'agent',
          firstMessage: 'Transport only',
          autoContinue: true,
        });
        assert.equal(status, mode);
        const exited = new Promise((resolve) => child!.once('exit', resolve));
        child!.kill(signal);
        await exited;
        const deadline = Date.now() + 6000;
        while (status !== 'stopped' && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(status, 'stopped', `${mode}/${signal} must not keep a stale active status`);
        assert.equal(completions, 0);
      } finally {
        host.close();
        child?.kill('SIGKILL');
      }
    }
  },
);

test(
  'quick resume waits for old process cleanup and preserves the new channel and lease',
  { timeout: 15000 },
  async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-reopen-cleanup-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const cli = join(root, 'pi'),
      bridge = join(root, 'session.mjs'),
      cwd = join(root, 'agent'),
      sessions = join(cwd, 'sessions');
    await mkdir(sessions, { recursive: true });
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
import {readFile, writeFile} from 'node:fs/promises';
const boot=JSON.parse(await readFile(process.argv[2],'utf8'));
const headers={Authorization:'Bearer '+boot.token,'Content-Type':'application/json'};
const event=async body=>{const result=await fetch(boot.url+'/event',{method:'POST',headers,body:JSON.stringify(body)});if(!result.ok)throw Error('Rejected event');};
const envelope=await(await fetch(boot.url+'/context',{headers})).json();
await event({type:'hello',pid:process.pid});
const path=envelope.sessionPath || envelope.record.sessionDirectory+'/canonical.jsonl';
if(!envelope.sessionPath)await writeFile(path,JSON.stringify({type:'session',id:'canonical'})+'\\n');
await event({type:'bound',sessionId:'canonical',sessionFile:path});
setInterval(()=>void event({type:'heartbeat'}),500);
process.on('SIGTERM',()=>void event({type:'stopped'}).finally(()=>process.exit(0)));
`,
    );
    const project = { id: 'project', agents: [] } as unknown as WorkspaceProject;
    let runCount = 0,
      status = '',
      releaseCleanup!: () => void,
      cleanupStarted!: () => void;
    const heldCleanup = new Promise<void>((r) => (releaseCleanup = r)),
      started = new Promise<void>((r) => (cleanupStarted = r));
    let binding: PreparedRun['agent']['session'];
    const children: { process: ChildProcess; exited: Promise<unknown> }[] = [];
    const host = new RunHost({
      bootstraps: join(root, 'boots'),
      bridge,
      prepare: async () => ({
        piPath: cli,
        run: {
          projectRoot: root,
          project,
          agent: { profile: { id: 'agent' }, session: binding },
          record: {
            projectId: project.id,
            agentId: 'agent',
            runId: `run-${++runCount}`,
            cwd,
            sessionDirectory: sessions,
          },
          instructions: '',
          resources: {},
        } as PreparedRun,
      }),
      update: async (run, next, session) => {
        if (run.record.runId === 'run-1' && next === 'stopped') {
          cleanupStarted();
          await heldCleanup;
        }
        status = next;
        if (session) binding = session;
        return project;
      },
      read: async () => project,
      openTerminal: async (_node, script, bootstrap) => {
        const process = spawn(globalThis.process.execPath, [script, bootstrap], {
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        process.stderr!.on('data', (bytes) => {
          stderr += bytes.toString();
        });
        process.on('exit', (code) => {
          if (code !== null && code !== 0) t.diagnostic(stderr);
        });
        children.push({ process, exited: new Promise((r) => process.once('exit', r)) });
      },
    });
    try {
      await host.launch({
        projectId: project.id,
        agentId: 'agent',
        autoContinue: false,
        firstMessage: 'Transport only',
      });
      const canonical = binding!,
        history = await readFile(join(root, canonical.path));
      children[0].process.kill('SIGKILL');
      await children[0].exited;
      await started;
      let resumed = false;
      const reopening = host
        .launch({ projectId: project.id, agentId: 'agent', autoContinue: false })
        .then((result) => {
          resumed = true;
          return result;
        });
      void reopening.catch(() => {});
      // A bounded observation: the old process is dead, but its known cleanup handle is held.
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(resumed, false, 'A new bridge must wait for the old cleanup to finish');
      assert.equal(children.length, 1, 'Cleanup must not race with a second bridge');
      releaseCleanup();
      await reopening;
      assert.equal(children.length, 2);
      assert.equal(host.connected, true);
      assert.equal(status, 'waiting');
      assert.deepEqual(binding, canonical);
      assert.deepEqual(await readFile(join(root, canonical.path)), history);
      assert.equal(
        JSON.parse(await readFile(join(cwd, '.pistudio-session-lock.json'), 'utf8')).runId,
        'run-2',
      );
      await new Promise((r) => setTimeout(r, 600));
      assert.equal(host.connected, true, 'The new bridge keeps reporting through its own channel');
    } finally {
      releaseCleanup();
      host.close();
      for (const child of children)
        if (child.process.exitCode === null && child.process.signalCode === null)
          child.process.kill('SIGKILL');
      await Promise.allSettled(children.map((child) => child.exited));
    }
  },
);
