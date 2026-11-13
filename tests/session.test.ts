import assert from 'node:assert/strict';
import test from 'node:test';
import { getAgentLaunchAction } from '../src/renderer/features/project/model/session.ts';
import { getAgentDisplayStatus } from '../src/renderer/features/project/model/agentActivity.ts';
import type { ProjectAgent } from '../src/renderer/features/project/model/workspace.types.ts';

const agent = (): ProjectAgent => ({
  profile: {
    id: 'writer',
    name: 'Сценарист',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
  },
  outputPath: 'agents/writer/output',
  entries: [],
});

test('only an agent without a session can start its first dialogue', () => {
  assert.deepEqual(getAgentLaunchAction(agent()), { kind: 'start' });
  const current = agent();
  current.session = {
    id: 'one',
    title: 'Диалог',
    path: 'agents/writer/sessions/one.jsonl',
    createdAt: 1,
    initialMessage: 'Направление сценария',
  };
  const before = structuredClone(current);
  for (let i = 0; i < 3; i++) {
    const action = getAgentLaunchAction(current);
    assert.equal(action.kind, 'resume');
    if (action.kind === 'resume') assert.equal(action.session, current.session);
  }
  assert.deepEqual(current, before);
});

test('missing session and disabled agent cannot create a replacement dialogue', () => {
  const current = agent();
  current.session = {
    id: 'missing',
    title: 'Диалог',
    path: 'agents/writer/sessions/missing.jsonl',
    createdAt: 1,
    missing: true,
  };
  assert.equal(getAgentLaunchAction(current).kind, 'blocked');
  current.session = { ...current.session, missing: false, path: '' };
  assert.equal(getAgentLaunchAction(current).kind, 'blocked');
  delete current.session;
  current.profile.enabled = false;
  assert.equal(getAgentLaunchAction(current).kind, 'blocked');
});

test('a moved session retains the exact history binding and requires supported forking', () => {
  const current = agent();
  current.session = {
    id: 'original',
    title: 'Диалог',
    path: 'agents/writer/sessions/original.jsonl',
    createdAt: 1,
    needsFork: true,
  };
  const action = getAgentLaunchAction(current);
  assert.equal(action.kind, 'resume');
  if (action.kind === 'resume') {
    assert.equal(action.session.id, 'original');
    assert.equal(action.session.needsFork, true);
  }
});

test('a saved dialogue without a live runtime is stopped, never shown as never launched or waiting', () => {
  const current = agent();
  assert.equal(getAgentDisplayStatus(current), 'idle');
  current.session = {
    id: 'saved',
    title: 'Диалог',
    path: 'agents/writer/sessions/saved.jsonl',
    createdAt: 1,
  };
  assert.equal(getAgentDisplayStatus(current), 'stopped');
  current.runStatus = 'waiting';
  assert.equal(getAgentDisplayStatus(current), 'waiting');
  current.profile.enabled = false;
  assert.equal(getAgentDisplayStatus(current), 'disabled');
});
