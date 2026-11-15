import { isAbsolute } from 'node:path';
/** Secret values stay in native Pi/secure storage. MCP configuration accepts references, never chat secrets. */
export function assertCredentialReferences(config: Record<string, unknown>) {
  const reference = (value: unknown) =>
    typeof value === 'string' && (/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value) || /^!.+/.test(value));
  const secretKey = /authorization|token|secret|password|api.?key|credential/i;
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'string' && secretKey.test(key) && !reference(value))
      throw new Error(
        'Секреты нельзя передавать помощнику. Используйте native Pi OAuth либо ссылку на окружение/защищённое хранилище.',
      );
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (
          typeof item === 'string' &&
          /^--?(?:api[-_]?key|token|password|secret|authorization)(?:=|$)/i.test(item)
        ) {
          const inline = item.includes('=') ? item.slice(item.indexOf('=') + 1) : value[i + 1];
          if (!reference(inline))
            throw new Error(
              'Секрет в аргументах запуска не допускается. Используйте ссылку native Pi.',
            );
        }
        visit(item);
      }
    } else if (value && typeof value === 'object')
      for (const [child, item] of Object.entries(value))
        visit(item, child === 'provider' ? '' : child);
  };
  visit(config);
  if (typeof config.url === 'string') {
    const url = new URL(config.url);
    if (
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((key) => secretKey.test(key))
    )
      throw new Error(
        'URL MCP не должен содержать учётные данные или токены. Используйте native Pi auth.',
      );
  }
}
export function packageSource(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2000 ||
    value.includes('\0') ||
    /[\r\n]/.test(value)
  )
    throw new Error('Нужен источник пакета Pi.');
  if (!(isAbsolute(value) || /^(npm:|git:|https:\/\/github\.com\/)/.test(value)))
    throw new Error('Укажите локальный абсолютный путь либо источник native Pi npm:/git:.');
  const url = value.replace(/^git:/, '');
  if (/^https?:\/\//.test(url)) {
    const parsed = new URL(url);
    if (
      parsed.username ||
      parsed.password ||
      [...parsed.searchParams.keys()].some((key) => /token|secret|password|api.?key/i.test(key))
    )
      throw new Error('Не указывайте секреты в URL пакета.');
  }
  return value;
}
