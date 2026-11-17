import { t } from './i18n/index.ts';
import type { ResourceCheck } from './resources.ts';

/** Portable requirements only. Never contains credentials or the sender's login state. */
export interface McpAuthorization {
  required: 'yes' | 'no' | 'unknown';
  methods: ('oauth' | 'parameters' | 'provider')[];
  fields: { section: 'env' | 'headers' | 'oauth'; name: string }[];
}

export function describeMcpAuthorization(
  config: Record<string, unknown>,
  check?: ResourceCheck,
): McpAuthorization {
  const fields: McpAuthorization['fields'] = [];
  const methods: McpAuthorization['methods'] = [];
  for (const section of ['env', 'headers'] as const) {
    const value = config[section];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const name of Object.keys(value)) {
      if (section === 'headers' && /^(accept|content-type)$/i.test(name)) continue;
      fields.push({ section, name });
    }
  }
  if (config.oauth && typeof config.oauth === 'object') {
    methods.push('oauth');
    if ('clientSecret' in config.oauth) fields.push({ section: 'oauth', name: 'clientSecret' });
  }
  if (config.auth && typeof config.auth === 'object' && 'provider' in config.auth)
    methods.push('provider');
  if (fields.length) methods.push('parameters');
  if (check?.status === 'needs_auth' && !methods.length) methods.push('oauth');
  const authorizationKnown =
    check?.status === 'needs_auth' ||
    methods.includes('oauth') ||
    methods.includes('provider') ||
    fields.some((field) =>
      /authorization|token|secret|password|api.?key|credential/i.test(field.name),
    );
  // A URL or a successful check does not tell us whether Pi used a saved OAuth token.
  // Export also protects ordinary env/headers: their presence alone is not proof of authentication.
  return { required: authorizationKnown ? 'yes' : 'unknown', methods, fields };
}

export function parseMcpAuthorization(value: unknown): McpAuthorization {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(t('Onboarding.invalidAuthorization'));
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some((key) => !['required', 'methods', 'fields'].includes(key)) ||
    !['yes', 'no', 'unknown'].includes(String(data.required)) ||
    !Array.isArray(data.methods) ||
    data.methods.length > 3 ||
    data.methods.some((method) => !['oauth', 'parameters', 'provider'].includes(method)) ||
    new Set(data.methods).size !== data.methods.length ||
    !Array.isArray(data.fields) ||
    data.fields.length > 64
  )
    throw new Error(t('Onboarding.invalidAuthorization'));
  const fields = data.fields.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(t('Onboarding.invalidAuthorization'));
    const field = value as Record<string, unknown>;
    if (
      Object.keys(field).some((key) => !['section', 'name'].includes(key)) ||
      !['env', 'headers', 'oauth'].includes(String(field.section)) ||
      typeof field.name !== 'string' ||
      !field.name ||
      field.name.length > 128 ||
      /[\r\n\0]/.test(field.name) ||
      (field.section === 'oauth' && field.name !== 'clientSecret')
    )
      throw new Error(t('Onboarding.invalidAuthorization'));
    return {
      section: field.section as McpAuthorization['fields'][number]['section'],
      name: field.name,
    };
  });
  if (
    (data.required === 'no' && (data.methods.length || fields.length)) ||
    (data.required === 'yes' && !data.methods.length)
  )
    throw new Error(t('Onboarding.invalidAuthorization'));
  return {
    required: data.required as McpAuthorization['required'],
    methods: data.methods as McpAuthorization['methods'],
    fields,
  };
}
