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
    name: 'configure_mcp',
    description:
      'Configure a requested external MCP in native Pi mcp.json and add its pi:name link to this Studio catalog. Uses the pinned Pi validator; supports native stdio/HTTP/auth/OAuth fields. Never accept tokens/passwords in chat: use OAuth or native ${ENV}/!command credential references. Existing entries require explicit replace:true. Does not assign or load it into production agents.',
    inputSchema: object(
      {
        name: string,
        displayName: string,
        config: { type: 'object' },
        replace: { type: 'boolean' },
      },
      ['name', 'config'],
    ),
  },
  {
    name: 'import_mcp',
    description:
      'Add a catalog link to one already-configured native Pi MCP by its exact name. Read list_configuration.nativeMcp for actual names. Does not copy credentials, change the server, or assign access.',
    inputSchema: object({ name: string, displayName: string }, ['name']),
  },
  {
    name: 'install_package',
    description:
      'Resolve/install a specifically requested trusted native Pi package in its native managed cache and register a Studio catalog link. Installation can run native package-manager lifecycle scripts; do not install untrusted or unrequested sources. Use official source documentation, do not invent packages or preinstall examples. Supports native npm:/git: sources or an existing absolute local path. Session resources load only when assigned; no global auto-load declarations are added.',
    inputSchema: object({ source: string, name: string }, ['source']),
  },
  {
    name: 'check_resource',
    description:
      'Actually check one catalog resource with native Pi. MCP check connects only that server, using Pi OAuth/provider credentials and transports, lists its tools, then closes. Package check uses the local native cache, skill check reads its current file. This is a last check, not a claim that a running production session loaded it.',
    inputSchema: object({ resourceId: string }, ['resourceId']),
  },
  {
    name: 'authenticate_mcp',
    description:
      'Open native Pi MCP login in Terminal/browser for a requested pi:name resource. User completes OAuth there. Never request tokens or authorization codes in chat. Returns opened, not authenticated; check_resource verifies the result afterward.',
    inputSchema: object({ resourceId: string }, ['resourceId']),
  },
  {
    name: 'list_configuration',
    description:
      'Read current Studio agent/profile/resource/connection metadata and available Pi models. Does not include credentials or instruction snapshots.',
    inputSchema: object({}),
  },
  {
    name: 'configure_agent',
    description:
      'Create a project agent only when requested (append after current project profiles), or update named fields of an existing project/system profile by stable ID. Exactly three built-in system roles exist; never create another system agent. Does not change existing project snapshots or launch work. Built-in MCP connections are pinned and are not external resource assignments.',
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
