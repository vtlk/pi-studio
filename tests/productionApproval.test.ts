import assert from 'node:assert/strict';
import test from 'node:test';
import { scenePreviewStatus } from '../src/renderer/features/project/model/productionApproval.ts';
import type { WorkspaceProject } from '../src/renderer/features/project/model/workspace.types.ts';
const project: WorkspaceProject = { id: 'p', name: 'p', createdAt: 1, agents: [{ profile: { id: 'scenes', name: 'scenes', enabled: true, instructions: [], skills: [], mcps: [], plugins: [] }, outputPath: 'agents/scenes/output', entries: [ { kind: 'folder', id: 's1', name: 'Сцена', children: [{ kind: 'file', id: 'preview', name: 'сцена.svg', format: 'image' }] } ] }] };
test('all unique scene previews require acceptance of their current revision', () => {
  assert.equal(scenePreviewStatus(project).ready, false);
  assert.equal(scenePreviewStatus({ ...project, reviews: { preview: { revision: 1, acceptedRevision: 1 } } }).ready, true);
  assert.equal(scenePreviewStatus({ ...project, reviews: { preview: { revision: 2, acceptedRevision: 1 } } }).ready, false);
  assert.equal(scenePreviewStatus({ ...project, agents: [] }).ready, false);
});
