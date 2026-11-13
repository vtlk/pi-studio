import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { RunHost } from '../src/main/pi/RunHost.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import type { WorkspaceProject } from '../src/shared/project.ts';

test(
  'project mutation excludes new requests/launches and stops only that project before moving',
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'pistudio-move-race-'));
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
    const bridge = join(root, 'session.mjs');
    await writeFile(
      bridge,
      `
import {readFile, writeFile} from 'node:fs/promises';
const boot = JSON.parse(await readFile(process.argv[2], 'utf8'));
const headers = {Authorization:'Bearer '+boot.token, 'Content-Type':'application/json'};
const event = (data) => fetch(boot.url+'/event', {method:'POST',headers,body:JSON.stringify(data)});
const envelope = await (await fetch(boot.url+'/context', {headers})).json();
await event({type:'hello',pid:process.pid});
const path = envelope.record.sessionDirectory+'/test.jsonl';
await writeFile(path, JSON.stringify({type:'session',id:'test'})+'\\n');
await event({type:'bound',sessionId:'test',sessionFile:path});
setInterval(()=>{}, 1000);
process.on('SIGTERM',()=>void event({type:'stopped'}).finally(()=>process.exit(0)));
`,
    );
    const children = new Map<string, ChildProcess>();
    const transports = new Map<string, { url: string; token: string }>();
    let admitted = false;
    let releaseAdmission: (() => void) | undefined;
    let delayAdmission = false;
    const admission = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    const host = new RunHost({
      bridge,
      bootstraps: join(root, 'boots'),
      prepare: async ({ projectId, agentId }) => {
        const projectRoot = join(root, projectId),
          cwd = join(projectRoot, agentId),
          sessions = join(cwd, 'sessions');
        await mkdir(sessions, { recursive: true });
        const project = { id: projectId, agents: [] } as unknown as WorkspaceProject;
        return {
          piPath: cli,
          run: {
            projectRoot,
            project,
            agent: { profile: { id: agentId } },
            record: {
              projectId,
              agentId,
              runId: `${projectId}-${agentId}-${Date.now()}`,
              cwd,
              sessionDirectory: sessions,
            },
            resources: {},
            instructions: '',
          } as PreparedRun,
        };
      },
      update: async (run) => run.project,
      read: async (run) => run.project,
      beforeRequest: async () => {
        if (delayAdmission) {
          admitted = true;
          await admission;
        }
      },
      openTerminal: async (_node, script, path) => {
        const bootstrap = JSON.parse(await readFile(path, 'utf8'));
        const envelope = await (
          await fetch(bootstrap.url + '/context', {
            headers: { Authorization: 'Bearer ' + bootstrap.token },
          })
        ).json();
        const id = envelope.record.projectId;
        transports.set(id, bootstrap);
        const child = spawn(process.execPath, [script, path], { stdio: 'ignore' });
        children.set(id, child);
      },
    });
    const event = async (id: string, value: object) => {
      const transport = transports.get(id)!;
      return fetch(transport.url + '/event', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + transport.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
    };
    const launch = (id: string) =>
      host.launch({
        projectId: id,
        agentId: 'agent',
        firstMessage: 'transport only',
        autoContinue: false,
      });
    try {
      await launch('source');
      await launch('other');
      const original = children.get('source')!;
      await host.withProjectChange('source', false, async () => {
        await assert.rejects(launch('source'), /переносятся или копируются/);
        assert.equal(
          (await event('source', { type: 'request', message: 'do not send' })).ok,
          false,
        );
        assert.equal(
          (await event('other', { type: 'request', message: 'other project is independent' })).ok,
          true,
        );
        assert.equal(original.exitCode, null, 'Cloning must keep the original idle dialogue open');
        assert.throws(() => host.assertIdle(), /Дождитесь/);
      });
      // Admission is already activity, even before the asynchronous permission check resolves.
      delayAdmission = true;
      const request = event('source', { type: 'request', message: 'held before model starts' });
      const deadline = Date.now() + 2000;
      while (!admitted && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(admitted, true);
      await assert.rejects(
        host.withProjectChange('source', true, async () =>
          assert.fail('must not move during request admission'),
        ),
        /Дождитесь/,
      );
      releaseAdmission!();
      assert.equal((await request).ok, true);
      await assert.rejects(
        host.withProjectChange('source', false, async () => {}),
        /Дождитесь/,
      );
      await event('source', { type: 'settled', outcome: 'completed' });
      await assert.rejects(
        host.withProjectChange('source', true, async () => {
          assert.equal(
            original.exitCode,
            0,
            'Rename/remove must stop the source bridge before changing its cwd',
          );
          assert.equal(children.get('other')!.exitCode, null, 'Another project must stay open');
          throw new Error('fixture filesystem failure');
        }),
        /fixture filesystem failure/,
      );
      // Failed filesystem changes release the reservation as well.
      await launch('source');
    } finally {
      host.close();
      await Promise.all(
        [...children.values()].map((child) =>
          child.exitCode !== null
            ? undefined
            : new Promise<void>((resolve) => child.once('exit', () => resolve())),
        ),
      );
    }
  },
);
