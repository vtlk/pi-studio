import { t } from '../../shared/i18n/index.ts';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(t('error.validation.expectedADataObject'));
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 200_000): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(t('error.validation.invalidTextField'));
  return value;
}
export function stableId(value: unknown): string {
  const id = text(value, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error(t('error.validation.invalidId'));
  return id;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error(t('error.validation.invalidSwitchValue'));
  return value;
}
export function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error(t('error.validation.invalidDate'));
  return value;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 10_000)
    throw new Error(t('error.validation.invalidList'));
  return value;
}
export function strings(value: unknown) {
  return list(value).map((item) => text(item, 2000));
}
