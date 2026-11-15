import { createHash } from 'node:crypto';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

// Claude's MCP carrier permits 50-character ASCII tool names. Studio's scoped
// MCP names can be longer. Alias only the transport; Pi keeps canonical names
// and executes the same assigned tools. Arguments and tool content stay intact.
export function scopedToolStream(upstream, model, context, options) {
  const names = new Set();
  for (const message of context.messages) {
    for (const tool of message.toolsAdded ?? []) names.add(tool.name);
    for (const tool of message.toolsRemoved ?? []) names.add(tool.name);
    for (const block of Array.isArray(message.content) ? message.content : [])
      if (block.type === 'toolCall') names.add(block.name);
    if (message.role === 'toolResult') names.add(message.toolName);
  }
  const aliases = new Map(
    [...names].map((name) => [
      name,
      /^[A-Za-z0-9_-]{1,50}$/.test(name)
        ? name
        : 'studio_' + createHash('sha256').update(name).digest('hex').slice(0, 32),
    ]),
  );
  if (new Set(aliases.values()).size !== aliases.size) throw Error('Claude tool alias collision');
  const originals = new Map([...aliases].map(([name, alias]) => [alias, name]));
  const rename = (name) => aliases.get(name) ?? name;
  const messages = context.messages.map((message) => {
    const next = { ...message };
    if (message.toolsAdded)
      next.toolsAdded = message.toolsAdded.map((tool) => ({ ...tool, name: rename(tool.name) }));
    if (message.toolsRemoved)
      next.toolsRemoved = message.toolsRemoved.map((tool) => ({
        ...tool,
        name: rename(tool.name),
      }));
    if (message.role === 'assistant')
      next.content = message.content.map((block) =>
        block.type === 'toolCall' ? { ...block, name: rename(block.name) } : block,
      );
    if (message.role === 'toolResult') next.toolName = rename(message.toolName);
    return next;
  });
  const restore = (message) => {
    if (message?.content)
      for (const block of message.content)
        if (block.type === 'toolCall') block.name = originals.get(block.name) ?? block.name;
  };
  const output = createAssistantMessageEventStream();
  void (async () => {
    try {
      for await (const source of upstream(model, { ...context, messages }, options)) {
        const event = structuredClone(source);
        restore(event.partial);
        restore(event.message);
        restore(event.error);
        if (event.toolCall)
          event.toolCall.name = originals.get(event.toolCall.name) ?? event.toolCall.name;
        output.push(event);
      }
    } catch (error) {
      const reason = options?.signal?.aborted ? 'aborted' : 'error';
      output.push({
        type: 'error',
        reason,
        error: {
          role: 'assistant',
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: Date.now(),
          stopReason: reason,
          errorMessage: error instanceof Error ? error.message : 'Claude tool transport failed',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      });
    } finally {
      output.end();
    }
  })();
  return output;
}
