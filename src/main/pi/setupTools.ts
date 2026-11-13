import type { SessionTool } from './RunChannel.ts';
import { productionTools } from './RunChannel.ts';

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const string = { type: 'string' };
export const setupTools: SessionTool[] = [
  ...productionTools.filter((tool) =>
    ['web_search', 'get_run_context', 'report_blocked'].includes(tool.name),
  ),
  {
    name: 'list_configuration',
    description:
      'Read current Studio agent/profile/resource/connection metadata and available Pi models. Does not include credentials or instruction snapshots.',
    inputSchema: object({}),
  },
  {
    name: 'configure_agent',
    description:
      'Create an agent only when the user requests it, or update named fields of an existing constructor profile by stable ID. Does not change any existing project snapshot or launch work. New agents prepend; no templates are seeded.',
    inputSchema: object({
      id: string,
      name: string,
      enabled: { type: 'boolean' },
      mainInstruction: string,
      instructions: {
        type: 'array',
        items: object({ id: string, name: string, content: string, enabled: { type: 'boolean' } }, [
          'name',
          'content',
        ]),
      },
      model: object({ connectionId: string, provider: string, id: string, reasoning: string }, [
        'connectionId',
        'provider',
        'id',
        'reasoning',
      ]),
    }),
  },
  {
    name: 'reorder_agents',
    description:
      'Set the explicit constructor order using exactly all current agent IDs. Existing projects keep their own order.',
    inputSchema: object({ ids: { type: 'array', items: string } }, ['ids']),
  },
  {
    name: 'register_connection',
    description:
      'Add/update metadata for a native Pi model provider. No tokens accepted here; user authentication uses native Pi/browser flows.',
    inputSchema: object({ id: string, name: string, provider: string }, ['name', 'provider']),
  },
  {
    name: 'import_skill',
    description:
      'Import metadata/link of an existing local SKILL.md. Does not copy instruction text or execute skill scripts.',
    inputSchema: object({ path: string }, ['path']),
  },
  {
    name: 'assign_resource',
    description:
      'Assign an existing catalog resource to one constructor agent or toggle that link. Never changes old project snapshots.',
    inputSchema: object(
      {
        agentId: string,
        resourceId: string,
        kind: { type: 'string', enum: ['skills', 'mcps', 'plugins'] },
        enabled: { type: 'boolean' },
      },
      ['agentId', 'resourceId', 'kind'],
    ),
  },
];
