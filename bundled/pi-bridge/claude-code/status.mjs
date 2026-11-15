import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, resolve, join } from 'node:path';
import { claudeEnvironment } from './environment.mjs';
const execute = promisify(execFile);

export async function claudeStatus(signal) {
  let env;
  try {
    env = claudeEnvironment();
  } catch (error) {
    return { status: 'invalid', detail: error.message };
  }
  const configured = env.PI_CLAUDE_CODE_COMMAND?.trim() || (process.platform === 'win32' ? 'claude.exe' : 'claude');
  const candidates =
    isAbsolute(configured) || configured.includes('/')
      ? [resolve(configured)]
      : env.PATH.split(delimiter).map((path) => join(path, configured));
  let command;
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      command = candidate;
      break;
    } catch {
      /* next */
    }
  }
  if (!command) return { status: 'not_ready', detail: 'Установите официальный Claude Code CLI.' };
  const options = { env, signal, timeout: 5000, maxBuffer: 65536 };
  try {
    const version = await execute(command, ['--version'], options);
    if (!/^2\.[1-9]\d*\.\d+(?:\s|$)/.test(version.stdout.trim()))
      return {
        status: 'invalid',
        detail:
          'Требуется совместимый официальный Claude Code CLI версии 2.1 или новее (ветка 2.x).',
        command,
      };
    const help = (await execute(command, ['--help'], options)).stdout;
    const required = [
      '--input-format',
      '--output-format',
      '--system-prompt-file',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--permission-prompts',
    ];
    if (required.some((flag) => !help.includes(flag)))
      return {
        status: 'invalid',
        detail:
          'Установленный Claude Code CLI не поддерживает необходимые параметры расширения. Обновите его штатным установщиком.',
        command,
      };
    let output;
    try {
      output = (await execute(command, ['auth', 'status'], options)).stdout;
    } catch (error) {
      if (error.code !== 1 || !error.stdout) throw error;
      output = error.stdout;
    }
    const state = JSON.parse(output);
    if (state.loggedIn === false)
      return {
        status: 'not_ready',
        detail: 'Войдите в Claude Code своим подписочным аккаунтом.',
        command,
      };
    if (state.loggedIn !== true) throw Error('Missing CLI login status');
    if (
      state.authMethod !== 'claude.ai' ||
      !['pro', 'max', 'ultra', 'team', 'enterprise'].includes(state.subscriptionType?.toLowerCase())
    )
      return {
        status: 'invalid',
        detail:
          'Claude Code использует другой способ оплаты. Нужен штатный вход claude.ai с подпиской; API fallback запрещён.',
        command,
      };
    return {
      status: 'ready',
      detail:
        'Общий вход Claude Code · подписка. Отключите extra usage в аккаунте Claude перед работой.',
      command,
    };
  } catch {
    signal?.throwIfAborted();
    return {
      status: 'invalid',
      detail: 'Claude Code CLI не вернул корректный статус. Проверьте установку.',
      command,
    };
  }
}
