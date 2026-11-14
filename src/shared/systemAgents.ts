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
  return (['assistant'] as const).map((systemRole) => ({
    id: id(),
    systemRole,
    name: systemAgentDefinitions[systemRole].name,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    mainInstruction: setupAssistantInstruction,
  }));
}
