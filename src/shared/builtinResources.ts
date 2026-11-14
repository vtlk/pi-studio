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
export function hasLibraryMcp(agent: Pick<Agent, 'mcps' | 'capabilitySettings'>) {
  return (
    agent.mcps.includes(libraryMcpId) &&
    agent.capabilitySettings?.[`mcps:${libraryMcpId}`]?.enabled !== false
  );
}
