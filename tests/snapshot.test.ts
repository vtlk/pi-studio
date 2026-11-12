import assert from 'node:assert/strict';
import test from 'node:test';
import type { Agent } from '../src/renderer/entities/studio/types.ts';
import {
  snapshotAgents,
  compareAgents,
  refreshSnapshot,
  getCurrentAgentInstructions,
} from '../src/renderer/features/project/model/snapshot.ts';

const agent = (id: string): Agent => ({
  id,
  name: id,
  enabled: true,
  instructions: [{ id: 'base', name: 'Основная', content: 'Исходный текст', enabled: true }],
  skills: ['SVG'],
  mcps: [],
  plugins: [],
});

test('a project snapshot isolates all nested settings and the order from the global constructor', () => {
  const source = [agent('writer'), agent('scenes')];
  const saved = snapshotAgents(source);
  const secondProject = snapshotAgents(source);
  source[0].name = 'Новое название';
  source[0].instructions[0].content = 'Новая инструкция';
  source[0].skills.push('Remotion');
  source.reverse();
  assert.deepEqual(
    saved.map((item) => item.profile.id),
    ['writer', 'scenes'],
  );
  assert.equal(saved[0].profile.name, 'writer');
  assert.equal('instructions' in saved[0].profile, false);
  assert.equal('mainInstruction' in saved[0].profile, false);
  assert.deepEqual(getCurrentAgentInstructions('writer', source), ['Новая инструкция']);
  assert.deepEqual(saved[0].profile.skills, ['SVG']);
  saved[0].profile.enabled = false;
  assert.equal(secondProject[0].profile.enabled, true);
});

test('refresh adds new IDs once and preserves existing snapshots, missing agents, output folders and files', () => {
  const saved = snapshotAgents([agent('writer'), agent('removed')]);
  saved[0].entries = [
    { kind: 'file', id: 'script', name: 'script.txt', format: 'text', content: 'Готовый сценарий' },
  ];
  const changed = agent('writer');
  changed.name = 'Обновлённый сценарист';
  const current = [agent('new'), changed];
  const diff = compareAgents(saved, current);
  assert.deepEqual(
    diff.added.map((item) => item.id),
    ['new'],
  );
  assert.deepEqual(
    diff.changed.map((item) => item.id),
    ['writer'],
  );
  assert.deepEqual(
    diff.missing.map((item) => item.id),
    ['removed'],
  );
  const refreshed = refreshSnapshot(saved, current, false);
  assert.deepEqual(
    refreshed.map((item) => item.profile.id),
    ['new', 'writer', 'removed'],
  );
  assert.equal(refreshed[1].profile.name, 'writer');
  assert.equal(refreshed[1].entries, saved[0].entries);
  assert.equal(refreshed[1].outputPath, saved[0].outputPath);
  assert.equal(refreshSnapshot(refreshed, current, false).length, 3);
});

test('updating changed profiles requires an explicit choice and never replaces their outputs', () => {
  const saved = snapshotAgents([agent('writer')]);
  saved[0].entries = [
    { kind: 'file', id: 'script', name: 'script.txt', format: 'text', content: 'Сценарий' },
  ];
  const changed = agent('writer');
  changed.enabled = false;
  changed.instructions[0].content = 'Обновлено';
  const refreshed = refreshSnapshot(saved, [changed], true);
  assert.equal(refreshed[0].profile.enabled, false);
  assert.equal('instructions' in refreshed[0].profile, false);
  assert.equal(refreshed[0].entries, saved[0].entries);
  assert.equal(saved[0].profile.enabled, true);
  changed.instructions[0].content = 'Ещё одна правка';
  assert.equal('instructions' in refreshed[0].profile, false);
});

test('instruction edits create no project snapshots or refresh changes; next execution reads current text', () => {
  const current = [agent('writer')];
  current[0].mainInstruction = 'Первое направление';
  const project = snapshotAgents(current);
  project[0].entries = [
    {
      kind: 'file',
      id: 'script',
      name: 'script.md',
      format: 'markdown',
      content: 'Ранее созданный результат',
    },
  ];
  const before = structuredClone(project);
  assert.deepEqual(getCurrentAgentInstructions('writer', current), [
    'Первое направление',
    'Исходный текст',
  ]);
  current[0].mainInstruction = 'Актуальное направление';
  current[0].instructions[0].content = 'Актуальная инструкция';
  assert.deepEqual(compareAgents(project, current).changed, []);
  assert.deepEqual(project, before);
  assert.deepEqual(getCurrentAgentInstructions('writer', current), [
    'Актуальное направление',
    'Актуальная инструкция',
  ]);
  assert.equal('mainInstruction' in refreshSnapshot(project, current, true)[0].profile, false);
  assert.equal(getCurrentAgentInstructions('writer', []), undefined);
});
