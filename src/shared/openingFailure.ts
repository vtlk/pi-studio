const messages = {
  resources:
    'Не удалось загрузить назначенные ресурсы Pi. Проверьте MCP, skills и расширения этого агента.',
  model: 'Выбранная модель недоступна в Pi. Проверьте модель в настройках этого агента.',
  thinking: 'Выбранный уровень рассуждения недоступен для этой модели.',
  images: 'Выбранная модель не принимает изображения из первого сообщения.',
  runtime: 'Pi не смог создать сеанс с выбранными настройками.',
  terminal: 'Pi не смог открыть интерфейс терминала.',
  mcp: 'Не завершена загрузка MCP.',
} as const;
export interface OpeningFailure {
  kind: keyof typeof messages;
  servers?: string[];
}
export function openingFailure(value: unknown): OpeningFailure | undefined {
  if (!value || typeof value !== 'object') return;
  const data = value as OpeningFailure;
  if (typeof data.kind !== 'string' || !Object.hasOwn(messages, data.kind)) return;
  if (data.kind !== 'mcp') return { kind: data.kind };
  if (
    !Array.isArray(data.servers) ||
    !data.servers.length ||
    data.servers.length > 32 ||
    data.servers.some((name) => typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(name))
  )
    return;
  return { kind: 'mcp', servers: [...new Set(data.servers)] };
}
export function openingFailureText(issue: OpeningFailure) {
  return issue.kind === 'mcp'
    ? `Не подключены MCP: ${issue.servers!.join(', ')}. Проверьте их в настройках агента или через /mcp в Pi.`
    : messages[issue.kind];
}
