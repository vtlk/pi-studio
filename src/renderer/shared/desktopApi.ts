import { t } from '../../shared/i18n/index.ts';
import type { DesktopApi } from '../../shared/contracts';

/** Call only from native operations; demo paths still choose their own implementation. */
export function getStudioApi(): DesktopApi {
  if (!window.studio) throw new Error(t('main.theNativePiStudioConnectionIsUnavailable'));
  return window.studio;
}
