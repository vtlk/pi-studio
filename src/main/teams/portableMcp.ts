import { assertCredentialReferences } from '../pi/resourceConfig.ts';
import { posix, win32 } from 'node:path';
export const isLocalMcpPath = (path: string) =>
  posix.isAbsolute(path) || win32.isAbsolute(path) || /^[a-z]:/i.test(path);

/** Only public configuration and unresolved credential requirements; no secret resolver is used. */
export function portableMcp(raw: Record<string, unknown>) {
  const config: Record<string, unknown> = structuredClone(raw);
  const requirements: string[] = [];
  for (const kind of ['env', 'headers'] as const) {
    if (!raw[kind] || typeof raw[kind] !== 'object' || Array.isArray(raw[kind])) continue;
    config[kind] = Object.fromEntries(
      Object.entries(raw[kind] as Record<string, unknown>).map(([key, value]) => {
        if (kind === 'headers' && /^(accept|content-type)$/i.test(key)) return [key, value];
        const envName = key.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
        requirements.push(`Настроить защищённый параметр MCP ${kind}.${key}.`);
        return [key, `\${PI_STUDIO_IMPORT_${envName}}`];
      }),
    );
  }
  if (config.oauth && typeof config.oauth === 'object' && !Array.isArray(config.oauth)) {
    const oauth = config.oauth as Record<string, unknown>;
    if ('clientSecret' in oauth) {
      oauth.clientSecret = '${PI_STUDIO_IMPORT_CLIENT_SECRET}';
      requirements.push('Настроить OAuth clientSecret через защищённые параметры.');
    }
  }
  assertCredentialReferences(config);
  if (typeof config.command === 'string' && isLocalMcpPath(config.command))
    requirements.push(
      'MCP использует локальную команду отправителя: установить её и явно сопоставить команду/пути на этом компьютере.',
    );
  if (
    Array.isArray(config.args) &&
    config.args.some((arg) => typeof arg === 'string' && isLocalMcpPath(arg))
  )
    requirements.push(
      'Аргументы MCP содержат локальные пути: восстановить и явно сопоставить зависимости.',
    );
  return { config, requirements };
}

export function assertPortableMcp(config: Record<string, unknown>) {
  assertCredentialReferences(config);
  const reference = (value: unknown) =>
    typeof value === 'string' &&
    (/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value) || value.startsWith('!'));
  for (const kind of ['headers', 'env'] as const) {
    const fields = config[kind];
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    for (const [key, value] of Object.entries(fields)) {
      if (kind === 'headers' && /^(accept|content-type)$/i.test(key)) continue;
      if (!reference(value))
        throw new Error(
          'Пакет содержит значения защищённых параметров MCP вместо требований входа.',
        );
    }
  }
}
