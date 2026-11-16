import { t, type MessageKey } from '../shared/i18n/index.ts';
import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Monitor, MousePointer2 } from 'lucide-react';
import { computerFeedbackEvent, type ComputerFeedbackState } from '../shared/computerFeedback';
import './computer-overlay.css';

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
  default: 'computerOverlay.action.default',
};

function ComputerOverlay() {
  const [state, setState] = useState<ComputerFeedbackState>();
  useLayoutEffect(() => {
    const update = (event: Event) => {
      const value = (event as CustomEvent<ComputerFeedbackState>).detail;
      document.documentElement.lang = value.language ?? 'en';
      setState(value);
    };
    window.addEventListener(computerFeedbackEvent, update);
    return () => window.removeEventListener(computerFeedbackEvent, update);
  }, []);
  if (!state) return null;
  const { point } = state;
  const language = state.language ?? 'en';
  const right = point && point.x > window.innerWidth - 220;
  const bottom = point && point.y > window.innerHeight - 80;
  return (
    <>
      <div className="computer-screen-edge" aria-hidden="true" />
      <div className="computer-indicator" role="status" style={{ top: state.badgeTop }}>
        <Monitor size={16} aria-hidden="true" />
        <span>
          <strong>{state.agentName}</strong>{' '}
          {t('computer-overlay.isUsingTheComputer', { lng: language }).trimStart()}
        </span>
        <span className="computer-indicator-action">
          {state.actionName
            ? t(actionKeys[state.actionName] ?? 'computerOverlay.action.default', { lng: language })
            : state.action}
        </span>
      </div>
      {point && (
        <div
          className="computer-pointer"
          style={{ left: point.x, top: point.y }}
          aria-hidden="true"
        >
          <MousePointer2 className="computer-pointer-icon" size={29} strokeWidth={1.6} />
          <span
            className={`computer-pointer-label${right ? ' align-right' : ''}${bottom ? ' align-bottom' : ''}`}
          >
            {state.agentName}
          </span>
          {state.click > 0 && <span key={state.click} className="computer-click-ring" />}
        </div>
      )}
    </>
  );
}

flushSync(() => createRoot(document.getElementById('root')!).render(<ComputerOverlay />));
