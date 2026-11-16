import { useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { i18n, changeLanguage, t } from '../../../shared/i18n/index.ts';
import {
  isLanguage,
  isLanguageState,
  systemLanguage,
  type Language,
  type LanguageState,
} from '../../../shared/i18n/locale';

function apply(language: Language) {
  document.documentElement.lang = language;
  return changeLanguage(language);
}
export async function initialLanguage(native: boolean): Promise<LanguageState> {
  if (native) {
    if (!window.studio) throw new Error('Native bridge unavailable');
    const state = await window.studio.getLanguage();
    if (!isLanguageState(state)) throw new Error('Invalid language state');
    await apply(state.language);
    return state;
  }
  let state: LanguageState = {
    language: systemLanguage(navigator.language),
    preference: 'system',
    revision: 0,
  };
  try {
    const saved = localStorage.getItem('pistudio-language');
    if (isLanguage(saved)) state = { ...state, language: saved, preference: saved };
  } catch {
    state.error = 'read';
  }
  await apply(state.language);
  return state;
}
export function LanguageProvider({
  initial,
  native,
  children,
}: {
  initial: LanguageState;
  native: boolean;
  children: ReactNode;
}) {
  const [error, setError] = useState(initial.error);
  useEffect(() => {
    if (!native || !window.studio) return;
    return window.studio.onLanguageChanged((state) => {
      void apply(state.language);
      setError(state.error);
    });
  }, [native]);
  useTranslation(undefined, { i18n });
  return (
    <I18nextProvider i18n={i18n}>
      {children}
      {error && (
        <aside className="theme-error" role="alert">
          <span>{t(error === 'write' ? 'language.writeError' : 'language.readError')}</span>
          <button
            className="button"
            onClick={() => {
              void chooseLanguage(i18n.resolvedLanguage === 'ru' ? 'ru' : 'en', native).then(
                setError,
                () => setError('write'),
              );
            }}
          >
            {t('language.retry')}
          </button>
        </aside>
      )}
    </I18nextProvider>
  );
}
export async function chooseLanguage(
  language: Language,
  native: boolean,
): Promise<LanguageState['error']> {
  if (native) {
    const state = await window.studio!.setLanguage(language);
    if (!isLanguageState(state)) throw new Error('Invalid language state');
    await apply(state.language);
    return state.error;
  }
  await apply(language);
  try {
    localStorage.setItem('pistudio-language', language);
  } catch {
    return 'write';
  }
}
