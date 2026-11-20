import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { settingsOutput } from '../src/main/pi/settingsOutput.ts';
import { t } from '../src/shared/i18n/index.ts';

const main = 'Промпт «с кавычками» 😀 \\ \n'.repeat(1600);
const instruction = 'Инструкция 🌆\t"\\\n'.repeat(900);
const value = {
  scope: 'studio-constructor',
  agent: { id: 'worker', name: 'Агент' },
  currentConstructor: {
    mainInstruction: main,
    instructions: [
      { id: 'on', enabled: true, content: instruction },
      { id: 'off', enabled: false, content: 'DISABLED_FULL_TEXT ' + instruction },
    ],
    roleInstructions: 'DERIVED_ONLY',
    resources: [{ id: 'r', enabled: false }],
    model: { id: 'm' },
  },
  freshStudioContext: { prompt: 'DERIVED_CONTEXT', appliedToOpenSession: false },
  appliedRuntime: {
    roleInstructions: 'DERIVED_APPLIED_ROLE',
    studioSystemPrompt: 'DERIVED_APPLIED_CONTEXT',
    status: 'waiting',
  },
};

function collect(options: Record<string, unknown> = {}) {
  let args: Record<string, unknown> = { agent_id: 'worker', ...options };
  let offset = 0,
    fingerprint: string | undefined,
    pages = 0;
  const fragments: string[] = [];
  while (++pages < 5000) {
    const result = settingsOutput(value, args) as {
      format?: string;
      content: string;
      pagination: {
        offset: number;
        nextOffset: number | null;
        complete: boolean;
        totalBytes: number;
        fingerprint: string;
      };
      nextCall: { arguments: Record<string, unknown> } | null;
    };
    assert.equal(result.format, 'json-fragment');
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= Number(options.max_bytes ?? 8192));
    assert.equal(result.pagination.offset, offset);
    fingerprint ??= result.pagination.fingerprint;
    assert.equal(result.pagination.fingerprint, fingerprint);
    fragments.push(result.content);
    offset += Buffer.byteLength(result.content);
    assert.ok(!result.content.includes('\ufffd'));
    if (result.pagination.complete) {
      assert.equal(result.nextCall, null);
      assert.equal(result.pagination.nextOffset, null);
      assert.equal(offset, result.pagination.totalBytes);
      const text = fragments.join('');
      assert.equal(createHash('sha256').update(text).digest('hex'), fingerprint);
      return { document: JSON.parse(text), pages };
    }
    assert.equal(result.pagination.nextOffset, offset);
    assert.ok(result.nextCall);
    args = result.nextCall.arguments;
  }
  throw Error('Pagination made no progress');
}

test('large escaped Cyrillic/emoji settings are lossless, bounded and complete across byte pages', () => {
  const before = structuredClone(value);
  for (const max_bytes of [1024, 4096, 8192]) {
    const result = collect({ max_bytes });
    assert.ok(result.pages > 1);
    assert.equal(result.document.currentConstructor.mainInstruction, main);
    assert.deepEqual(
      result.document.currentConstructor.instructions,
      value.currentConstructor.instructions,
    );
    assert.equal(result.document.currentConstructor.roleInstructions, undefined);
    assert.equal(result.document.currentConstructor.derivedPromptsAvailable, true);
    assert.equal(result.document.appliedRuntime.studioSystemPrompt, undefined);
    assert.equal(result.document.freshStudioContext.prompt, undefined);
  }
  assert.deepEqual(value, before, 'Formatting never changes the saved/current settings object');
});

test('derived prompt views remain explicitly readable without duplicating them in normal reads', () => {
  const result = collect({ include_derived_prompts: true });
  assert.deepEqual(result.document, value);
  const small = settingsOutput(
    {
      currentConstructor: {
        mainInstruction: 'raw',
        roleInstructions: 'duplicate',
        instructions: [],
      },
    },
    {},
  );
  assert.equal(small.pagination.complete, true);
  assert.equal(
    (small as { currentConstructor: { mainInstruction: string } }).currentConstructor
      .mainInstruction,
    'raw',
  );
});

test('changed settings or view never mix different revisions; offsets and budgets fail closed', () => {
  const first = settingsOutput(value, { agent_id: 'worker' }) as {
    nextCall: { arguments: Record<string, unknown> };
  };
  const args = first.nextCall.arguments;
  assert.throws(
    () => settingsOutput({ ...value, agent: { ...value.agent, name: 'Changed' } }, args),
    { message: t('SettingsRead.changed') },
  );
  assert.throws(() => settingsOutput(value, { ...args, include_derived_prompts: true }), {
    message: t('SettingsRead.changed'),
  });
  const bytes = Buffer.from(JSON.stringify({ text: 'Привет' }));
  const inline = settingsOutput({ text: 'Привет' }, {});
  const middle = bytes.indexOf(Buffer.from('П')) + 1;
  for (const invalid of [
    { offset: -1 },
    { offset: 1.5 },
    { offset: 10 },
    { max_bytes: 8193 },
    { max_bytes: 1 },
    { fingerprint: 'invalid' },
    { include_derived_prompts: 'true' },
    { offset: middle, fingerprint: inline.pagination.fingerprint },
    { offset: bytes.length + 1, fingerprint: inline.pagination.fingerprint },
  ]) {
    assert.throws(() => settingsOutput({ text: 'Привет' }, invalid), {
      message: t('SettingsRead.invalid'),
    });
  }
});
