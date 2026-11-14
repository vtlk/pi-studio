import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
  copyFile,
  symlink,
  readdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../src/main/library/LibraryStore.ts';
import { renderLibraryPreview } from '../src/main/library/renderLibraryPreview.ts';
import { previewOptions } from '../src/main/library/previewOptions.ts';
import { characterSvgFrame } from '../src/shared/characterSvgFrame.ts';
import { parseCharacterSvg } from '../src/shared/characterSvg.ts';
import { parseCharacterRig } from '../src/shared/parseCharacterRig.ts';
import { characterFixture } from '../scripts/fixtures/character-rig.ts';
import { writeLibraryFixture, libraryPng } from '../scripts/fixtures/library.mjs';

async function fixture(t: TestContext, kind: 'characters' | 'locations' = 'characters') {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-preview-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  await mkdir(output);
  const library = new LibraryStore(root),
    prepared = await library.prepare(output, { kind, title: 'Frame QA' });
  await writeLibraryFixture(prepared);
  await rm(join(prepared.stagingDirectory, 'preview.png'));
  return {
    root,
    output,
    library,
    prepared,
    args: { token: prepared.token, width: 64, height: 64 },
  };
}
const png = libraryPng(64, 64);
test('a missing preview can be rendered; no source/reference/publication changes until explicitly copied and published', async (t) => {
  const f = await fixture(t),
    stage = f.prepared.stagingDirectory;
  const before = await Promise.all(
    ['asset.json', 'reference.png', 'art.svg'].map((p) => readFile(join(stage, p))),
  );
  await assert.rejects(() => f.library.validate(f.output, f.prepared.token));
  let calls = 0;
  const result = await renderLibraryPreview(f.library, f.output, f.args, async (source, frame) => {
    calls++;
    assert.ok(source.startsWith('data:image/svg+xml;base64,'));
    assert.equal(frame.transparent, true);
    return png;
  });
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(result.path), png);
  assert.equal(result.published, false);
  assert.deepEqual(
    await Promise.all(
      ['asset.json', 'reference.png', 'art.svg'].map((p) => readFile(join(stage, p))),
    ),
    before,
  );
  await assert.rejects(access(join(stage, 'preview.png')));
  assert.equal((await f.library.list()).assets.length, 0);
  await copyFile(result.path, join(stage, 'preview.png'));
  assert.equal((await f.library.validate(f.output, f.prepared.token)).validated, true);
  const published = await f.library.publish(f.output, f.prepared.token);
  assert.equal(published.manifest.version, 1);
  await assert.rejects(
    () =>
      renderLibraryPreview(f.library, f.output, f.args, async () =>
        assert.fail('Published job must not render'),
      ),
    /опубликованного/,
  );
});
test('wrong owner, bad data, incompatible controls and source changes refuse rendering or saving a stale PNG', async (t) => {
  const f = await fixture(t),
    other = join(f.root, 'other');
  await mkdir(other);
  const unused = async () => assert.fail('Renderer must not run');
  await assert.rejects(
    () => renderLibraryPreview(f.library, other, f.args, unused),
    /другим агентом/,
  );
  await assert.rejects(
    () =>
      renderLibraryPreview(
        f.library,
        f.output,
        { ...f.args, character: { action: 'wave' } },
        unused,
      ),
    /rig/,
  );
  await assert.rejects(
    () => renderLibraryPreview(f.library, f.output, { ...f.args, camera: {} }, unused),
    /локаций/,
  );
  await writeFile(join(f.prepared.stagingDirectory, 'art.svg'), '<svg onload="alert(1)"/>');
  await assert.rejects(() => renderLibraryPreview(f.library, f.output, f.args, unused), /SVG/);
  await writeLibraryFixture(f.prepared);
  await assert.rejects(
    () =>
      renderLibraryPreview(f.library, f.output, f.args, async () => {
        await writeFile(
          join(f.prepared.stagingDirectory, 'art.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>',
        );
        return png;
      }),
    /Исходники изменились/,
  );
  await assert.rejects(access(join(f.output, 'previews')));
  await assert.rejects(
    () => renderLibraryPreview(f.library, f.output, f.args, async () => libraryPng()),
    /размер/,
  );
  await assert.rejects(
    () => renderLibraryPreview(f.library, f.output, f.args, async () => Buffer.from('not png')),
    /PNG/,
  );
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(f.output, 'previews'));
  await assert.rejects(
    () => renderLibraryPreview(f.library, f.output, f.args, async () => png),
    /ссылк/,
  );
  assert.deepEqual(await readdir(outside), []);
});
test('camera parameters are explicit and bounded; malformed controls never become another pose or execute code', () => {
  for (const args of [
    { width: 4096 },
    { height: NaN },
    { width: 64.5 },
    { character: { action: 'unknown' } },
    { character: { emotion: 'unknown' } },
    { character: { time: -1 } },
    { character: { time: Infinity } },
    { character: { blink: 'yes' } },
    { camera: { zoom: 8 } },
    { camera: { x: 20000 } },
    { character: { script: 'alert(1)' } },
  ])
    assert.throws(() => previewOptions(args));
  const valid = previewOptions({
    camera: { zoom: 2, x: 20, y: -30 },
    character: { action: 'walk', emotion: 'smile', time: 0.2, headTilt: 7 },
  });
  assert.deepEqual(valid.camera, { zoom: 2, x: 20, y: -30 });
  assert.equal(valid.character.headTilt, 7);
});
test('pose SVG is deterministic, preserves original transforms/IDs, and changes actual bound geometry', () => {
  const data = characterFixture(),
    parsed = parseCharacterSvg(data.svg),
    rig = parseCharacterRig(data.rig, parsed.parts);
  const source = { svg: parsed.svg, rig };
  const opts = previewOptions({
    character: { action: 'walk', emotion: 'smile', gazeX: 1, headTilt: 7 },
  });
  const a = characterSvgFrame(source, opts.character, 0.13),
    b = characterSvgFrame(source, opts.character, 0.41);
  assert.equal(characterSvgFrame(source, opts.character, 0.13), a);
  assert.notEqual(a, b);
  assert.match(a, /rotate\(7 /);
  assert.match(a, /translate\(6 /);
  assert.ok(parseCharacterSvg(a).parts.has('mouth'));
  assert.ok(a.includes('url(#shirt)'));
});
