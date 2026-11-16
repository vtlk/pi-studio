import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeContext } from './Theme.context';
import {
  themeChoice,
  themeState,
  type ThemeChoice,
  type ThemeState,
} from '../../../shared/appearance';

function apply(theme: ThemeChoice) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
/** Native matchMedia already reflects main's saved nativeTheme override before first paint. */
export function initialTheme(native: boolean): ThemeState {
  let preference: ThemeState['preference'] = 'system';
  let error: string | undefined;
  if (!native) {
    try {
      const saved = localStorage.getItem('pistudio-theme');
      if (themeChoice(saved)) preference = saved;
    } catch {
      error = 'Выбор темы недоступен в хранилище браузера.';
    }
  }
  const theme =
    preference === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference;
  apply(theme);
  return { preference, theme, revision: -1, ...(error ? { error } : {}) };
}
export function ThemeProvider({
  children,
  initial,
  native,
}: {
  children: ReactNode;
  initial: ThemeState;
  native: boolean;
}) {
  const [state, setState] = useState(initial);
  const current = useRef(state),
    epoch = useRef(0),
    pending = useRef(false),
    revision = useRef(-1);
  const put = (value: ThemeState) => {
    current.current = value;
    apply(value.theme);
    setState(value);
  };
  useEffect(() => {
    let disposed = false;
    const receive = (value: ThemeState) => {
      if (disposed || pending.current || !themeState(value) || value.revision < revision.current)
        return;
      revision.current = value.revision;
      current.current = value;
      apply(value.theme);
      setState(value);
    };
    if (native && window.studio) {
      const off = window.studio.onThemeChanged(receive);
      const readEpoch = epoch.current;
      void window.studio.getTheme().then(receive, () => {
        if (!disposed && !pending.current && epoch.current === readEpoch)
          setState((previous) => ({ ...previous, error: 'Не удалось прочитать настройки темы.' }));
      });
      return () => {
        disposed = true;
        off();
      };
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => {
      if (current.current.preference !== 'system') return;
      const value = {
        ...current.current,
        theme: media.matches ? ('dark' as const) : ('light' as const),
      };
      current.current = value;
      apply(value.theme);
      setState(value);
    };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, [native]);
  const choose = async (theme: ThemeChoice) => {
    const requested = ++epoch.current;
    pending.current = true;
    put({ ...current.current, preference: theme, theme, error: undefined });
    try {
      if (native) {
        if (!window.studio) throw Error();
        const value = await window.studio.setTheme(theme);
        if (!themeState(value)) throw Error();
        if (requested !== epoch.current) return;
        revision.current = Math.max(revision.current, value.revision);
        put(value);
      } else localStorage.setItem('pistudio-theme', theme);
    } catch {
      if (requested === epoch.current)
        put({
          ...current.current,
          error:
            'Выбор темы не сохранён. При следующем запуске будет использована прежняя настройка.',
        });
    } finally {
      if (requested === epoch.current) pending.current = false;
    }
  };
  return (
    <ThemeContext.Provider
      value={{
        ...state,
        choose: (theme) => void choose(theme),
        toggle: () => void choose(current.current.theme === 'dark' ? 'light' : 'dark'),
      }}
    >
      {children}
      {state.error && (
        <aside className="theme-error" role="alert">
          <span>{state.error}</span>
          <button className="button" onClick={() => void choose(state.theme)}>
            Повторить сохранение
          </button>
        </aside>
      )}
    </ThemeContext.Provider>
  );
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw Error('ThemeProvider is missing');
  return value;
}
