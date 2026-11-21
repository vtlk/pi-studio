import type { SessionTool } from './RunChannel.ts';
import { settingsReadProperties } from './settingsOutput.ts';

const string = { type: 'string' };
const query = { type: 'string', maxLength: 200 };
const { offset, fingerprint, max_bytes } = settingsReadProperties;
const paging = { offset, fingerprint, max_bytes };
const list = (
  name: string,
  description: string,
  properties = {},
  required: string[] = [],
): SessionTool => ({
  name,
  description:
    description +
    ' Follow nextPage for more matches. If split into JSON fragments, follow nextCall first.',
  inputSchema: {
    type: 'object',
    properties: {
      query,
      start: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      ...paging,
      ...properties,
    },
    required,
    additionalProperties: false,
  },
});
export const catalogTools: SessionTool[] = [
  list(
    'list_teams',
    'Find Studio teams by name or ID. Returns names, IDs, workspace mode and agent counts.',
  ),
  list(
    'list_agents',
    'List ordered agents in exact team_id, find ordinary agents by name query, or set scope=system for system agents. Returns IDs and brief metadata.',
    { team_id: string, scope: { const: 'system' } },
  ),
  list(
    'list_resources',
    'Find Studio catalog resources. Returns IDs and compact saved metadata; status is not a fresh check.',
    { kind: { enum: ['skills', 'mcps', 'plugins'] } },
    ['kind'],
  ),
  list(
    'list_connections',
    'List saved local model/API connections with IDs, providers and purposes. No credentials or authentication probes.',
  ),
  list(
    'list_models',
    'Find available model IDs, supported reasoning levels and image capability for one saved model connection.',
    { connection_id: string },
    ['connection_id'],
  ),
  list(
    'list_native_mcps',
    'Find the exact name of an existing native Pi MCP server before importing it. No config values or secrets.',
  ),
];
