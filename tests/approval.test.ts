import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvalReducer,
  initialApproval,
  isFilmAccepted,
} from '../src/renderer/features/project/model/approval.ts';

test('a new assembly cannot be rendered before human acceptance', () => {
  assert.equal(isFilmAccepted(initialApproval), false);
});
test('accepting scenes does not accept the complete film', () => {
  const state = approvalReducer(initialApproval, { type: 'set-scenes', scenes: [0, 1, 2, 3, 4] });
  assert.equal(isFilmAccepted(state), false);
});
test('acceptance belongs to a revision and is invalidated by a scene change', () => {
  const accepted = approvalReducer(
    { ...initialApproval, acceptedScenes: [0, 1] },
    { type: 'accept-film' },
  );
  assert.equal(isFilmAccepted(accepted), true);
  const changed = approvalReducer(accepted, { type: 'change-scene', scene: 0 });
  assert.equal(isFilmAccepted(changed), false);
  assert.equal(changed.revision, accepted.revision + 1);
  assert.deepEqual(changed.acceptedScenes, [1]);
  assert.equal(isFilmAccepted(accepted), true, 'the accepted snapshot is immutable');
});
