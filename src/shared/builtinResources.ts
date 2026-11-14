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
  {
    ...libraryMcp,
    id: 'pistudio-administration',
    name: 'Pi Studio · Ресурсы и агенты',
    source: 'builtin:administration',
    description:
      'Административные инструменты помощника настройки: каталог, подключения, навыки, MCP, пакеты и настройки агентов. Закреплён за помощником и не выдаётся проектным агентам.',
  },
];
export function builtinResource(id: string) {
  return builtinResources.find((item) => item.id === id);
}
export function hasLibraryMcp(agent: Pick<Agent, 'mcps' | 'capabilitySettings'>) {
  return (
    agent.mcps.includes(libraryMcpId) &&
    agent.capabilitySettings?.[`mcps:${libraryMcpId}`]?.enabled !== false
  );
}
