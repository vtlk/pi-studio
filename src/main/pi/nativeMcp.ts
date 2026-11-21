import { t } from '../../shared/i18n/index.ts';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { atomicJson, isMissing, readJson } from '../storage/files.ts';
import { record } from '../storage/validationFields.ts';

const configPath = () =>
  join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent'), 'mcp.json');
export async function findNativeMcpConfig(name: string) {
  const native = (await readJson(configPath()).catch((error) => {
    if (isMissing(error)) return {};
    throw error;
  })) as { mcpServers?: Record<string, Record<string, unknown>> };
  const server =
    native.mcpServers && Object.hasOwn(native.mcpServers, name)
      ? native.mcpServers[name]
      : undefined;
  if (server && typeof server === 'object' && !Array.isArray(server))
    return structuredClone(server);
}

type NativeMcpOptions = {
  enabled?: boolean;
  timeout?: number;
  exposure?: 'codemode' | 'deferred' | 'direct' | 'hidden';
};

/** Preserve exact transport, auth, and additional Pi fields. Only scalar options are assignable here. */
export async function editNativeMcpOptions(
  name: string,
  options: NativeMcpOptions,
  commitCatalog: () => Promise<unknown>,
) {
  const file = configPath();
  const document = record(
    await readJson(file).catch((error) => {
      if (isMissing(error)) throw Error(t('error.nativeMcp.mcpIsMissingFromPi', { value1: name }));
      throw error;
    }),
  );
  const servers = record(document.mcpServers ?? {});
  if (!Object.hasOwn(servers, name))
    throw Error(t('error.nativeMcp.mcpIsMissingFromPi', { value1: name }));
  const { enabled, timeout, exposure } = options;
  const server = record(servers[name]);
  const updated = {
    ...document,
    mcpServers: {
      ...servers,
      [name]: {
        ...server,
        ...(enabled === undefined ? {} : { enabled }),
        ...(timeout === undefined ? {} : { timeout }),
        ...(exposure === undefined ? {} : { exposure }),
      },
    },
  };
  await atomicJson(file, updated);
  try {
    await commitCatalog();
  } catch (error) {
    if (isDeepStrictEqual(await readJson(file), updated)) await atomicJson(file, document);
    throw error;
  }
}

export async function nativeMcpConfig(name: string) {
  const server = await findNativeMcpConfig(name);
  if (server) return server;
  throw new Error(t('error.nativeMcp.mcpIsMissingFromPi', { value1: name }));
}
