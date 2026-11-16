import { t } from '../../shared/i18n/index.ts';
export interface ImageApiDiagnostic {
  status: number;
  code?: string;
  type?: string;
  param?: string;
}

// Only protocol vocabulary may leave main. Provider messages/unknown field values can
// contain the prompt, credentials or image data and must never be echoed or persisted.
const codes = new Set([
  'invalid_api_key',
  'insufficient_quota',
  'rate_limit_exceeded',
  'invalid_request_error',
  'invalid_parameter',
  'invalid_value',
  'unsupported_value',
  'unsupported_parameter',
  'unknown_parameter',
  'missing_required_parameter',
  'model_not_found',
  'model_not_available',
  'permission_denied',
  'content_policy_violation',
  'moderation_blocked',
  'safety_violations',
  'invalid_image',
  'invalid_image_format',
  'invalid_image_url',
  'image_too_large',
  'unsupported_country_region_territory',
  'country_not_supported',
  'organization_verification_required',
]);
const types = new Set([
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'rate_limit_error',
  'server_error',
  'image_generation_user_error',
]);
const params = new Set([
  'model',
  'prompt',
  'size',
  'quality',
  'background',
  'n',
  'output_format',
  'output_compression',
  'response_format',
  'image',
  'image[]',
  'images',
  'mask',
  'input_fidelity',
  'moderation',
  'user',
]);

export class ImagesApiError extends Error {
  readonly kind:
    'authentication' | 'access' | 'quota' | 'parameters' | 'generation' | 'uncertain' | 'cancelled';
  readonly diagnostic?: ImageApiDiagnostic;
  constructor(kind: ImagesApiError['kind'], message: string, diagnostic?: ImageApiDiagnostic) {
    const detail = diagnostic
      ? [
          `HTTP ${diagnostic.status}`,
          ...(['code', 'type', 'param'] as const).flatMap((key) =>
            diagnostic[key] ? [`${key}=${diagnostic[key]}`] : [],
          ),
        ].join('; ')
      : '';
    super(detail ? `${message} [${detail}]` : message);
    this.kind = kind;
    this.diagnostic = diagnostic;
  }
}

export function imagesApiFailure(
  status: number,
  body: Record<string, unknown> | null,
  catalog = false,
) {
  const failure = body?.error;
  const detail =
    failure && typeof failure === 'object' ? (failure as Record<string, unknown>) : undefined;
  const rawCode = typeof detail?.code === 'string' ? detail.code : '';
  const message =
    typeof failure === 'string'
      ? failure
      : typeof detail?.message === 'string'
        ? detail.message
        : '';
  const diagnostic: ImageApiDiagnostic = { status };
  for (const [key, allowed] of [
    ['code', codes],
    ['type', types],
    ['param', params],
  ] as const)
    if (typeof detail?.[key] === 'string' && allowed.has(detail[key]))
      diagnostic[key] = detail[key];
  // A few API errors identify the parameter only in their message. Copy only a
  // recognized parameter token, never arbitrary quoted text or the full message.
  if (!diagnostic.param) {
    const token = message.match(
      /(?:parameter|param|argument)\s*[:=]?\s*['"`]([a-z_]+(?:\[\])?)['"`]/i,
    )?.[1];
    if (token && params.has(token)) diagnostic.param = token;
  }
  const error = (kind: ImagesApiError['kind'], text: string) =>
    new ImagesApiError(kind, text, diagnostic);
  if (status === 401 || status === 403) {
    if (/\bapi\.model\.read\b/i.test(message))
      return error(
        'access',
        t('error.imageApiError.openaiApiModelReadPermission', {
          value1: catalog
            ? t('error.imageApiError.noGenerationWasStarted')
            : t('error.imageApiError.noAutomaticRetry'),
        }),
      );
    if (/\bapi\.model\.request\b/i.test(message))
      return error('access', t('error.imageApiError.openaiApiModelRequestPermission'));
    if (
      ['unsupported_country_region_territory', 'country_not_supported'].includes(rawCode) ||
      /(?:unsupported|not supported).*(?:country|region|territory)|(?:country|region|territory).*(?:unsupported|not supported)/i.test(
        message,
      )
    )
      return error('access', t('error.imageApiError.openaiTheApiIsUnavailable'));
  }
  if (
    rawCode === 'organization_verification_required' ||
    /(?:organization|organisation).*(?:must be verified|verification required)|(?:verify your|verified) (?:organization|organisation)/i.test(
      message,
    )
  )
    return error('access', t('error.imageApiError.openaiRequiresOrganizationVerificati'));
  if (status === 401 || status === 403) {
    if (
      rawCode !== 'invalid_api_key' &&
      (status === 403 ||
        /missing scopes?|insufficient permissions|permission denied/i.test(message))
    )
      return error(
        'access',
        t('error.imageApiError.openaiDeniedHttpCheckApi', {
          value1: catalog
            ? t('error.imageApiError.readingTheModelCatalog')
            : t('error.imageApiError.imageGeneration'),
          value2: status,
        }),
      );
    return error(
      'authentication',
      t('error.imageApiError.imagesApiKeyRejectedHttp', {
        value1: status,
      }),
    );
  }
  if (status === 429)
    return error(
      'quota',
      rawCode === 'insufficient_quota'
        ? t('error.imageApiError.imagesApiApiQuotaExhausted')
        : t('error.imageApiError.imagesApiRequestLimitReached'),
    );
  if ([400, 404, 422].includes(status)) {
    const explanation =
      ['content_policy_violation', 'moderation_blocked', 'safety_violations'].includes(rawCode) ||
      /blocked by.*(?:safety|moderation)|content policy/i.test(message)
        ? t('error.imageApiError.theImagesApiRejectedThe')
        : ['model_not_found', 'model_not_available'].includes(rawCode)
          ? t('error.imageApiError.imagesApiTheSelectedModel')
          : diagnostic.param
            ? t('error.imageApiError.theImagesApiRejectedParameter', {
                value1: diagnostic.param,
              })
            : t('error.imageApiError.theImagesApiRejectedThe2');
    return error(
      'parameters',
      t('error.imageApiError.noAutomaticSubstitutionNoRetry', {
        value1: explanation,
      }),
    );
  }
  return error('generation', t('error.imageApiError.theImagesApiReturnedAn'));
}
