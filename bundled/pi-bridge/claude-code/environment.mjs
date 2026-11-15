import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

// The GUI, catalog, login and requests must resolve the same CLI/configuration.
// No credentials are read here; the unmodified CLI owns authentication.
export function claudeEnvironment(input = process.env) {
  const env = { ...input };
  if (process.platform === 'win32') {
    for (const key of Object.keys(env)) {
      if (!/^(?:PATH|ANTHROPIC_.*|CLAUDE_.*|PI_CLAUDE_.*)$/i.test(key)) continue;
      const canonical = key.toUpperCase();
      if (key === canonical) continue;
      if (env[canonical] !== undefined && env[canonical] !== env[key])
        throw Error('Claude Code: противоречивые переменные окружения Windows.');
      env[canonical] = env[key];
      delete env[key];
    }
  }

  const conflicting = [
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_FOUNDRY_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  ];
  const cloud = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
  if (
    conflicting.some((key) => !!env[key]) ||
    cloud.some((key) => /^(1|true|yes)$/i.test(env[key] ?? ''))
  )
    throw Error(
      'Claude Code: отключите переменные другого способа авторизации или API-сервера. Подмена подписки запрещена.',
    );
  if (/^(1|true|yes)$/i.test(env.PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS ?? ''))
    throw Error(
      'Claude Code: разрешение usage credits несовместимо с подписочным подключением Studio.',
    );
  delete env.ANTHROPIC_API_KEY;
  env.PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS = '0';
  env.PATH = [
    ...new Set(
      [
        ...(env.PATH ?? '').split(delimiter),
        join(homedir(), '.local/bin'),
        ...(process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']),
      ].filter(Boolean),
    ),
  ].join(delimiter);
  return env;
}
