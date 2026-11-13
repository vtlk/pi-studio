import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDocument,
  changeTimeline,
  type DemoTimeline,
} from '../src/renderer/features/editor/model/timeline.ts';
import {
  inspectManifest,
  resolveOutputPath,
} from '../src/renderer/features/editor/model/manifest.ts';
import type {
  OutputFile,
  OutputEntry,
} from '../src/renderer/features/project/model/workspace.types.ts';
const timeline: DemoTimeline = {
  type: 'pi-studio.prototype-timeline',
  fps: 30,
  width: 1080,
  height: 1920,
  subtitles: 'ТЕКСТ',
  tracks: [
    {
      id: 'picture',
      label: 'Изображение',
      muted: false,
      gain: 100,
      pan: 0,
      clips: [{ id: 'clip', label: 'Сцена', src: './scene.svg', start: 0, duration: 90 }],
    },
  ],
};
const manifest = (changes: Record<string, unknown> = {}): OutputFile => ({
  kind: 'file',
  id: 'manifest',
  name: 'film.pistudio.json',
  format: 'json',
  content: JSON.stringify({
    type: 'pi-studio.video-project',
    schemaVersion: 1,
    editor: 'remotion-editor-starter',
    name: 'Фильм',
    state: './timeline.json',
    ...changes,
  }),
});
const entries = (file: OutputFile, state: unknown = timeline): OutputEntry[] => [
  file,
  {
    kind: 'file',
    id: 'state',
    name: 'timeline.json',
    format: 'json',
    content: JSON.stringify(state),
  },
  { kind: 'file', id: 'image', name: 'scene.svg', format: 'image', src: '/assets/scene.svg' },
];
test('manifest validates the explicit prototype contract and resolves local asset references without changing source entries', () => {
  const file = manifest();
  const source = entries(file);
  const before = structuredClone(source);
  const result = inspectManifest(file, source);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.timeline.tracks[0].clips[0].src, '/assets/scene.svg');
  assert.deepEqual(source, before);
});
test('broken, unsupported and incomplete projects never become editable timelines', () => {
  for (const changes of [
    { schemaVersion: 2 },
    { editor: 'other' },
    { type: 'other' },
    { state: '../outside.json' },
    { state: './missing.json' },
    { name: '' },
  ]) {
    const file = manifest(changes);
    assert.equal(inspectManifest(file, entries(file)).ok, false);
  }
  const file = manifest();
  assert.equal(
    inspectManifest(
      file,
      entries(file, {
        ...timeline,
        tracks: [
          {
            ...timeline.tracks[0],
            clips: [{ ...timeline.tracks[0].clips[0], src: './missing.svg' }],
          },
        ],
      }),
    ).ok,
    false,
  );
  assert.equal(inspectManifest(file, entries(file, { ...timeline, type: 'unknown' })).ok, false);
  assert.equal(inspectManifest({ ...file, content: '{broken' }, entries(file)).ok, false);
});
test('relative paths remain inside the agent output directory', () => {
  assert.equal(resolveOutputPath(['scene'], '../assets/image.svg'), 'assets/image.svg');
  for (const path of ['../../outside', '/absolute', 'https://example.com/a', 'C:\\file', '\0file'])
    assert.equal(resolveOutputPath(['scene'], path), null);
});
test('changes to image timing, subtitles or sound advance revisions and keep other documents isolated', () => {
  const first = createDocument(timeline);
  const second = createDocument(timeline);
  for (const next of [
    { ...timeline, subtitles: 'НОВЫЙ ТЕКСТ' },
    { ...timeline, tracks: [{ ...timeline.tracks[0], muted: true }] },
    {
      ...timeline,
      tracks: [
        { ...timeline.tracks[0], clips: [{ ...timeline.tracks[0].clips[0], duration: 120 }] },
      ],
    },
  ]) {
    const changed = changeTimeline(first, next);
    assert.equal(changed.revision, 2);
    assert.equal(first.revision, 1);
    assert.equal(second.timeline.tracks[0].clips[0].duration, 90);
    assert.equal(second.timeline.subtitles, 'ТЕКСТ');
  }
});
