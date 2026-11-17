import type { ServerResponse } from 'node:http';
import { t } from '../../shared/i18n/index.ts';
import type { SessionMcpResult } from './RunChannel.ts';

/** Long administrative calls are cancellable through MCP, disconnect and exact lease revocation. */
export async function callSessionTool(
  lease: {
    calls: Map<string, AbortController>;
    tool: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  },
  name: string,
  args: Record<string, unknown>,
  rpcId: unknown,
  response: ServerResponse,
  heartbeat: () => ReturnType<typeof setInterval> | undefined,
): Promise<SessionMcpResult> {
  const key = JSON.stringify([undefined, rpcId]);
  if (lease.calls.has(key)) throw Error(t('error.remoteSkill.duplicateRequest'));
  const controller = new AbortController();
  lease.calls.set(key, controller);
  const disconnect = () => {
    if (!response.writableEnded) controller.abort();
  };
  response.once('close', disconnect);
  const timer = ['generate_image', 'install_package', 'install_skill_from_url'].includes(name)
    ? heartbeat()
    : undefined;
  try {
    return {
      content: [
        { type: 'text', text: JSON.stringify(await lease.tool(name, args, controller.signal)) },
      ],
    };
  } finally {
    lease.calls.delete(key);
    response.off('close', disconnect);
    clearInterval(timer);
  }
}
