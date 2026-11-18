import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../src/shared/chat.ts';
import { changeLanguage } from '../src/shared/i18n/index.ts';
import {
  indexToolCalls,
  toolHeading,
  toolResultPreview,
  toolStatus,
} from '../src/renderer/features/chat/toolCalls.ts';
import { projectChatMessage } from '../src/main/pi/chatProjection.ts';

const call = (id: string, name = 'read') => ({
  type: 'toolCall' as const,
  id,
  name,
  arguments: '{"path":"C:\\\\project\\\\script.md"}',
});
const result = (toolCallId: string, text: string): ChatMessage => ({
  id: text,
  role: 'toolResult',
  toolCallId,
  toolName: 'read',
  parts: [{ type: 'text', text }],
});

test('parallel/reused tool IDs correlate only to their preceding call; orphan results remain visible', () => {
  const messages: ChatMessage[] = [
    result('orphan', 'unmatched'),
    { id: 'a', role: 'assistant', parts: [call('a'), call('b')] },
    result('b', 'B'),
    result('a', 'A'),
    { id: 'repeat', role: 'assistant', parts: [call('a')] },
    result('a', 'A2'),
    { id: 'no-id', role: 'assistant', parts: [{ ...call(''), id: undefined }] },
    result('other', 'never match by name'),
  ];
  const indexed = indexToolCalls(messages);
  assert.equal(indexed.calls.get('1:0')?.result?.parts[0].text, 'A');
  assert.equal(indexed.calls.get('1:1')?.result?.parts[0].text, 'B');
  assert.equal(indexed.calls.get('4:0')?.result?.parts[0].text, 'A2');
  assert.notEqual(indexed.calls.get('1:0')?.key, indexed.calls.get('4:0')?.key);
  assert.equal(indexed.calls.get('6:0')?.result, undefined);
  assert.deepEqual([...indexed.matchedResults], [2, 3, 5]);
  assert.equal(indexed.currentMessageIndex, 6);
});

test('tool labels translate status and Windows filename without translating names/command/output', async () => {
  const entry = { key: 'a', call: call('a'), result: result('a', 'Original output') };
  for (const language of ['ru', 'en'] as const) {
    await changeLanguage(language);
    assert.equal(toolHeading(entry, 'success').target, 'script.md');
    assert.equal(
      toolHeading(entry, 'success').label,
      language === 'ru' ? 'Прочитан файл' : 'Read file',
    );
    assert.equal(
      toolHeading({ ...entry, call: call('a', 'mcp__custom__lookup') }, 'error').label,
      language === 'ru' ? 'Ошибка: mcp__custom__lookup' : 'Error: mcp__custom__lookup',
    );
    assert.equal(toolResultPreview(entry.result), 'Original output');
  }
  await changeLanguage('ru');
  assert.equal(toolStatus(entry, true), 'success');
  assert.equal(
    toolStatus({ ...entry, result: { ...entry.result, isError: true } }, false),
    'error',
  );
  assert.equal(toolStatus({ key: 'a', call: entry.call }, false), 'missing');
  assert.equal(toolStatus({ key: 'a', call: entry.call }, true), 'running');
});

test('previews unwrap standard MCP text only, and shell failures preserve command and error status', () => {
  assert.equal(
    toolResultPreview(
      result('a', JSON.stringify({ content: [{ type: 'text', text: 'First line\nSecond line' }] })),
    ),
    'First line',
  );
  assert.equal(toolResultPreview(result('a', '{"business":"value"}')), '{"business":"value"}');
  assert.ok(toolResultPreview(result('a', 'x'.repeat(1000))).length <= 180);
  const projected = projectChatMessage(
    { role: 'bashExecution', command: 'npm run check', exitCode: 2, output: 'failed' },
    'shell',
  );
  assert.equal(projected.command, 'npm run check');
  assert.equal(projected.isError, true);
  assert.equal(projected.parts[0].text, 'failed');
});

test('PowerShell uses the shared translated shell card and preserves the command', async () => {
  const command = "& 'C:\\Node folder\\node.exe' --version";
  const entry = {
    key: 'ps',
    call: { ...call('ps', 'powershell'), arguments: JSON.stringify({ command }) },
  };
  for (const language of ['ru', 'en'] as const) {
    await changeLanguage(language);
    const heading = toolHeading(entry, 'success');
    assert.equal(heading.label, language === 'ru' ? 'Команда выполнена' : 'Command completed');
    assert.equal(heading.target, command);
    assert.equal(heading.name, 'powershell');
  }
  await changeLanguage('ru');
});
