import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
