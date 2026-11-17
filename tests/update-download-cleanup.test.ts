import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cleanupDownloads } from '../src/main/updates/cleanupDownloads.ts';
import { exists } from '../bundled/update-helper/protocol.mjs';

test('download cleanup removes only abandoned owned caches; keeps live owners and unknown user files', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-download-cleanup-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((resolve) => child.once('exit', resolve));
  for (const [name, pid, extra] of [
    ['download-ab1234', child.pid, false],
    ['download-cd5678', process.pid, false],
    ['download-ef9012', child.pid, true],
  ] as const) {
    const directory = join(root, name);
    await mkdir(directory);
    await writeFile(
      join(directory, 'owner.json'),
      JSON.stringify({ schema: 1, id: randomUUID(), pid }),
    );
    await writeFile(join(directory, 'package.zip'), 'owned inert download');
    if (extra) await writeFile(join(directory, 'USER.txt'), 'KEEP');
  }
  await mkdir(join(root, 'download-zz1234'));
  await utimes(join(root, 'download-zz1234'), new Date(0), new Date(0));
  await mkdir(join(root, 'download-other'));
  await writeFile(join(root, 'download-other', 'USER.txt'), 'KEEP');
  await cleanupDownloads(root);
  assert.equal(await exists(join(root, 'download-ab1234')), false);
  assert.equal(await exists(join(root, 'download-zz1234')), false);
  assert.equal(await exists(join(root, 'download-cd5678/package.zip')), true);
  assert.equal(await exists(join(root, 'download-ef9012/USER.txt')), true);
  assert.equal(await exists(join(root, 'download-other/USER.txt')), true);
});
