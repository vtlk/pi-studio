import type { Agent } from './studio.ts';
import type { Resource } from './resources.ts';

export const libraryMcpId = 'pistudio-library';
export const libraryMcp: Resource = {
  id: libraryMcpId,
  name: 'Pi Studio · Библиотека',
  kind: 'mcps',
  source: 'builtin:library',
  version: 'Встроенный',
  description:
    'Поиск, чтение, подготовка, проверка и публикация персонажей и локаций. Генератор и навыки подключаются отдельно.',
  transport: 'Встроенный',
  args: '',
  credential: '',
  contents: '',
  createdAt: 0,
};
export const browserMcp: Resource = {
  ...libraryMcp,
  id: 'pistudio-browser',
  name: 'Pi Studio · Браузер',
  source: 'builtin:browser',
  version: 'agent-browser 0.43.0',
  description:
    'Визуальное управление отдельным локальным браузером: снимки, координатные действия, ввод и вкладки. Профиль закреплён за диалогом Pi. Нужна модель с поддержкой изображений; компоненты устанавливаются отдельно.',
};
export const computerMcp: Resource = {
  ...libraryMcp,
  id: 'pistudio-computer',
  name: 'Pi Studio · Компьютер',
  source: 'builtin:computer',
  version: 'Cua Driver 0.49.11',
  description:
    'Управление приложениями macOS по снимкам окна и координатам. Нужны модель с поддержкой изображений и разрешения macOS для Pi Studio. Некоторые действия требуют активного окна.',
};
export const teamMcpId = 'pistudio-team';
export const teamMcp: Resource = {
  ...libraryMcp,
  id: teamMcpId,
  name: 'team',
  source: 'builtin:team',
  description:
    'Агенты своей команды в текущем проекте: чтение настроек и результатов, передача сообщений в точный диалог. Назначается явно; вне проекта недоступен.',
};
export const optionalBuiltinMcps = [libraryMcp, teamMcp];
export function hasTeamMcp(agent: Pick<Agent, 'mcps' | 'capabilitySettings'>) {
  return (
    agent.mcps.includes(teamMcpId) &&
    agent.capabilitySettings?.[`mcps:${teamMcpId}`]?.enabled !== false
  );
}
export const builtinResources: readonly Resource[] = [
  {
    ...libraryMcp,
    id: 'pistudio-project',
    name: 'Pi Studio · Проект',
    source: 'builtin:project',
    description:
      'Обязательные инструменты проектной сессии: текущий контекст и файлы проекта, веб-поиск, проверка результата и монтажного манифеста. Подключается автоматически к проектным агентам.',
  },
  libraryMcp,
  teamMcp,
  browserMcp,
  computerMcp,
  {
    ...libraryMcp,
    id: 'pistudio-administration',
    name: 'Pi Studio · Ресурсы и агенты',
    source: 'builtin:administration',
    description:
      'Административные инструменты помощника настройки: каталог, подключения, навыки, MCP, пакеты и настройки агентов. Закреплён за помощником и не выдаётся проектным агентам.',
  },
];
export function reservedMcpName(name: string) {
  return ['pi_studio', 'pi_studio_browser', 'pi_studio_computer', 'team'].includes(
    name.replaceAll('-', '_'),
  );
}
export function builtinResource(id: string) {
  return builtinResources.find((item) => item.id === id);
}
export function hasLibraryMcp(agent: Pick<Agent, 'mcps' | 'capabilitySettings'>) {
  return (
    agent.mcps.includes(libraryMcpId) &&
    agent.capabilitySettings?.[`mcps:${libraryMcpId}`]?.enabled !== false
  );
}
