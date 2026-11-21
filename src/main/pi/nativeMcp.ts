import { t } from '../../shared/i18n/index.ts';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isMissing, readJson } from '../storage/files.ts';

export async function findNativeMcpConfig(name: string) {
  const file = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent'), 'mcp.json');
  const native = (await readJson(file).catch((error) => {
    if (isMissing(error)) return {};
    throw error;
  })) as { mcpServers?: Record<string, Record<string, unknown>> };
  const server = native.mcpServers?.[name];
  if (server && typeof server === 'object' && !Array.isArray(server))
    return structuredClone(server);
}

export async function nativeMcpConfig(name: string) {
  const server = await findNativeMcpConfig(name);
  if (server) return server;
  throw new Error(t('error.nativeMcp.mcpIsMissingFromPi', { value1: name }));
}
