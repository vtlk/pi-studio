import { t } from '../../shared/i18n/index.ts';
import { isAbsolute } from 'node:path';
import { shellQuote } from './provider.ts';
import { openTerminalCommand } from './terminalCommand.ts';
import { openWindowsPowerShellCommand } from './windowsTerminal.ts';
import { powershellLiteral } from './windowsShell.ts';

export type ClaudeCodeAction = 'install' | 'login' | 'logout';
/** Fixed official CLI operations, only after an explicit UI action. No credentials/requests. */
export async function openClaudeCodeAction(
  action: ClaudeCodeAction,
  state: { command?: string; status: string; detail?: string },
  cwd: string,
  open = openTerminalCommand,
) {
  if (!['install', 'login', 'logout'].includes(action))
    throw new Error(t('error.claudeCode.unknownClaudeCodeAction'));
  if (action === 'install') {
    if (process.platform === 'win32') {
      await openWindowsPowerShellCommand(
        'Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression',
        t('error.claudeCode.installClaudeCode'),
      );
      return;
    }
    await open(
      'curl -fsSL https://claude.ai/install.sh | /bin/bash -s -- stable',
      undefined,
      t('error.claudeCode.installClaudeCode'),
    );
    return;
  }
  if (!state.command || !isAbsolute(state.command) || /[\0\r\n]/.test(state.command))
    throw new Error(state.detail || t('error.claudeCode.installTheClaudeCodeCli'));
  const env = process.env;
  const configuration = env.PI_CLAUDE_CODE_CONFIG_DIR ?? env.CLAUDE_CONFIG_DIR;
  if (process.platform === 'win32') {
    const keys = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ];
    await openWindowsPowerShellCommand(
      `Set-Location -LiteralPath ${powershellLiteral(cwd)}; ${keys.map((key) => `Remove-Item Env:${key} -ErrorAction SilentlyContinue`).join('; ')}; ${configuration ? `$env:CLAUDE_CONFIG_DIR = ${powershellLiteral(configuration)}; ` : ''}& ${powershellLiteral(state.command)} auth ${action}`,
      t('error.claudeCode.claudeCodeSignIn'),
    );
    return;
  }
  const config = configuration ? ` CLAUDE_CONFIG_DIR=${shellQuote(configuration)}` : '';
  // This is the user's normal CLI authentication, shared by every Claude connection.
  // Strip inherited API auth. Neither Studio nor Pi handles the returned tokens.
  const command = `cd ${shellQuote(cwd)} && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_OAUTH_TOKEN -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX -u CLAUDE_CODE_USE_FOUNDRY${config} ${shellQuote(state.command)} auth ${action}`;
  await open(command, undefined, t('error.claudeCode.claudeCodeSignIn'));
}
