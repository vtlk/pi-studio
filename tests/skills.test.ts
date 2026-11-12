import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importSkill, inspectSkill, parseSkill } from '../src/main/storage/skills.ts';
import { StudioStore } from '../src/main/storage/StudioStore.ts';

const source = (name = 'local-skill', body = 'Текущие инструкции') =>
  `---\nname: ${name}\ndescription: >\n  Первая строка описания\n  и продолжение.\n---\n\n${body}\n`;
test('skill frontmatter supports real YAML and rejects missing, malformed and ambiguous metadata', () => {
  const skill = parseSkill(`\uFEFF${source().replaceAll('\n', '\r\n')}`);
  assert.equal(skill.name, 'local-skill');
  assert.equal(skill.description, 'Первая строка описания и продолжение.');
  for (const invalid of [
    '# no frontmatter',
    '---\nname: local-skill\n---\nbody',
    '---\nname: a\nname: b\ndescription: text\n---',
    source('bad--name'),
    '---\nname: local-skill\ndescription: !!js/function x\n---',
  ])
    assert.throws(() => parseSkill(invalid));
});
test('local imports keep stable path identity, reject name collisions and store no copies of instructions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-skill-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, 'skill');
  await mkdir(folder);
  await writeFile(join(folder, 'SKILL.md'), source());
  const imported = await importSkill(folder, []);
  assert.equal(imported.localSkill, true);
  assert.equal('content' in imported, false);
  const alias = join(root, 'alias');
  await symlink(folder, alias);
  const again = await importSkill(join(alias, 'SKILL.md'), [imported]);
  assert.equal(again.id, imported.id);
  assert.equal(again.createdAt, imported.createdAt);
  const other = join(root, 'other');
  await mkdir(other);
  await writeFile(join(other, 'SKILL.md'), source());
  await assert.rejects(importSkill(other, [imported]), /таким именем/);
  const store = await StudioStore.open(join(root, 'studio'));
  await store.saveSection('resources', [imported]);
  assert.equal(JSON.stringify(store.bootstrap().sections).includes('Текущие инструкции'), false);
  await writeFile(join(folder, 'SKILL.md'), source('local-skill', 'Изменённый актуальный текст'));
  assert.match((await inspectSkill(imported.source)).content, /Изменённый актуальный текст/);
  await rm(join(folder, 'SKILL.md'));
  await assert.rejects(inspectSkill(imported.source), { code: 'ENOENT' });
});
test('import rejects arbitrary filenames, reserved built-in skills and binary files without executing anything', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-skill-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'script.js'), source());
  await assert.rejects(inspectSkill(join(root, 'script.js')), /SKILL.md/);
  await writeFile(join(root, 'SKILL.md'), source('create-library-character'));
  await assert.rejects(importSkill(root, []), /поставляется/);
  await writeFile(join(root, 'SKILL.md'), Buffer.from([0, 1, 2]));
  await assert.rejects(inspectSkill(root), /Бинарный/);
});
