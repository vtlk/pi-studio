import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { safePath, withReadDeadline } from '../storage/files.ts';
import { messageHash } from './TeamJournal.ts';
import type { TeamMessage } from './types.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';

export function deliveryText(message: TeamMessage) {
  return `[Pi Studio team task; project=${message.projectId}; from=${message.senderId}; to=${message.recipientId}; message=${message.id}; request=${message.requestId}]\n${message.text}`;
}
/** Receipt is proven by the canonical Pi user entry, never by terminal/HTTP success. */
export async function verifyReceipt(
  run: PreparedRun,
  message: TeamMessage,
  entryId: unknown,
  hash: string,
) {
  if (typeof entryId !== 'string' || !run.agent.session || message.runId !== run.record.runId)
    throw new Error('Нет точной binding для подтверждения team.');
  const path = await safePath(run.projectRoot, run.agent.session.path);
  return withReadDeadline(async () => {
    const input = createReadStream(path, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (line.length > 4_000_000) throw new Error('Слишком большая запись Pi.');
        const entry = JSON.parse(line);
        if (entry.id !== entryId) continue;
        const content = entry.message?.content;
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content
                  .filter((part) => part.type === 'text')
                  .map((part) => part.text)
                  .join('')
              : '';
        if (
          entry.type !== 'message' ||
          entry.message?.role !== 'user' ||
          messageHash(text) !== hash
        )
          throw new Error('Запись Pi не подтверждает получение этого сообщения.');
        return;
      }
      throw new Error('Сообщение ещё не записано в canonical Pi transcript.');
    } finally {
      lines.close();
      input.destroy();
    }
  });
}
