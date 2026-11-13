import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readVideoProject, validateStaticSvg } from '../src/main/video/readVideoProject.ts';
import { parseVideoTimeline } from '../src/main/video/timeline.ts';
import { evaluateVideoTransform } from '../src/shared/videoFrame.ts';
import { resolveOutputReference } from '../src/shared/outputPaths.ts';
import { videoContract } from '../src/main/video/contract.ts';

function timeline() {
  return {
    type: 'pi-studio.timeline',
    schemaVersion: 1,
    width: 320,
    height: 480,
    fps: 30,
    durationInFrames: 60,
    assets: [{ id: 'image', type: 'image', src: './assets/scene.svg' }],
    tracks: [
      {
        id: 'visual',
        name: 'Картинка',
        type: 'visual',
        items: [
          {
            id: 'clip',
            name: 'Сцена',
            from: 0,
            duration: 60,
            assetId: 'image',
            keyframes: [
              { frame: 0, x: 0, ease: 'smooth' },
              { frame: 59, x: 100 },
            ],
          },
        ],
      },
    ],
  };
}
test('native montage resolves assets inside one output and revisions include every dependency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-video-'));
  const output = join(root, 'agents/agent/output');
  try {
    await mkdir(join(output, 'assets'), { recursive: true });
    await writeFile(
      join(output, 'film.pistudio.json'),
      JSON.stringify({
        type: 'pi-studio.video-project',
        schemaVersion: 1,
        editor: 'remotion-player',
        name: 'Фильм',
        scope: 'film',
        state: './timeline.json',
      }),
    );
    await writeFile(join(output, 'timeline.json'), JSON.stringify(timeline()));
    await writeFile(
      join(output, 'assets/scene.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="red"/></svg>',
    );
    const initial = await readVideoProject(
      root,
      'project',
      'agents/agent/output/film.pistudio.json',
    );
    assert.match(
      initial.assets[0].url,
      /^studio-media:\/\/output\/project\/agents\/agent\/output\/assets\/scene.svg\?v=[a-f0-9]{64}$/,
    );
    assert.equal(
      initial.revision,
      (await readVideoProject(root, 'project', initial.manifestPath)).revision,
    );
    await writeFile(
      join(output, 'assets/scene.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="blue"/></svg>',
    );
    const updated = await readVideoProject(root, 'project', initial.manifestPath);
    assert.notEqual(updated.revision, initial.revision);
    await symlink(join(output, 'assets/scene.svg'), join(output, 'assets/link.svg'));
    const bad = timeline();
    bad.assets[0].src = './assets/link.svg';
    await writeFile(join(output, 'timeline.json'), JSON.stringify(bad));
    await assert.rejects(
      readVideoProject(root, 'project', initial.manifestPath),
      /Символические ссылки/,
    );
    bad.assets[0].src = '../other/output/file.svg';
    await writeFile(join(output, 'timeline.json'), JSON.stringify(bad));
    await assert.rejects(
      readVideoProject(root, 'project', initial.manifestPath),
      /выходит за output/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('timeline rejects incompatible IDs, bounds, types, nonfinite numbers and malformed keyframes', () => {
  assert.equal(parseVideoTimeline(videoContract.example.timeline).durationInFrames, 150);
  assert.equal(parseVideoTimeline(timeline()).tracks[0].items[0].assetId, 'image');
  for (const mutate of [
    (data: ReturnType<typeof timeline>) => {
      data.tracks[0].items[0].duration = 61;
    },
    (data: ReturnType<typeof timeline>) => {
      data.tracks[0].items[0].assetId = 'missing';
    },
    (data: ReturnType<typeof timeline>) => {
      data.tracks[0].id = 'image';
    },
    (data: ReturnType<typeof timeline>) => {
      data.width = 321;
    },
    (data: ReturnType<typeof timeline>) => {
      data.fps = NaN;
    },
    (data: ReturnType<typeof timeline>) => {
      data.tracks[0].items[0].keyframes[1].frame = 0;
    },
    (data: ReturnType<typeof timeline>) => {
      data.assets[0].type = 'audio';
    },
  ]) {
    const data = timeline();
    mutate(data);
    assert.throws(() => parseVideoTimeline(data));
  }
});
test('SVG accepts static artwork and rejects active/external/animated content', () => {
  validateStaticSvg('<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>');
  for (const body of [
    '<script/>',
    '<foreignObject/>',
    '<animateTransform/>',
    '<g onclick="go()"/>',
    '<image href="file:///secret"/>',
    '<style>@import "https://example.org";</style>',
    '<path fill="url(https://example.org)"/>',
    '<image href="&#104;ttps://example.org"/>',
  ])
    assert.throws(() => validateStaticSvg(`<svg>${body}</svg>`));
});
test('motion interpolates sparse channels, holds endpoints and never crosses clip timing', () => {
  const item = parseVideoTimeline(timeline()).tracks[0].items[0];
  assert.equal(evaluateVideoTransform(item, 0).x, 0);
  assert.equal(evaluateVideoTransform(item, 29.5).x, 50);
  assert.equal(evaluateVideoTransform(item, 100).x, 100);
  item.keyframes = [
    { frame: 10, x: 10, ease: 'hold' },
    { frame: 20, y: 100 },
    { frame: 30, x: 30 },
  ];
  assert.equal(evaluateVideoTransform(item, 20).x, 10);
  assert.equal(evaluateVideoTransform(item, 10).y, 50);
  assert.equal(resolveOutputReference(['scenes'], '../assets/a.svg'), 'assets/a.svg');
  assert.equal(resolveOutputReference([], '../a.svg'), null);
  assert.equal(resolveOutputReference([], 'https://example.org/a.svg'), null);
});
