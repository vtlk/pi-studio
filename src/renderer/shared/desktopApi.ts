import type { DesktopApi } from '../../shared/contracts';

/** Call only from native operations; demo paths still choose their own implementation. */
export function getStudioApi(): DesktopApi {
  if (!window.studio)
    throw new Error('Нативное подключение Pi Studio недоступно. Перезапустите приложение.');
  return window.studio;
}
