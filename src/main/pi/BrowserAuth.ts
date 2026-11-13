import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { AuthLoginState } from '../../shared/auth.ts';
import { checkPi } from './checkPi.ts';
import type { ModelAuthScope } from './modelAuth.ts';
import { getProviderStatus } from './provider.ts';

export function validateCodexAuthUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 12_000)
    throw new Error('Неподдерживаемая ссылка входа Pi.');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !['auth.openai.com', 'login.openai.com'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('Pi вернул неподдерживаемый адрес входа.');
  return url.href;
}
interface Login {
  state: AuthLoginState;
  child: ChildProcessWithoutNullStreams;
  key: string;
  validateUrl: (value: unknown) => string;
  verify: () => Promise<boolean>;
  success: string;
  failure: string;
}
export function validateMcpAuthUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 12000 || /[\r\n\0]/.test(value))
    throw new Error('Неподдерживаемая ссылка OAuth MCP.');
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  )
    throw new Error('Для OAuth MCP нужен HTTPS или локальный callback.');
  return url.href;
}
export async function resolvePiSdk(cli: string) {
  let directory = dirname(cli);
  for (let depth = 0; depth < 4; depth++) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (metadata.name === '@earendil-works/pi-coding-agent' && metadata.version === '1.5.2')
        return join(directory, 'dist/index.js');
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
        throw error;
    }
    directory = dirname(directory);
  }
  throw new Error('Не найдена полная установка Pi 1.5.2 для браузерного входа.');
}
export class BrowserAuth {
  private logins = new Map<string, Login>();
  constructor(privateScript: string, openUrl: (url: string) => Promise<unknown>) {
    this.script = privateScript;
    this.openUrl = openUrl;
  }
  private readonly script: string;
  private readonly openUrl: (url: string) => Promise<unknown>;
  async start(path: string): Promise<AuthLoginState> {
    return this.begin(path, {
      key: 'codex',
      payload: { provider: 'openai-codex', method: 'oauth' },
      script: this.script,
      validateUrl: validateCodexAuthUrl,
      message: 'Открываем вход через ChatGPT…',
      success: 'Вход через ChatGPT выполнен.',
      failure: 'Не удалось войти через ChatGPT. Проверьте подключение и повторите вход.',
      verify: async (resolvedPath) =>
        (await getProviderStatus(resolvedPath, 'openai-codex')).status === 'ready',
    });
  }
  startProvider(
    path: string,
    request: {
      provider: string;
      method: 'oauth' | 'api_key';
      scope?: ModelAuthScope;
      key: string;
      verify: () => Promise<boolean>;
    },
  ) {
    return this.begin(path, {
      key: `model:${request.key}`,
      script: this.script,
      validateUrl: request.provider === 'openai-codex' ? validateCodexAuthUrl : validateMcpAuthUrl,
      payload: { provider: request.provider, method: request.method, scope: request.scope },
      verify: request.verify,
      message: 'Запускаем штатный вход Pi…',
      success: 'Вход выполнен для выбранного подключения.',
      failure: 'Не удалось подтвердить вход выбранного подключения. Повторите вход.',
    });
  }
  startMcp(
    path: string,
    scope: string,
    request: { name: string; config: Record<string, unknown> },
    verify: () => Promise<boolean>,
  ) {
    return this.begin(path, {
      key: `mcp:${scope}`,
      script: join(dirname(this.script), 'mcp-login.mjs'),
      validateUrl: validateMcpAuthUrl,
      verify,
      payload: request,
      message: 'Открываем OAuth-вход MCP…',
      success: 'Вход выполнен. MCP доступен.',
      failure: 'Не удалось подтвердить вход MCP. Проверьте настройки OAuth и повторите вход.',
    });
  }
  private async begin(
    path: string,
    options: {
      key: string;
      script: string;
      validateUrl: Login['validateUrl'];
      verify: (path: string) => Promise<boolean>;
      message: string;
      success: string;
      failure: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<AuthLoginState> {
    const active = [...this.logins.values()].find(
      (login) =>
        login.key === options.key &&
        ['opening', 'waiting', 'verifying'].includes(login.state.phase),
    );
    if (active) return { ...active.state };
    const pi = await checkPi(path);
    if (!pi.supported)
      throw new Error(`Для браузерного входа поддерживается Pi 1.5.2; найдена ${pi.version}.`);
    const cli = await realpath(pi.path);
    const sdk = await resolvePiSdk(cli);
    const id = randomUUID();
    const child = spawn(join(dirname(pi.path), 'node'), [options.script, sdk], {
      env: { ...process.env, PI_TELEMETRY: '0', PI_OFFLINE: '1' },
      stdio: 'pipe',
    });
    const login: Login = {
      state: { id, phase: 'opening', message: options.message },
      child,
      key: options.key,
      validateUrl: options.validateUrl,
      verify: () => options.verify(pi.path),
      success: options.success,
      failure: options.failure,
    };
    this.logins.set(id, login);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      void this.event(login, line);
    });
    child.stderr.resume(); // Never forward raw OAuth output to renderer or logs.
    child.stdin.on('error', () => {});
    if (options.payload)
      child.stdin.write(`${JSON.stringify({ type: 'init', ...options.payload })}\n`);
    child.on('error', () => this.fail(login, 'Не удалось запустить штатный вход Pi.'));
    child.on('close', () => {
      if (login.state.phase === 'opening' || login.state.phase === 'waiting')
        this.fail(login, 'Вход не завершён. Повторите попытку.');
    });
    return { ...login.state };
  }
  private fail(login: Login, message: string) {
    login.state = { id: login.state.id, phase: 'error', message };
    login.child.kill();
  }
  private async event(login: Login, line: string) {
    if (line.length > 16_000 || !['opening', 'waiting'].includes(login.state.phase)) return;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === 'auth_url') {
        await this.openUrl(login.validateUrl(event.url));
        if (['opening', 'waiting'].includes(login.state.phase))
          login.state = {
            ...login.state,
            phase: 'waiting',
            message:
              typeof event.deviceCode === 'string' &&
              /^[a-zA-Z0-9 -]{1,100}$/.test(event.deviceCode)
                ? `Введите код ${event.deviceCode} в открывшемся браузере.`
                : 'Подтвердите вход в открывшемся браузере.',
          };
      } else if (event.type === 'prompt' && typeof event.id === 'string') {
        login.state = {
          id: login.state.id,
          phase: 'waiting',
          message: 'Завершите вход Pi в форме ниже или в браузере.',
          prompt: {
            id: event.id,
            secret: event.secret === true,
            ...(typeof event.message === 'string' ? { message: event.message.slice(0, 1000) } : {}),
            ...(Array.isArray(event.options)
              ? {
                  options: event.options
                    .filter(
                      (item): item is { id: string; label: string } =>
                        !!item && typeof item.id === 'string' && typeof item.label === 'string',
                    )
                    .slice(0, 50)
                    .map((item) => ({
                      id: item.id.slice(0, 200),
                      label: item.label.slice(0, 500),
                    })),
                }
              : {}),
          },
        };
      } else if (event.type === 'done') {
        // Mark the transport settled before its process exits, then verify Pi's actual stored auth.
        login.state = {
          id: login.state.id,
          phase: 'verifying',
          message: 'Проверяем сохранённый вход…',
        };
        const ready = await login.verify();
        if (login.state.phase !== 'verifying') return;
        login.state = {
          id: login.state.id,
          phase: ready ? 'ready' : 'error',
          message: ready ? login.success : login.failure,
        };
      } else if (event.type === 'cancelled')
        login.state = { id: login.state.id, phase: 'cancelled', message: 'Вход отменён.' };
      else if (event.type === 'failed') this.fail(login, login.failure);
    } catch {
      this.fail(login, 'Не удалось обработать ответ входа Pi.');
    }
  }
  read(id: string) {
    const login = this.logins.get(id);
    if (!login) throw new Error('Вход не найден.');
    return structuredClone(login.state);
  }
  answer(id: string, promptId: string, answer: string) {
    const login = this.logins.get(id);
    if (
      !login ||
      login.state.prompt?.id !== promptId ||
      typeof answer !== 'string' ||
      answer.length > 16_000
    )
      throw new Error('Запрос входа уже неактуален.');
    login.child.stdin.write(`${JSON.stringify({ type: 'answer', id: promptId, answer })}\n`);
    delete login.state.prompt;
  }
  cancel(id: string) {
    const login = this.logins.get(id);
    if (!login || !['opening', 'waiting', 'verifying'].includes(login.state.phase)) return;
    login.state = { id, phase: 'cancelled', message: 'Вход отменён.' };
    login.child.stdin.write('{"type":"cancel"}\n');
    login.child.kill();
  }
  close() {
    for (const id of this.logins.keys()) this.cancel(id);
  }
}
