import { t, type MessageKey } from '../../../shared/i18n/index.ts';

/** Presentation state stores a key, never a translation frozen in the previous language. */
export type UiText = string | { key: MessageKey; values?: Record<string, unknown> };
export function uiText(key: MessageKey, values?: Record<string, unknown>): UiText {
  return { key, values };
}
export function textOf(value: UiText): string {
  return typeof value === 'string' ? value : t(value.key, value.values);
}
