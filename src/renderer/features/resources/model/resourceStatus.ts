import type { Resource } from '../../../../shared/resources';

export function resourceStatus(resource: Resource, native: boolean) {
  if (!native) return 'Пример · не подключён';
  if (!resource.check)
    return resource.localSkill ? 'Локальный skill · загрузка при запуске' : 'Не проверен';
  const labels = {
    available: 'Доступен',
    needs_auth: 'Нужен вход',
    unavailable: 'Недоступен',
    disabled: 'Выключен в Pi',
  };
  const date = new Date(resource.check.checkedAt).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  return `${labels[resource.check.status]} · проверка ${date}${resource.check.toolCount === undefined ? '' : ` · инструментов: ${resource.check.toolCount}`}`;
}
