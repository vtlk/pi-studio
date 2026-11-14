import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test(
  'mac packaging refuses missing/ad-hoc identity before staging any application',
  {
    skip: process.platform !== 'darwin',
  },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), 'pistudio-package-signing-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    for (const identity of [undefined, '', '  ', '-']) {
      const env = { ...process.env, HOME: home };
      delete env.PI_STUDIO_SIGN_IDENTITY;
      if (identity !== undefined) env.PI_STUDIO_SIGN_IDENTITY = identity;
      const result = spawnSync(process.execPath, ['scripts/package-mac.mjs'], {
        cwd: new URL('..', import.meta.url),
        env,
        encoding: 'utf8',
        timeout: 3000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Set PI_STUDIO_SIGN_IDENTITY/);
      assert.deepEqual(await readdir(home), [], 'No cache/build or application copy was created');
    }
  },
);
