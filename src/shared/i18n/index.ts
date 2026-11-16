import type webEn from './web.en.json';
import { createInstance } from 'i18next';
import en from './en.json' with { type: 'json' };
import ru from './ru.json' with { type: 'json' };
import type { Language } from './locale.ts';

/** Each process owns its instance. Catalogues are bundled; no network or translation of user data. */
export const i18n = createInstance();
void i18n.init({
  resources: { en: { translation: en }, ru: { translation: ru } },
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: ['en', 'ru'],
  initAsync: false,
  keySeparator: false,
  interpolation: { escapeValue: false },
});
type PluralBase<Key> =
  Key extends `${infer Base}_${'one' | 'two' | 'few' | 'many' | 'other' | 'zero'}` ? Base : Key;
export type MessageKey = keyof typeof en | keyof typeof webEn | PluralBase<keyof typeof en>;
export function t(key: MessageKey, values?: Record<string, unknown>): string {
  return i18n.t(key, values ?? {});
}
export function changeLanguage(language: Language) {
  return i18n.changeLanguage(language);
}
