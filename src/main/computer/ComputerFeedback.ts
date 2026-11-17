import { t, type MessageKey } from '../../shared/i18n/index.ts';
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

const actionKeys: Record<string, MessageKey> = {
  list_apps: 'computerOverlay.action.list_apps',
  list_windows: 'computerOverlay.action.list_windows',
  launch_app: 'computerOverlay.action.launch_app',
  get_window_state: 'computerOverlay.action.get_window_state',
  get_desktop_state: 'computerOverlay.action.get_desktop_state',
  get_screen_size: 'computerOverlay.action.get_screen_size',
  click: 'computerOverlay.action.click',
  drag: 'computerOverlay.action.drag',
  type_text: 'computerOverlay.action.type_text',
  press_key: 'computerOverlay.action.press_key',
  hotkey: 'computerOverlay.action.hotkey',
  set_value: 'computerOverlay.action.set_value',
  scroll: 'computerOverlay.action.scroll',
  invoke_menu: 'computerOverlay.action.invoke_menu',
};

export function computerActionLabel(action: string) {
  return t(actionKeys[action] ?? 'computerOverlay.action.default');
}

export function computerAgentLabel(name: string) {
  return (
    name
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || t('computerOverlay.agent')
  );
}
