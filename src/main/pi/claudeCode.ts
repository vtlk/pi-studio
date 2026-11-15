import { isAbsolute } from 'node:path';
import { shellQuote } from './provider.ts';
import { openTerminalCommand } from './terminalCommand.ts';

export type ClaudeCodeAction = 'install' | 'login' | 'logout';
/** Fixed official CLI operations, only after an explicit UI action. No credentials/requests. */
export async function openClaudeCodeAction(
  action: ClaudeCodeAction,
  state: { command?: string; status: string; detail?: string },
  cwd: string,
  open = openTerminalCommand,
) {
  if (!['install', 'login', 'logout'].includes(action))
    throw new Error('Неизвестное действие Claude Code.');
  if (action === 'install') {
    await open(
      'curl -fsSL https://claude.ai/install.sh | /bin/bash -s -- stable',
      undefined,
      'Установка Claude Code',
    );
    return;
  }
  if (!state.command || !isAbsolute(state.command) || /[\0\r\n]/.test(state.command))
    throw new Error(state.detail || 'Сначала установите Claude Code CLI.');
  const env = process.env;
  const configuration = env.PI_CLAUDE_CODE_CONFIG_DIR ?? env.CLAUDE_CONFIG_DIR;
  const config = configuration ? ` CLAUDE_CONFIG_DIR=${shellQuote(configuration)}` : '';
  // This is the user's normal CLI authentication, shared by every Claude connection.
  // Strip inherited API auth. Neither Studio nor Pi handles the returned tokens.
  const command = `cd ${shellQuote(cwd)} && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_OAUTH_TOKEN -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX -u CLAUDE_CODE_USE_FOUNDRY${config} ${shellQuote(state.command)} auth ${action}`;
  await open(command, undefined, 'Claude Code · Авторизация');
}
