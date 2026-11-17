import nativeTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transactionFixture } from './helpers/updateTransaction.ts';
import { atomicJson, exists, identity, sameIdentity } from '../bundled/update-helper/protocol.mjs';
import { cleanupUpdate, cleanupFinishedUpdates } from '../src/main/updates/cleanupUpdate.ts';
import { cleanupDownloads } from '../src/main/updates/cleanupDownloads.ts';

// Both package layouts exercise the actual helper on a POSIX host, using owned shell launchers.
// Windows sharing/locking and native .exe startup still require an actual Windows host.
const test = process.platform === 'win32' ? nativeTest.skip : nativeTest;
for (const platform of ['darwin', 'win32'] as const)
  test(
    `${platform} layout: successful update retains one app and no previous/staging/archive copy`,
    { timeout: 12000 },
    async (t) => {
      const f = await transactionFixture(t, 'ok', platform);
      const userFile = join(f.root, 'MY PROJECT.txt');
      await writeFile(userFile, 'PRESERVE');
      const downloads = join(f.userData, 'updates/downloads');
      const download = join(downloads, 'download-ab1234');
      await mkdir(download, { recursive: true });
      await atomicJson(join(download, 'owner.json'), {
        schema: 1,
        id: randomUUID(),
        pid: f.job.oldPid,
      });
      await writeFile(join(download, 'package.zip'), 'owned inert downloaded archive');
      const helper = f.run();
      await f.ready();
      await atomicJson(f.p.active, { id: f.job.id, target: f.target });
      await atomicJson(f.p.commit, { nonce: f.job.nonce });
      await f.closeParent();
      assert.equal((await f.result()).status, 'committed');
      await helper.exited;
      assert.equal(sameIdentity(await identity(f.target), f.job.newIdentity), true);
      assert.equal(await exists(f.p.previous), false, 'Old app removed after startup confirmation');
      await cleanupDownloads(downloads);
      assert.equal(await cleanupUpdate(f.job), true);
      assert.equal(await cleanupFinishedUpdates(f.userData, f.target), true);
      assert.deepEqual(await readdir(downloads), []);
      assert.deepEqual(await readdir(join(f.userData, 'updates/transactions')), []);
      assert.equal(await exists(f.stage), false);
      assert.equal(await exists(f.p.active), false);
      assert.deepEqual(
        (await readdir(f.root)).sort(),
        [
          'MY PROJECT.txt',
          platform === 'darwin' ? 'Pi Studio.app' : 'Pi Studio',
          'UserData',
        ].sort(),
      );
      assert.equal(await readFile(userFile, 'utf8'), 'PRESERVE');
      assert.equal(await readFile(join(f.userData, 'KEEP.json'), 'utf8'), '{"user":"UNCHANGED"}\n');
    },
  );
