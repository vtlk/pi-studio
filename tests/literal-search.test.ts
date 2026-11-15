import assert from 'node:assert/strict';
import test from 'node:test';
import { literalMatches, isFindShortcut } from '../src/renderer/shared/ui/literalSearch.ts';

test('literal search preserves Unicode UTF-16 offsets, case and regex punctuation as text', () => {
  const value = '😀 Красный a.b[0] КРАСНЫЙ красный';
  const matches = literalMatches(value, 'красный');
  assert.equal(matches.length, 3);
  assert.equal(matches[0].start, 3);
  assert.deepEqual(
    matches.map((match) => value.slice(match.start, match.end)),
    ['Красный', 'КРАСНЫЙ', 'красный'],
  );
  assert.deepEqual(
    literalMatches(value, 'a.b[0]').map((match) => value.slice(match.start, match.end)),
    ['a.b[0]'],
  );
  assert.deepEqual(literalMatches('', 'x'), []);
  assert.deepEqual(literalMatches(value, ''), []);
  assert.deepEqual(literalMatches(value, '[').length, 1);
});

test('find shortcut supports the physical F key on Russian macOS, without hijacking other shortcuts', () => {
  const event = {
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    code: 'KeyF',
    key: 'а',
  };
  assert.equal(isFindShortcut(event, true), true);
  assert.equal(isFindShortcut({ ...event, shiftKey: true }, true), false);
  assert.equal(isFindShortcut({ ...event, altKey: true }, true), false);
  assert.equal(isFindShortcut({ ...event, code: 'KeyG', key: 'п' }, true), false);
  assert.equal(isFindShortcut({ ...event, metaKey: false, ctrlKey: true }, true), false);
  assert.equal(isFindShortcut({ ...event, metaKey: false, ctrlKey: true }, false), true);
});
