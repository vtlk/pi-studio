import type { Agent } from './studio.ts';
import { setupAssistantInstruction } from './systemAgentInstructions.ts';
import { builtinResources } from './builtinResources.ts';

export const systemAgentRoles = ['assistant'] as const;
export type SystemAgentRole = (typeof systemAgentRoles)[number];
export interface SystemAgent extends Agent {
  systemRole: SystemAgentRole;
}
export const systemAgentDefinitions = {
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
    mcps: builtinResources.map((resource) => resource.id),
    plugins: [],
    mainInstruction: setupAssistantInstruction,
  }));
}
