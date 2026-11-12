import assert from 'node:assert/strict';
import test from 'node:test';
import { clampCamera } from '../src/renderer/features/library/model/camera.ts';

test('camera cannot pan at fit size and stays inside the zoomed image edges', () => {
  const viewport = { width: 1000, height: 500 };
  const image = { width: 2000, height: 1000 };
  assert.deepEqual(clampCamera({ zoom: 1, x: 300, y: -200 }, viewport, image), {
    zoom: 1,
    x: 0,
    y: 0,
  });
  assert.deepEqual(clampCamera({ zoom: 2, x: 900, y: -800 }, viewport, image), {
    zoom: 2,
    x: 500,
    y: -250,
  });
});

test('camera respects letterboxing instead of allowing a narrow image to drift sideways', () => {
  assert.deepEqual(
    clampCamera(
      { zoom: 2, x: 100, y: 1000 },
      { width: 1000, height: 500 },
      { width: 500, height: 1000 },
    ),
    { zoom: 2, x: 0, y: 250 },
  );
});

test('zoom reduction and viewport resize reclamp the existing pan', () => {
  const image = { width: 1600, height: 900 };
  assert.deepEqual(clampCamera({ zoom: 0.5, x: 400, y: 100 }, { width: 800, height: 450 }, image), {
    zoom: 1,
    x: 0,
    y: 0,
  });
  assert.deepEqual(clampCamera({ zoom: 7, x: 9000, y: 9000 }, { width: 400, height: 225 }, image), {
    zoom: 4,
    x: 600,
    y: 337.5,
  });
});
