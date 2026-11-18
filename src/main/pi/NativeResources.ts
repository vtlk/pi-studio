import { t } from '../../shared/i18n/index.ts';
import { piEnvironment, piNode } from './platform.ts';
import { dirname } from 'node:path';
import { realpath } from 'node:fs/promises';
import { checkPi } from './checkPi.ts';
import { resolvePiSdk } from './BrowserAuth.ts';
import { transferTimeouts } from '../network/transfer.ts';
import { findGit } from './git.ts';
import { findWindowsBash } from './windowsBash.ts';
import { resourceChild } from './resourceChild.ts';

export interface NativeResourceRequest {
  action:
    | 'inspect-runtime'
    | 'list-mcp'
    | 'configure-mcp'
    | 'check-mcp'
    | 'install-package'
    | 'check-package';
  cwd: string;
  name?: string;
  config?: Record<string, unknown>;
  replace?: boolean;
  source?: string;
}
export interface NativeResourceResult {
  runtime?: {
    platform: string;
    arch: string;
    nodeVersion: string;
    npmVersion?: string;
    commands: Record<string, { command: string; args: string[] }>;
    primaryCommandTool?: 'powershell' | 'bash';
    commandExamples?: Record<string, string>;
    shell?: { available: boolean; shell?: string; args?: string[] };
    bash?: { available: boolean; command?: string };
  };
  status?: 'available' | 'needs_auth' | 'unavailable' | 'disabled';
  name?: string;
  transport?: string;
  description?: string;
  version?: string;
  contents?: string;
  count?: number;
  enabled?: boolean;
  toolCount?: number;
  servers?: { name: string; transport: string; description: string; enabled: boolean }[];
  invalidEntries?: number;
}
/** Delegate installations, validation, transport and OAuth storage to the pinned native Pi SDK. */
export async function nativeResourceOperation(
  piPath: string,
  script: string,
  request: NativeResourceRequest,
  signal?: AbortSignal,
): Promise<NativeResourceResult> {
  signal?.throwIfAborted();
  const pi = await checkPi(piPath);
  if (!pi.supported) throw new Error(t('error.nativeResources.theSupportedPiIsRequired'));
  const sdk = await resolvePiSdk(await realpath(pi.path));
  const node = await piNode(pi.path);
  const git = process.platform === 'win32' ? await findGit() : undefined;
  const bash =
    process.platform === 'win32' ? await findWindowsBash().catch(() => undefined) : '/bin/bash';
  const env = piEnvironment(
    dirname(node),
    process.env,
    process.platform,
    [git, bash].filter((path): path is string => !!path).map(dirname),
    bash,
  );
  const { code, output } = await resourceChild({
    node,
    args: [script, sdk],
    cwd: request.cwd,
    env,
    input: JSON.stringify(request),
    signal,
    timeout: request.action === 'install-package' ? transferTimeouts.packageInstall : 45000,
  });
  signal?.throwIfAborted();
  let message: { ok: boolean; result: NativeResourceResult; category?: string };
  try {
    message = JSON.parse(output);
  } catch {
    throw new Error(t('error.nativeResources.piCouldNotPerformThe'));
  }
  if (code !== 0 || !message.ok || !message.result) {
    const key =
      message.category === 'not-pi-package'
        ? 'error.nativeResources.notPiPackage'
        : message.category === 'package-install-failed'
          ? 'error.nativeResources.packageInstallFailed'
          : 'error.nativeResources.piCouldNotPerformThe';
    throw new Error(t(key));
  }
  if (message.result.runtime)
    message.result.runtime.bash = { available: !!bash, ...(bash ? { command: bash } : {}) };
  return message.result;
}
