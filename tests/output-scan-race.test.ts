import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanOutputs, loadOutput } from '../src/main/storage/outputs.ts';
import { StudioService } from '../src/main/storage/StudioStore.ts';

test('output refresh survives concurrent agent work-file creation/removal and keeps permanent results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-output-scan-'));
  const store = await new StudioService(join(root, 'prefs.json'), join(root, 'Studio')).load();
  const agent = {
    id: 'animator',
    name: 'Animator',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
  };
  const project = (await store.command({ kind: 'create', name: 'Output race', agents: [agent] }))
    .projects[0];
  const directory = await store.projects.directory(project.id),
    output = project.agents[0].outputPath;
  const manifest = await readFile(join(directory, 'project.json'));
  let stop = false;
  await mkdir(join(directory, output, 'work/masks'), { recursive: true });
  await writeFile(join(directory, output, 'keep.md'), 'Permanent result');
  const churn = (async () => {
    while (!stop)
      for (let i = 0; i < 6 && !stop; i++) {
        const path = join(directory, output, 'work/masks', `run-${i}-body.png.svg`);
        await writeFile(path, '<svg/>');
        await rm(path, { force: true });
      }
  })();
  try {
    for (let i = 0; i < 100; i++) {
      const entries = (await store.projects.read(project.id)).agents[0].entries!;
      assert.ok(entries.some((entry) => entry.name === 'keep.md'));
    }
    await assert.rejects(
      loadOutput(directory, `${output}/no-longer-there.md`),
      /больше недоступен/,
    );
    assert.deepEqual(await readFile(join(directory, 'project.json')), manifest);
  } finally {
    stop = true;
    await churn;
    await rm(root, { recursive: true, force: true });
  }
});
test('a replaced work directory is skipped; path/symlink errors are not suppressed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-output-replaced-'));
  try {
    await mkdir(join(root, 'output'));
    await writeFile(join(root, 'output/work'), 'Now a file');
    assert.deepEqual(await scanOutputs(root, 'output/work/old-directory'), []);
    await symlink(root, join(root, 'output/link'));
    await assert.rejects(scanOutputs(root, 'output/link'), /Символические/);
    await assert.rejects(scanOutputs(root, '../outside'), /Недопустимый/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
