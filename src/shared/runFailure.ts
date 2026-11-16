export const runFailureCodes = [
  'usage_limit',
  'rate_limit',
  'authentication',
  'network',
  'provider',
  'outputs',
  'opening',
  'continuation',
  'terminal_close',
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
  continuation: 'Цепочка остановлена',
  terminal_close: 'Не удалось закрыть Pi',
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
  terminal_close:
    'Результат сохранён, но Studio не смогла безопасно закрыть вкладку Pi. Цепочка приостановлена; другие окна не закрывались. Проверьте завершение операций и настройки Terminal или продолжите работу вручную. Автоматического повтора нет.',
  continuation:
    'Не удалось запустить следующего агента цепочки. Предыдущий результат готов и сохранён. Проверьте подключение, модель и ресурсы следующего агента, затем запустите его вручную. Автоматического повтора нет.',
};
export interface RunFailureNotice {
  projectRoot: string;
  projectId: string;
  agentId: string;
  agentName: string;
  failure?: RunFailure;
  terminalDetail?: TerminalCloseDetail;
}

export const terminalCloseMessages = {
  automation_denied: 'macOS запретила Studio управлять Terminal. Разрешите доступ в настройках macOS → Конфиденциальность и безопасность → Автоматизация.',
  terminal_busy: 'Terminal не подтвердил завершение процессов во вкладке Pi за отведённое время.',
  shared_window: 'В этом окне Terminal есть другие вкладки. Studio сохранила всё окно, чтобы не закрыть их.',
  identity_changed: 'Изменились процесс, окно или заголовок вкладки Pi. Закрытие отменено.',
  terminal_unavailable: 'Не удалось найти точную вкладку Pi в Terminal.',
} as const;
export type TerminalCloseDetail = keyof typeof terminalCloseMessages;
export function terminalCloseDetail(value: unknown): TerminalCloseDetail | undefined {
  return typeof value === 'string' && Object.hasOwn(terminalCloseMessages, value)
    ? value as TerminalCloseDetail : undefined;
}
