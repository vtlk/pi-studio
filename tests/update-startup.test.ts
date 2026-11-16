import nativeTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rename, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { transactionFixture } from './helpers/updateTransaction.ts';
import { paths, atomicJson, exists, executable } from '../bundled/update-helper/protocol.mjs';
import { resolveUpdateStartup } from '../src/main/updates/UpdateStartup.ts';

const test = process.platform === 'win32' ? nativeTest.skip : nativeTest;
test('new program startup stays frozen until explicit readiness and authenticated commit; abort only requests normal quit', async (t) => {
  const f = await transactionFixture(t);
  let quits = 0;
  await mkdir(dirname(f.p.previous), { recursive: true });
  await rename(f.target, f.p.previous);
  await rename(f.next, f.target);
  await mkdir(f.p.startups);
  await atomicJson(f.p.active, { id: f.job.id, target: f.target });
  const options = {
    appRoot: f.target,
    executable: executable(f.target, 'darwin'),
    version: f.job.version,
    userData: f.userData,
    argv: [`--pistudio-update=${f.job.id}`, `--pistudio-user-data=${f.userData}`],
    quit: () => {
      quits++;
    },
  };
  const { startup } = await resolveUpdateStartup(options);
  assert.ok(startup);
  t.after(() => startup.close());
  await startup.start();
  assert.equal(startup.read().phase, 'starting');
  assert.equal(await exists(f.p.health), false);
  const marker = JSON.parse(await readFile(join(f.p.startups, process.pid + '.json'), 'utf8'));
  assert.equal(marker.pid, process.pid);
  assert.equal(marker.nonce, f.job.nonce);
  await startup.confirmReady();
  assert.equal(JSON.parse(await readFile(f.p.health, 'utf8')).version, f.job.version);
  await mkdir(dirname(f.p.result), { recursive: true });
  await atomicJson(f.p.result, { nonce: 'unrelated', status: 'committed' });
  await startup.poll();
  assert.equal(startup.read().phase, 'starting');
  await atomicJson(f.p.result, { nonce: f.job.nonce, status: 'committed' });
  // The timer may own the current poll; an overlapping manual poll deliberately returns early.
  // Assert eventual convergence from the authenticated durable result, not timer scheduling.
  for (let attempt = 0; attempt < 200 && startup.read().phase === 'starting'; attempt++) {
    await startup.poll();
    if (startup.read().phase === 'starting')
      await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(startup.read().phase, 'committed');
  assert.equal(quits, 0);
  assert.equal(
    (await resolveUpdateStartup({ ...options, argv: [] })).startup?.read().phase,
    'committed',
    'Reopen after a durable commit does not require a new health acknowledgement',
  );
});
test('startup cancellation retains a PID marker until real exit and never acknowledges a failed launch', async (t) => {
  const f = await transactionFixture(t);
  let quits = 0;
  await mkdir(dirname(f.p.previous), { recursive: true });
  await rename(f.target, f.p.previous);
  await rename(f.next, f.target);
  await mkdir(f.p.startups);
  await atomicJson(f.p.active, { id: f.job.id, target: f.target });
  const { startup } = await resolveUpdateStartup({
    appRoot: f.target,
    executable: executable(f.target, 'darwin'),
    version: f.job.version,
    userData: f.userData,
    argv: [`--pistudio-update=${f.job.id}`],
    quit: () => {
      quits++;
    },
  });
  assert.ok(startup);
  t.after(() => startup.close());
  await startup.start();
  await atomicJson(f.p.abort, { nonce: f.job.nonce });
  await startup.poll();
  await startup.confirmReady();
  await startup.poll();
  assert.equal(quits, 1);
  assert.equal(startup.read().phase, 'aborting');
  assert.equal(await exists(f.p.health), false);
  assert.equal(await exists(join(f.p.startups, process.pid + '.json')), true);
});
test('only the exact path-bound transaction may override userData; restored old versions remain usable', async (t) => {
  const f = await transactionFixture(t);
  const options = {
    appRoot: f.target,
    executable: executable(f.target, 'darwin'),
    version: f.job.oldVersion,
    userData: f.userData,
    argv: [],
    quit: () => {
      throw new Error('unexpected quit');
    },
  };
  await assert.rejects(
    resolveUpdateStartup({ ...options, argv: [`--pistudio-user-data=${f.userData}`] }),
    /Неоднозначный/,
  );
  await atomicJson(f.p.active, { id: f.job.id, target: f.target });
  await assert.rejects(resolveUpdateStartup(options), /Не подтверждено восстановление/);
  await mkdir(dirname(f.p.result), { recursive: true });
  await atomicJson(f.p.result, { nonce: f.job.nonce, status: 'rolled-back' });
  const restored = await resolveUpdateStartup({
    ...options,
    argv: [`--pistudio-update-failed=${f.job.id}`],
  });
  assert.equal(restored.startup?.read().phase, 'restored');
  await assert.rejects(
    resolveUpdateStartup({ ...options, executable: join(f.root, 'other') }),
    /не относится/,
  );
  await assert.rejects(
    resolveUpdateStartup({ ...options, argv: ['--pistudio-update=../../other'] }),
    /идентификатор/,
  );
  assert.equal(
    (await resolveUpdateStartup({ ...options, userData: join(f.root, 'new-user-data') })).startup,
    undefined,
  );
});
