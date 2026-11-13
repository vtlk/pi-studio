import { join } from 'node:path';
import { homedir } from 'node:os';
import { readJson } from '../storage/files.ts';

export async function nativeMcpConfig(name: string) {
  const file = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent'), 'mcp.json');
  const native = (await readJson(file)) as { mcpServers?: Record<string, Record<string, unknown>> };
  const server = native.mcpServers?.[name];
  if (!server || typeof server !== 'object' || Array.isArray(server))
    throw new Error(`MCP «${name}» отсутствует в настройках Pi.`);
  return structuredClone(server);
}
