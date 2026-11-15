import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { checkPi } from './checkPi.ts';
import { resolvePiSdk } from './BrowserAuth.ts';
import { stableId } from '../storage/validation.ts';
import type { ProviderStatus } from '../../shared/contracts.ts';
import { safePath } from '../storage/files.ts';
import type { Connection } from '../../shared/connections.ts';
import {
  modelEndpointUrl,
  parseModelEndpoint,
  endpointProviderId,
  type ModelEndpoint,
} from '../../shared/modelEndpoint.ts';

export interface ModelAuthScope {
  authPath: string;
  provider: string;
  endpoint?: { url: string; config: ModelEndpoint };
}
export async function connectionAuthScope(
  directory: string,
  folder: string,
  connection: Connection,
): Promise<ModelAuthScope | undefined> {
  const custom = connection.purpose === 'compatible' || connection.purpose === 'local';
  if (connection.providerId === 'claude-code') {
    if (connection.authScope === 'connection')
      throw new Error(
        'Claude Code использует общий вход своего CLI. Выберите эту область в настройках подключения.',
      );
    return;
  }
  if (!custom && connection.authScope !== 'connection') return;
  stableId(connection.id);
  const endpoint = custom
    ? {
        url: modelEndpointUrl(connection.endpoint),
        config: parseModelEndpoint(connection.endpointConfig),
      }
    : undefined;
  if (custom && connection.providerId !== endpointProviderId(connection.id))
    throw new Error(
      'Пересохраните настройки совместимого подключения и заново выберите его модель.',
    );
  const key = createHash('sha256')
    .update(await realpath(folder))
    .update('\0')
    .update(connection.id)
    .update('\0')
    .update(connection.providerId)
    .update(
      endpoint ? JSON.stringify([endpoint.url, endpoint.config.api, endpoint.config.auth]) : '',
    )
    .digest('hex');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return {
    authPath: await safePath(directory, `${key}.json`, true),
    provider: connection.providerId,
    ...(endpoint ? { endpoint } : {}),
  };
}

/** Native Pi owns credential storage/locking. Only safe results are returned, on a separate pipe. */
export async function modelAuthOperation<T>(
  piPath: string,
  script: string,
  request: {
    action: 'status' | 'catalog' | 'logout' | 'discover' | 'claude-status';
    provider?: string;
    scope?: ModelAuthScope;
    cwd?: string;
  },
): Promise<T> {
  const pi = await checkPi(piPath);
  if (!pi.supported) throw new Error('Требуется поддерживаемый Pi 1.5.2.');
  const sdk = await resolvePiSdk(await realpath(pi.path));
  return new Promise((resolve, reject) => {
    const child = spawn(join(dirname(pi.path), 'node'), [script, sdk], {
      stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        PATH: `${dirname(pi.path)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        PI_OFFLINE: '1',
        PI_TELEMETRY: '0',
      },
    });
    let output = '',
      settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill('SIGKILL');
        reject(error);
      } else resolve(value!);
    };
    const timer = setTimeout(
      () => finish(new Error('Pi не завершил проверку подключения.')),
      20000,
    );
    child.once('error', () => finish(new Error('Не удалось запустить проверку подключения Pi.')));
    child.stdio[3]!.on('data', (data: Buffer) => {
      output += data.toString('utf8');
      if (output.length > 2000000) finish(new Error('Pi вернул слишком большой ответ.'));
    });
    child.once('close', (code) => {
      try {
        if (code !== 0) throw new Error();
        finish(undefined, JSON.parse(output) as T);
      } catch {
        finish(new Error('Не удалось проверить выбранное подключение Pi.'));
      }
    });
    child.stdin!.on('error', () => {});
    child.stdin!.end(JSON.stringify(request));
  });
}

export async function getModelProviderStatus(
  path: string,
  script: string,
  provider: string,
  scope?: ModelAuthScope,
  cwd?: string,
): Promise<ProviderStatus> {
  const result = await modelAuthOperation<ProviderStatus>(path, script, {
    action: 'status',
    provider,
    scope,
    cwd,
  });
  if (result.provider !== provider || !['ready', 'not_ready', 'invalid'].includes(result.status))
    throw new Error('Неподдерживаемый ответ авторизации Pi.');
  return result;
}
