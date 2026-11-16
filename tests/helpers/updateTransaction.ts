import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { writeInventory } from '../../bundled/update-helper/inventory.mjs';
import {
  identity,
  paths,
  atomicJson,
  exists,
  type UpdateJob,
} from '../../bundled/update-helper/protocol.mjs';

export async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, ms = 7000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const result = await read();
    if (accept(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Owned update transaction condition timed out.');
}
export async function transactionFixture(t: TestContext, mode = 'ok') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-tx-«тест» $()-')));
  let cleanup = async () => {
    await rm(root, { recursive: true, force: true });
  };
  t.after(() => cleanup());
  const target = join(root, 'Pi Studio.app'),
    userData = join(root, 'UserData');
  const id = randomUUID(),
    nonce = randomUUID();
  const stage = join(root, `.pistudio-update-${id}`);
  await mkdir(stage, { mode: 0o700 });
  await mkdir(join(userData, 'updates/transactions'), { recursive: true });
  await writeFile(join(userData, 'KEEP.json'), '{"user":"UNCHANGED"}\n');
  const protocol = pathToFileURL(resolve('bundled/update-helper/protocol.mjs')).href;
  const executableSource = (version: string, selectedMode: string) => `
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {paths,atomicJson,authenticated} from ${JSON.stringify(protocol)};
const args=process.argv.slice(2), data=args.find(arg=>arg.startsWith('--pistudio-user-data=')).split('=').slice(1).join('=');
const failed=args.some(arg=>arg.startsWith('--pistudio-update-failed='));
if(failed){const failedId=args.find(arg=>arg.startsWith('--pistudio-update-failed=')).split('=')[1];const job=JSON.parse(await readFile(join(data,'updates/transactions',failedId+'.json'),'utf8'));await atomicJson(join(data,'OLD_REOPENED'),{nonce:job.nonce,pid:process.pid,version:${JSON.stringify(version)}});process.exit(0);}
const id=args.find(arg=>arg.startsWith('--pistudio-update=')).split('=')[1];
const job=JSON.parse(await readFile(join(data,'updates/transactions',id+'.json'),'utf8')), p=paths(job);
await mkdir(p.startups,{recursive:true});
const report={nonce:job.nonce,pid:process.pid,version:${JSON.stringify(version)},exe:job.target+'/Contents/MacOS/Pi Studio'};
await atomicJson(join(p.startups,process.pid+'.json'),report);
if(${JSON.stringify(selectedMode)}==='crash')process.exit(41);
if(${JSON.stringify(selectedMode)}==='ok')await atomicJson(p.health,report);
setInterval(async()=>{
 const result=await authenticated(p.result,job);
 if(result?.status==='committed')process.exit(0);
 if(${JSON.stringify(selectedMode)}!=='wedged'&&await authenticated(p.abort,job))process.exit(2);
},30);
`;
  const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  async function app(path: string, version: string, selectedMode: string) {
    await mkdir(join(path, 'Contents/MacOS'), { recursive: true });
    await mkdir(join(path, 'Contents/Resources/app'), { recursive: true });
    const script = join(path, 'Contents/Resources/app/fixture.mjs');
    await writeFile(script, executableSource(version, selectedMode));
    // Relative lookup survives the actual app-folder rename. Only owned fixture code is executed.
    await writeFile(
      join(path, 'Contents/MacOS/Pi Studio'),
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$(dirname "$0")/../Resources/app/fixture.mjs" "$@"\n`,
      { mode: 0o700 },
    );
    await writeFile(
      join(path, 'Contents/Resources/app/package.json'),
      JSON.stringify({ name: 'pi-video-studio', version }),
    );
    await writeInventory(path, 'darwin');
    return path;
  }
  await app(target, '0.2.0-alpha.76', 'old');
  const next = await app(join(stage, 'next/Pi Studio.app'), '0.2.0-alpha.77', mode);
  const oldIdentity = await identity(target),
    newIdentity = await identity(next);
  const parent = spawn(process.execPath, ['-e', "process.stdin.on('data',()=>process.exit(0))"], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  parent.stdin.on('error', () => undefined);
  const parentExit = new Promise<void>((resolve) => parent.once('exit', () => resolve()));
  const job: UpdateJob = {
    schema: 1,
    id,
    nonce,
    platform: 'darwin',
    oldPid: parent.pid!,
    oldVersion: '0.2.0-alpha.76',
    version: '0.2.0-alpha.77',
    target,
    stage,
    userData,
    oldIdentity,
    newIdentity,
    // Normal child startup shares CPU with the full parallel suite. Negative startup cases
    // intentionally keep their short deadline; production uses its separate 90-second limit.
    limits: { exitMs: 6000, healthMs: mode === 'ok' ? 6000 : 1000, abortMs: 1000 },
  };
  const p = paths(job);
  const helpers: ReturnType<typeof spawn>[] = [];
  const helperExits: Promise<void>[] = [];
  function run() {
    const child = spawn(
      process.execPath,
      [resolve('bundled/update-helper/runner.mjs'), p.journal],
      { stdio: 'ignore' },
    );
    helpers.push(child);
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    helperExits.push(exited);
    return { child, exited };
  }
  cleanup = async () => {
    parent.stdin.end('quit');
    await parentExit;
    // The detached rollback launcher may still be finishing its acknowledgement after the helper exits.
    const markers: { nonce: string; pid: number }[] = [];
    if (await exists(p.result)) {
      const result = JSON.parse(await readFile(p.result, 'utf8'));
      if (result.status === 'rolled-back')
        markers.push(
          await until(
            async () => {
              const file = join(userData, 'OLD_REOPENED');
              return (await exists(file)) ? JSON.parse(await readFile(file, 'utf8')) : undefined;
            },
            (value) => !!value,
          ),
        );
    }
    if (await exists(p.startups))
      for (const name of await readdir(p.startups))
        markers.push(JSON.parse(await readFile(join(p.startups, name), 'utf8')));
    const ending: number[] = [];
    // Test-only cleanup may terminate only PIDs whose nonce-bound startup marker belongs to this fixture.
    for (const marker of markers) {
      if (marker.nonce !== nonce) continue;
      try {
        const command = execFileSync('/bin/ps', ['-p', String(marker.pid), '-o', 'command='], {
          encoding: 'utf8',
        });
        if (
          command.includes(root) &&
          command.includes('/Resources/app/fixture.mjs') &&
          (command.includes(`--pistudio-update=${id}`) ||
            command.includes(`--pistudio-update-failed=${id}`))
        ) {
          process.kill(marker.pid, 'SIGTERM');
          ending.push(marker.pid);
        }
      } catch {}
    }
    for (const pid of ending)
      await until(async () => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      }, Boolean);
    for (const child of helpers)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.all(helperExits);
    await rm(root, { recursive: true, force: true });
  };
  await atomicJson(p.journal, job);
  return {
    root,
    target,
    next,
    stage,
    userData,
    job,
    p,
    run,
    closeParent: async () => {
      parent.stdin.end('quit');
      await parentExit;
    },
    ready: () =>
      until(
        async () =>
          (await exists(p.ready)) ? JSON.parse(await readFile(p.ready, 'utf8')) : undefined,
        (value) => !!value,
      ),
    result: () =>
      until(
        async () =>
          (await exists(p.result)) ? JSON.parse(await readFile(p.result, 'utf8')) : undefined,
        (value) => !!value,
      ),
  };
}
