import { t } from '../../shared/i18n/index.ts';
import { piEnvironment, piNode } from './platform.ts';
import { execFile, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { checkPi } from './checkPi.ts';
import { resolvePiSdk } from './BrowserAuth.ts';
import { transferTimeouts } from '../network/transfer.ts';
import { findGit } from './git.ts';

export interface NativeResourceRequest {
  action: 'list-mcp' | 'configure-mcp' | 'check-mcp' | 'install-package' | 'check-package';
  cwd: string;
  name?: string;
  config?: Record<string, unknown>;
  replace?: boolean;
  source?: string;
}
export interface NativeResourceResult {
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
): Promise<NativeResourceResult> {
  const pi = await checkPi(piPath);
  if (!pi.supported) throw new Error(t('error.nativeResources.theSupportedPiIsRequired'));
  const sdk = await resolvePiSdk(await realpath(pi.path));
  const node = await piNode(pi.path);
  const git = process.platform === 'win32' ? await findGit() : undefined;
  const env = piEnvironment(
    dirname(node),
    process.env,
    process.platform,
    git ? [dirname(git)] : [],
  );
  return new Promise((resolve, reject) => {
    const child = spawn(node, [script, sdk], {
      windowsHide: true,
      cwd: request.cwd,
      stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
      detached: true,
      env: {
        ...env,
        PI_TELEMETRY: '0',
      },
    });
    let output = '',
      finished = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    function stop() {
      if (process.platform === 'win32') {
        if (child.pid && child.exitCode === null && child.signalCode === null)
          execFile(
            join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, timeout: 5000 },
            () => {},
          );
        return;
      }
      child.kill('SIGTERM');
      forceKill = setTimeout(() => {
        try {
          if (child.pid)
            process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL');
        } catch {
          /* Already closed. */
        }
      }, 2000);
      forceKill.unref();
    }
    const timeout = setTimeout(
      () => {
        stop();
        finish(new Error(t('error.nativeResources.piDidNotFinishThe')));
      },
      request.action === 'install-package' ? transferTimeouts.packageInstall : 45000,
    );
    function finish(error?: Error, value?: NativeResourceResult) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value!);
    }
    child.once('error', () => finish(new Error(t('error.nativeResources.couldNotStartPiS'))));
    child.stdio[3]!.on('data', (data: Buffer) => {
      output += data.toString('utf8');
      if (output.length > 500000) {
        stop();
        finish(new Error(t('error.nativeResources.piReturnedAResourceResponse')));
      }
    });
    child.once('close', (code) => {
      clearTimeout(forceKill);
      try {
        const message = JSON.parse(output) as { ok: boolean; result: NativeResourceResult };
        if (code !== 0 || !message.ok || !message.result) throw new Error();
        finish(undefined, message.result);
      } catch {
        finish(new Error(t('error.nativeResources.piCouldNotPerformThe')));
      }
    });
    child.stdin!.on('error', () => {});
    child.stdin!.end(JSON.stringify(request));
  });
}
