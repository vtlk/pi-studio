export type ThemeChoice = 'light' | 'dark';
export interface ThemeState {
  preference: ThemeChoice | 'system';
  theme: ThemeChoice;
  revision: number;
  error?: string;
}
export function themeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark';
}
export function themeState(value: unknown): value is ThemeState {
  if (!value || typeof value !== 'object') return false;
  const data = value as ThemeState;
  return (
    (data.preference === 'system' || themeChoice(data.preference)) &&
    themeChoice(data.theme) &&
    Number.isSafeInteger(data.revision) &&
    data.revision >= 0 &&
    (data.error === undefined || typeof data.error === 'string')
  );
}
