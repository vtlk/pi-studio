import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import {
  installStandards,
  readStandard,
  writeStandard,
  standardPath,
} from '../src/main/storage/standards.ts';

test('bundled standards are editable current files; updates preserve custom text without instruction snapshots', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-standards-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bundled = join(root, 'bundle');
  await cp(resolve('technical-spec/bundled/pi-studio-library'), bundled, { recursive: true });
  const store = await StudioStore.open(join(root, 'studio'), bundled);
  const first = await readStandard(store.folder, 'create-library-character', 'SKILL.md');
  assert.match(first.content, /name: create-library-character/);
  assert.equal((store.bootstrap().sections.resources as unknown[]).length, 2);
  await writeStandard(
    store.folder,
    'create-library-character',
    'SKILL.md',
    '# Пользовательский стандарт',
  );
  const shippedFile = join(bundled, 'skills/create-library-character/SKILL.md');
  await writeFile(shippedFile, '# Новая поставка');
  const reference = join(bundled, 'skills/create-library-character/references/standard.md');
  await writeFile(reference, '# Обновлённый неизменённый reference');
  await installStandards(store.folder, bundled);
  assert.equal(
    (await readStandard(store.folder, 'create-library-character', 'SKILL.md')).content,
    '# Пользовательский стандарт',
  );
  assert.equal(
    (await readStandard(store.folder, 'create-library-character', 'references/standard.md'))
      .content,
    '# Обновлённый неизменённый reference',
  );
  assert.deepEqual(
    (
      await readdir(
        join(store.folder, '.pistudio/packages/pi-studio-library/skills/create-library-character'),
      )
    ).sort(),
    ['SKILL.md', 'references'],
  );
  const registry = await readFile(join(store.folder, '.pistudio/package-hashes.json'), 'utf8');
  assert.equal(registry.includes('Пользовательский'), false);
  await assert.rejects(writeStandard(store.folder, 'create-library-character', 'SKILL.md', ''));
  assert.throws(() => standardPath('../escape' as 'create-library-character', 'SKILL.md'));
  assert.throws(() => standardPath('constructor' as 'create-library-character', 'SKILL.md'));
});
