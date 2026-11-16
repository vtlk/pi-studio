import type { ComputerPoint } from '../../shared/computerFeedback.ts';

export interface ComputerFeedback {
  begin(
    session: string,
    agentName: string,
    action: string,
    actionName?: string,
  ): void | Promise<void>;
  pointer(session: string, point?: ComputerPoint, click?: boolean): void | Promise<void>;
  /** Temporarily remove ALL surfaces before capture or native hit-testing. */
  suspend(): void | Promise<void>;
  resume(): void | Promise<void>;
  finish(session: string): void;
  release(session: string): void;
  close(): void;
}

export const computerActionLabels: Record<string, string> = {
  list_apps: 'Ищет приложение',
  list_windows: 'Ищет окно',
  launch_app: 'Открывает приложение',
  get_window_state: 'Читает окно',
  get_desktop_state: 'Смотрит на экран',
  get_screen_size: 'Проверяет экран',
  click: 'Нажимает',
  drag: 'Перетаскивает',
  type_text: 'Вводит текст',
  press_key: 'Нажимает клавишу',
  hotkey: 'Нажимает сочетание клавиш',
  set_value: 'Изменяет поле',
  scroll: 'Прокручивает',
  invoke_menu: 'Выбирает пункт меню',
};

export function computerAgentLabel(name: string) {
  return (
    name
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Агент'
  );
}
