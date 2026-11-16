import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectNativeRenderer } from '../scripts/native-renderer-guard.ts';

test('native build rejects web fixture imports and inlined example data', () => {
  const chunk = {
    type: 'chunk' as const,
    code: 'native code',
    modules: { '/src/renderer/main.tsx': {} },
  };
  assert.deepEqual(inspectNativeRenderer({ index: chunk }), {
    schemaVersion: 1,
    entry: 'main.tsx',
    modules: 1,
    webExampleModules: 0,
  });
  for (const id of [
    '/src/renderer/fixtures/agents.ts',
    '/src/renderer/main.web.tsx',
    '/src/renderer/features/project/model/useDemoWorkspaceState.ts',
    '/public/assets/source.json',
  ])
    assert.throws(
      () => inspectNativeRenderer({ index: { ...chunk, modules: { ...chunk.modules, [id]: {} } } }),
      /Web-only modules/,
    );
  for (const code of [
    'Посылка с характером',
    'men-02-garage-guy',
    'Сохраняй единый стиль проекта: геометрическая 2D-графика',
  ])
    assert.throws(() => inspectNativeRenderer({ index: { ...chunk, code } }), /Web example data/);
  for (const id of [
    '/node_modules/remotion/dist/index.js',
    '/node_modules/@remotion/player/dist/index.js',
    'C:\\node_modules\\@remotion\\media\\dist\\index.js',
  ])
    assert.throws(
      () => inspectNativeRenderer({ index: { ...chunk, modules: { ...chunk.modules, [id]: {} } } }),
      /must not be bundled/,
    );
  assert.throws(
    () => inspectNativeRenderer({ index: { ...chunk, modules: {} } }),
    /entry is missing/,
  );
});
