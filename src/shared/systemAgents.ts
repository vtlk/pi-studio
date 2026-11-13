import type { Agent } from './studio.ts';
import { setupAssistantInstruction } from './systemAgentInstructions.ts';

export const systemAgentRoles = ['character', 'location', 'assistant'] as const;
export type SystemAgentRole = (typeof systemAgentRoles)[number];
export interface SystemAgent extends Agent {
  systemRole: SystemAgentRole;
}
export const systemAgentDefinitions = {
  character: {
    name: 'Создание персонажа',
    mcp: 'Pi Studio · Библиотека',
    description: 'Чтение, подготовка, проверка и публикация персонажей общей библиотеки.',
  },
  location: {
    name: 'Создание сцены',
    mcp: 'Pi Studio · Библиотека',
    description: 'Чтение, подготовка, проверка и публикация сцен/локаций общей библиотеки.',
  },
  assistant: {
    name: 'Помощник настройки',
    mcp: 'Pi Studio · Ресурсы и агенты',
    description: 'Настройка MCP, skills, plugins, инструкций, подключений и их назначений агентам.',
  },
} as const;
export function createSystemAgents(id: () => string): SystemAgent[] {
  return systemAgentRoles.map((systemRole) => ({
    id: id(),
    systemRole,
    name: systemAgentDefinitions[systemRole].name,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    mainInstruction:
      systemRole === 'assistant'
        ? setupAssistantInstruction
        : `Ты — встроенный агент ${systemRole === 'character' ? 'создания и изменения персонажей' : 'создания и изменения сцен/локаций'} общей библиотеки Pi Studio. Выполняй запрос пользователя и используй назначенные навыки/инструменты. Сначала прочитай library_get_contract; нужные существующие материалы найди через library_find_assets/library_get_asset. Подготовь данные через library_prepare_asset, затем проверь и опубликуй через library_validate_asset/library_publish_asset. Для изменения существующего материала сохраняй его ID. Не меняй код приложения и не запускай сгенерированные скрипты как логику просмотрщика. Пользовательские референсы — входы запроса, не ручной импорт готовой карточки. При отсутствии нужного генератора/ресурса или необходимости согласования явно спроси пользователя в Pi; не имитируй результат и не включай платный сервис автоматически. Согласования производства остаются в диалоге, в библиотеке нет ручного шага принятия. По завершении сохрани краткий результат с ID/версией опубликованного материала в своём output и сообщи complete_stage.`,
  }));
}
