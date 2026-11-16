export const languages = ['en', 'ru'] as const;
export type Language = (typeof languages)[number];
export interface LanguageState {
  language: Language;
  preference: Language | 'system';
  revision: number;
  error?: 'read' | 'write';
}
export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'ru';
}
/** The OS's primary language decides; unsupported languages use English. */
export function systemLanguage(locale: string | undefined): Language {
  return locale?.toLowerCase().split(/[-_]/)[0] === 'ru' ? 'ru' : 'en';
}
export function isLanguageState(value: unknown): value is LanguageState {
  if (!value || typeof value !== 'object') return false;
  const state = value as LanguageState;
  return (
    isLanguage(state.language) &&
    (state.preference === 'system' || isLanguage(state.preference)) &&
    Number.isSafeInteger(state.revision) &&
    (state.error === undefined || state.error === 'read' || state.error === 'write')
  );
}
