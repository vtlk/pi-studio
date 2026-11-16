import { t } from '../../shared/i18n/index.ts';
import { isAbsolute } from 'node:path';
/** Secret values stay in native Pi/secure storage. MCP configuration accepts references, never chat secrets. */
export function assertCredentialReferences(config: Record<string, unknown>) {
  const reference = (value: unknown) =>
    typeof value === 'string' && (/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value) || /^!.+/.test(value));
  const secretKey = /authorization|token|secret|password|api.?key|credential/i;
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'string' && secretKey.test(key) && !reference(value))
      throw new Error(t('error.resourceConfig.doNotPassSecretsTo'));
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (
          typeof item === 'string' &&
          /^--?(?:api[-_]?key|token|password|secret|authorization)(?:=|$)/i.test(item)
        ) {
          const inline = item.includes('=') ? item.slice(item.indexOf('=') + 1) : value[i + 1];
          if (!reference(inline)) throw new Error(t('error.resourceConfig.secretsAreNotAllowedIn'));
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
      throw new Error(t('error.resourceConfig.theMcpUrlMustNot'));
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
    throw new Error(t('error.resourceConfig.aPiPackageSourceIs'));
  if (!(isAbsolute(value) || /^(npm:|git:|https:\/\/github\.com\/)/.test(value)))
    throw new Error(t('error.resourceConfig.provideAnAbsoluteLocalPath'));
  const url = value.replace(/^git:/, '');
  if (/^https?:\/\//.test(url)) {
    const parsed = new URL(url);
    if (
      parsed.username ||
      parsed.password ||
      [...parsed.searchParams.keys()].some((key) => /token|secret|password|api.?key/i.test(key))
    )
      throw new Error(t('error.resourceConfig.doNotIncludeSecretsIn'));
  }
  return value;
}
