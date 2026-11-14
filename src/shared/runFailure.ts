export const runFailureCodes = [
  'usage_limit',
  'rate_limit',
  'authentication',
  'network',
  'provider',
  'outputs',
  'opening',
] as const;
export type RunFailure = (typeof runFailureCodes)[number];
export function runFailure(value: unknown): RunFailure {
  return runFailureCodes.includes(value as RunFailure) ? (value as RunFailure) : 'provider';
}
export const runFailureLabels: Record<RunFailure, string> = {
  usage_limit: 'Лимит подключения',
  rate_limit: 'Ограничение частоты',
  authentication: 'Требуется вход',
  network: 'Ошибка сети',
  provider: 'Ошибка провайдера',
  outputs: 'Ошибка результата',
  opening: 'Ошибка запуска Pi',
};
export const runFailureMessages: Record<RunFailure, string> = {
  usage_limit:
    'Достигнут лимит выбранного подключения. Продолжите этот диалог в Pi после восстановления лимита или явно выберите другое подключение и модель в настройках агента.',
  rate_limit: 'Провайдер ограничил частоту запросов. Повторите запрос в том же диалоге Pi позже.',
  authentication:
    'Провайдер не принял авторизацию. Проверьте выбранное подключение в настройках студии.',
  network:
    'Не удалось связаться с провайдером модели. Проверьте соединение и продолжите тот же диалог Pi.',
  provider: 'Провайдер не завершил запрос. Подробности доступны в диалоге Pi.',
  outputs:
    'Выходные файлы отсутствуют или изменились после сообщения о готовности. Проверьте результат в том же диалоге Pi.',
  opening: 'Не удалось открыть Pi. Проверьте выбранную модель, авторизацию и назначенные ресурсы.',
};
export interface RunFailureNotice {
  projectRoot: string;
  projectId: string;
  agentId: string;
  agentName: string;
  failure?: RunFailure;
}
