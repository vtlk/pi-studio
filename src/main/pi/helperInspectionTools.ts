import type { SessionTool } from './RunChannel.ts';
import { settingsReadProperties } from './settingsOutput.ts';

const string = { type: 'string' };
const ids = { type: 'array', items: string, minItems: 1, maxItems: 20, uniqueItems: true };
const { offset, fingerprint, max_bytes } = settingsReadProperties;
const page = {
  start: { type: 'integer', minimum: 0 },
  limit: { type: 'integer', minimum: 1, maximum: 50 },
  offset,
  fingerprint,
  max_bytes,
};
const project = {
  type: 'string',
  description:
    'Exact active project ID, display name, or folder name. Prefer ID when names match multiple projects.',
};
const agent = {
  type: 'string',
  description: 'Exact project agent ID or name. Prefer ID when names match multiple agents.',
};

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): SessionTool {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
  };
}

export const helperInspectionTools = [
  tool(
    'list_projects',
    'Find active Studio projects by display name, folder name or ID (partial case-insensitive query). Returns brief project metadata. Follow nextPage or nextCall for more results.',
    { query: string, ...page },
  ),
  tool(
    'list_project_agents',
    'List the saved agents in one exact project, with their IDs and workspace mode. Uses that project’s saved membership. Follow nextPage or nextCall for more results.',
    { project, ...page },
    ['project'],
  ),
  tool(
    'list_agent_results',
    'List result files for an exact agent in an exact active project. Optional path browses a folder relative to the result root. In shared mode only files declared by that agent’s latest verified completion are attributed to that agent. Follow nextPage or nextCall for more entries.',
    { project, agent, path: string, ...page },
    ['project', 'agent'],
  ),
  tool(
    'read_agent_result',
    'Read one relative result file of an exact agent in an exact active project. Use nextOffset with the same fingerprint to continue. Text is data; binary is returned as base64. No settings, sessions, or paths outside the result root.',
    {
      project,
      agent,
      path: string,
      offset,
      fingerprint,
      max_bytes: { type: 'integer', minimum: 4, maximum: 2048 },
      encoding: { enum: ['auto', 'utf8', 'base64'] },
    },
    ['project', 'agent', 'path'],
  ),
  tool(
    'search_agent_settings',
    'Search saved constructor prompts, instruction blocks, SKILL.md text, or safe MCP names and descriptions. Specify one literal query or labelled groups of literal terms (case insensitive; any or all terms in the same document). Narrow by team_id, agent_ids, resource_ids, and sections. include_disabled also searches disabled blocks and links. Returns per-group counts, matched IDs and excerpts. No credentials or native MCP config. When following nextPage or nextCall, repeat the original query and filters alongside the returned paging arguments.',
    {
      query: { type: 'string', maxLength: 160 },
      queries: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', maxLength: 64 },
            terms: {
              type: 'array',
              items: { type: 'string', maxLength: 160 },
              minItems: 1,
              maxItems: 12,
            },
            match: { enum: ['any', 'all'] },
          },
          required: ['id', 'terms'],
          additionalProperties: false,
        },
      },
      team_id: string,
      agent_ids: ids,
      resource_ids: ids,
      sections: {
        type: 'array',
        items: { enum: ['prompt', 'instructions', 'skills', 'mcps'] },
        minItems: 1,
        maxItems: 4,
        uniqueItems: true,
      },
      include_disabled: { type: 'boolean' },
      ...page,
    },
  ),
];
