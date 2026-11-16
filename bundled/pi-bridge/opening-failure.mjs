const messages = {
  resources:
    'Не удалось загрузить назначенные ресурсы Pi. Проверьте MCP, skills и расширения этого агента.',
  model: 'Выбранная модель недоступна в Pi. Проверьте модель в настройках этого агента.',
  thinking: 'Выбранный уровень рассуждения недоступен для этой модели.',
  images: 'Выбранная модель не принимает изображения из первого сообщения.',
  runtime: 'Pi не смог создать сеанс с выбранными настройками.',
  terminal: 'Pi не смог открыть интерфейс терминала.',
  mcp: 'Не завершена загрузка MCP.',
};
export class StudioOpeningError extends Error {
  constructor(kind, servers) {
    super(
      kind === 'mcp'
        ? `Не подключены MCP: ${servers.join(', ')}. Проверьте их в настройках агента или через /mcp в Pi.`
        : messages[kind],
    );
    this.issue = { kind, ...(servers ? { servers } : {}) };
  }
}
export function openingFailure(error, stage) {
  if (error instanceof StudioOpeningError) return error.issue;
  return { kind: Object.hasOwn(messages, stage) ? stage : 'runtime' };
}
export function openingFailureText(issue) {
  return issue.kind === 'mcp'
    ? `Не подключены MCP: ${issue.servers.join(', ')}. Проверьте их в настройках агента или через /mcp в Pi.`
    : messages[issue.kind];
}
