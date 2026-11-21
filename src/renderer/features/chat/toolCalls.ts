import type { ChatMessage, ChatPart } from '../../../shared/chat';
import { t } from '../../../shared/i18n/index.ts';
import { builtinToolHeading } from './builtinToolHeading.ts';

export interface ToolCallEntry {
  key: string;
  call: ChatPart;
  result?: ChatMessage;
}
export type ToolStatus = 'running' | 'success' | 'error' | 'missing';

/** Correlate by native toolCallId, never by display name or result position. */
export function indexToolCalls(messages: ChatMessage[]) {
  const calls = new Map<string, ToolCallEntry>(),
    pending = new Map<string, ToolCallEntry[]>();
  const occurrences = new Map<string, number>(),
    matchedResults = new Set<number>();
  messages.forEach((message, messageIndex) => {
    message.parts.forEach((part, partIndex) => {
      if (part.type !== 'toolCall') return;
      const id = part.id || `unknown-${messageIndex}-${partIndex}`;
      const occurrence = occurrences.get(id) ?? 0;
      occurrences.set(id, occurrence + 1);
      const entry = { key: `${id}:${occurrence}`, call: part };
      calls.set(`${messageIndex}:${partIndex}`, entry);
      if (part.id) pending.set(part.id, [...(pending.get(part.id) ?? []), entry]);
    });
    if (message.role === 'toolResult' && message.toolCallId) {
      const entry = pending.get(message.toolCallId)?.pop();
      if (entry) {
        entry.result = message;
        matchedResults.add(messageIndex);
      }
    }
  });
  let currentMessageIndex = messages.length - 1;
  while (currentMessageIndex >= 0 && messages[currentMessageIndex].role === 'toolResult')
    currentMessageIndex--;
  return { calls, matchedResults, currentMessageIndex };
}
export function toolStatus(entry: ToolCallEntry, working: boolean): ToolStatus {
  return entry.result
    ? entry.result.isError || entry.result.error
      ? 'error'
      : 'success'
    : working
      ? 'running'
      : 'missing';
}
export function parseToolArguments(value: string | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
export function prettyToolText(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
export function toolHeading(
  entry: ToolCallEntry,
  status: ToolStatus,
  agentNames?: ReadonlyMap<string, string>,
) {
  const name = entry.call.name || entry.result?.toolName || t('Chat.tool');
  const args = parseToolArguments(entry.call.arguments);
  const builtin = builtinToolHeading(name, args, agentNames);
  if (builtin) return builtin;
  const kind =
    name === 'read' || name === 'read_project_file' || name.endsWith('_read_project_file')
      ? 'read'
      : name === 'write'
        ? 'write'
        : name === 'edit'
          ? 'edit'
          : name === 'bash' || name === 'powershell'
            ? 'bash'
            : 'generic';
  const path = typeof args.path === 'string' ? args.path : '';
  const target =
    kind === 'bash'
      ? typeof args.command === 'string'
        ? args.command.split(/\r?\n/)[0].slice(0, 100)
        : ''
      : kind !== 'generic' && path
        ? (path.split(/[/\\]/).filter(Boolean).at(-1) ?? path)
        : '';
  const label =
    kind === 'generic'
      ? t(`ToolCard.generic.${status}`, { tool: name })
      : t(`ToolCard.${kind}.${status}`);
  return {
    name,
    label,
    target,
    friendly: kind !== 'generic',
    builtin: name === 'mcp__pi_studio__read_project_file',
  };
}
export function toolResultPreview(result: ChatMessage | undefined) {
  if (!result) return '';
  let text = result.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
  // Unwrap only the standard MCP content envelope, leaving arbitrary business JSON intact.
  try {
    const value = JSON.parse(text);
    if (value && Array.isArray(value.content)) {
      const plain = value.content
        .filter(
          (part: { type?: unknown; text?: unknown }) =>
            part?.type === 'text' && typeof part.text === 'string',
        )
        .map((part: { text: string }) => part.text)
        .join('\n');
      if (plain) text = plain;
    }
  } catch {
    /* Ordinary tool output is often plain text. */
  }
  const line =
    (result.error || text)
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? '';
  if (!line && result.parts.some((part) => part.type === 'image')) return t('Chat.image');
  return line.length > 180 ? line.slice(0, 177) + '…' : line;
}
