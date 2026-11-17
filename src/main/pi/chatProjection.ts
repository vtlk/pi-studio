import type { ChatMessage, ChatPart } from '../../shared/chat.ts';

const limit = 1_000_000;
export const chatText = (value: unknown, max = limit) =>
  typeof value === 'string' ? value.slice(0, max) : '';

/** Never pass provider objects, extension components or arbitrary resource config to the UI. */
export function projectChatMessage(value: unknown, id: string): ChatMessage {
  const message = (value ?? {}) as Record<string, unknown>;
  const parts: ChatPart[] = [];
  if (typeof message.content === 'string')
    parts.push({ type: 'text', text: chatText(message.content) });
  else if (Array.isArray(message.content)) {
    for (const part of message.content.slice(0, 200)) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text') parts.push({ type: 'text', text: chatText(part.text) });
      else if (part.type === 'thinking')
        parts.push({ type: 'thinking', text: chatText(part.thinking) });
      else if (part.type === 'toolCall')
        parts.push({
          type: 'toolCall',
          id: chatText(part.id, 500),
          name: chatText(part.name, 500),
          arguments: chatText(JSON.stringify(part.arguments ?? {})),
        });
      else if (part.type === 'image') {
        const mime = String(part.mimeType);
        const data = chatText(part.data, 10_000_000);
        parts.push({
          type: 'image',
          ...(/^image\/(png|jpeg|gif|webp)$/.test(mime) &&
          data &&
          /^[A-Za-z0-9+/=\r\n]+$/.test(data)
            ? { src: `data:${mime};base64,${data}` }
            : {}),
        });
      }
    }
  }
  // Bash/custom messages keep their text without exposing executable rendering hooks.
  if (!parts.length && typeof message.output === 'string')
    parts.push({ type: 'text', text: chatText(message.output) });
  return {
    id,
    role: chatText(message.role, 100),
    parts,
    ...(typeof message.toolCallId === 'string'
      ? { toolCallId: chatText(message.toolCallId, 500) }
      : {}),
    ...(typeof message.toolName === 'string' ? { toolName: chatText(message.toolName, 500) } : {}),
    ...(message.isError === true ? { isError: true } : {}),
    ...(message.errorMessage ? { error: chatText(message.errorMessage, 4000) } : {}),
  };
}
