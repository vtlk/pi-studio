import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskLanguageScores,
  languageCode,
  transcriptionPrefix,
} from '../src/renderer/features/voice/whisperLanguage.ts';

test('Whisper detection excludes text/task tokens and chooses the spoken language on each recording', () => {
  const languages = { '<|en|>': 1, '<|ru|>': 3, '<|kk|>': 5 };
  const scores = new Float32Array([99, 2, 90, 8, 80, 1, 100, 9, 90, 2, 80, 1]);
  maskLanguageScores(scores, 6, Object.values(languages));
  assert.deepEqual(
    [...scores],
    [-Infinity, 2, -Infinity, 8, -Infinity, 1, -Infinity, 9, -Infinity, 2, -Infinity, 1],
  );
  const argmax = (row: Float32Array) => row.indexOf(Math.max(...row));
  assert.equal(languageCode(languages, argmax(scores.subarray(0, 6))), 'ru');
  assert.equal(languageCode(languages, BigInt(argmax(scores.subarray(6)))), 'en');
});
test('unknown or unusable language detection fails instead of silently forcing English', () => {
  assert.throws(() => languageCode({ '<|ru|>': 3 }, 1), /did not identify/);
  assert.throws(
    () => maskLanguageScores(new Float32Array([1, -Infinity]), 2, [1]),
    /no language scores/,
  );
  assert.throws(() => maskLanguageScores(new Float32Array(2), 2, [3]), /vocabulary/);
});

test('Whisper prefix detects speech language, forces transcription rather than translation and reuses it only within the same recording', () => {
  const vocabulary = {
    decoder_start_token_id: 0,
    lang_to_id: { '<|en|>': 1, '<|ru|>': 2 },
    task_to_id: { translate: 3, transcribe: 4 },
    no_timestamps_token_id: 5,
  };
  const first = new Float32Array([0, 1, 9, 100, 100, 100]);
  assert.equal(transcriptionPrefix([0n], first, vocabulary), undefined);
  assert.equal(first.indexOf(Math.max(...first)), 2);
  const next = new Float32Array([0, 0, 0, 999, -Infinity, 0]);
  assert.equal(transcriptionPrefix([0n, 2n], next, vocabulary), 'ru');
  assert.equal(next.indexOf(Math.max(...next)), 4);
  const third = new Float32Array(6);
  assert.equal(transcriptionPrefix([0n, 2n, 4n], third, vocabulary), 'ru');
  assert.equal(third.indexOf(Math.max(...third)), 5);
  const chunk = new Float32Array([0, 99, 1, 0, 0, 0]);
  transcriptionPrefix([0n], chunk, vocabulary, 'ru');
  assert.equal(chunk.indexOf(Math.max(...chunk)), 2);
  const newRecording = new Float32Array([0, 99, 1, 0, 0, 0]);
  transcriptionPrefix([0n], newRecording, vocabulary);
  assert.equal(newRecording.indexOf(Math.max(...newRecording)), 1);
  const content = new Float32Array([1, 2, 3, 4, 5, 6]);
  transcriptionPrefix([0n, 2n, 4n, 5n], content, vocabulary, 'ru');
  assert.deepEqual([...content], [1, 2, 3, 4, 5, 6]);
});
