import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { checkPi } from './checkPi.ts';
import { resolvePiSdk } from './BrowserAuth.ts';

export interface PiConfigValues {
  getConfigValueEnvVarNames(value: string): string[];
  isCommandConfigValue(value: string): boolean;
  resolveConfigValue(value: string, env: Record<string, string>): string | undefined;
}
const parsers = new Map<string, Promise<PiConfigValues>>();
export function piConfigValues(path: string) {
  let pending = parsers.get(path);
  if (!pending) {
    pending = (async () => {
      const pi = await checkPi(path);
      if (!pi.supported) throw new Error('Для параметров MCP требуется поддерживаемый Pi 1.5.2.');
      const sdk = await resolvePiSdk(await realpath(pi.path));
      return import(
        new URL('./core/resolve-config-value.js', pathToFileURL(sdk)).href
      ) as Promise<PiConfigValues>;
    })();
    parsers.set(path, pending);
    void pending.catch(() => parsers.delete(path));
  }
  return pending;
}
export const mcpConfigRevision = (config: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(config)).digest('hex');

function entries(config: Record<string, unknown>) {
  return ['headers', 'env', 'oauth'].flatMap((section) => {
    const value = config[section];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value)
          .filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === 'string' && (section !== 'oauth' || entry[0] === 'clientSecret'),
          )
          .map(([key, text]) => ({ section, key, text }))
      : [];
  });
}
export function mcpSecretFields(config: Record<string, unknown>, parser: PiConfigValues) {
  const names = new Set(
    entries(config).flatMap(({ text }) => parser.getConfigValueEnvVarNames(text)),
  );
  if (names.size > 64) throw new Error('Слишком много защищённых параметров одного MCP.');
  return [...names].sort();
}
export function withMcpSecrets(
  config: Record<string, unknown>,
  values: Record<string, string>,
  parser: PiConfigValues,
) {
  const result = structuredClone(config);
  for (const { section, key, text } of entries(config)) {
    const names = parser.getConfigValueEnvVarNames(text);
    if (!names.some((name) => Object.hasOwn(values, name))) continue;
    if (parser.isCommandConfigValue(text)) throw new Error('Секреты не подставляются в команды.');
    const value = parser.resolveConfigValue(text, values);
    if (value === undefined)
      throw new Error(
        'Не удалось разрешить переменные MCP. Сохраните секреты или настройте остальные переменные в окружении Pi.',
      );
    // Native Pi parses these fields again. Its literal escapes prevent a key from becoming a command or env reference.
    let literal = value.replaceAll('$', () => '$$');
    if (literal.startsWith('!')) literal = `$!${literal.slice(1)}`;
    (result[section] as Record<string, string>)[key] = literal;
  }
  return result;
}
