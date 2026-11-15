import type { TeamJournal } from './TeamJournal.ts';
import { publicMessage } from './types.ts';
export async function waitForTeamMessage(
  journal: TeamJournal,
  armed: Set<string>,
  id: string,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    const item = await journal.get(id);
    if (!item) throw new Error('Сообщение не найдено.');
    if (['completed', 'failed', 'uncertain', 'cancelled'].includes(item.state))
      return {
        ...publicMessage(item, armed.has(id)),
        instruction:
          item.state === 'completed'
            ? 'Поручение завершено. Прочитайте output получателя перед продолжением.'
            : 'Поручение не завершено. Остановитесь и сообщите причину пользователю; не продолжайте зависимую работу и не отправляйте повтор с новым request_id.',
      };
    if (
      item.state === 'queued' &&
      (!armed.has(id) || /ожидает пользователя|вопроса\/ошибки|цепочка/.test(item.reason ?? ''))
    )
      return {
        ...publicMessage(item, armed.has(id)),
        instruction:
          'Нужно явное продолжение пользователя. Остановитесь, не продолжайте зависимую работу.',
      };
    await new Promise<void>((resolve) => {
      const abort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 250);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  throw new Error(
    'Ожидание прервано; поручение могло быть принято. Проверьте message_status с тем же ID. Не повторяйте с новым request_id и не продолжайте зависимую работу.',
  );
}
