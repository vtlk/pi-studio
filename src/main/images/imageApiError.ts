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
        `OpenAI: не хватает разрешения api.model.read для чтения каталога. В OpenAI Platform включите «List models → Read» для ключа и проверьте права его владельца в проекте.${catalog ? ' Генерация не запускалась.' : ' Автоматического повтора нет.'}`,
      );
    if (/\bapi\.model\.request\b/i.test(message))
      return error(
        'access',
        'OpenAI: не хватает разрешения api.model.request для генерации. Проверьте права ключа и его владельца в проекте OpenAI. Чтение списка моделей само по себе не даёт доступ к генерации.',
      );
    if (
      ['unsupported_country_region_territory', 'country_not_supported'].includes(rawCode) ||
      /(?:unsupported|not supported).*(?:country|region|territory)|(?:country|region|territory).*(?:unsupported|not supported)/i.test(
        message,
      )
    )
      return error(
        'access',
        'OpenAI: API недоступен для страны или региона текущего подключения. Проверьте доступность OpenAI API; замена модели не устранит это ограничение.',
      );
  }
  if (
    rawCode === 'organization_verification_required' ||
    /(?:organization|organisation).*(?:must be verified|verification required)|(?:verify your|verified) (?:organization|organisation)/i.test(
      message,
    )
  )
    return error(
      'access',
      'OpenAI требует верификацию организации для выбранной модели. Проверьте статус организации в OpenAI Platform. Автоматической подмены нет.',
    );
  if (status === 401 || status === 403) {
    if (
      rawCode !== 'invalid_api_key' &&
      (status === 403 ||
        /missing scopes?|insufficient permissions|permission denied/i.test(message))
    )
      return error(
        'access',
        `OpenAI запретил ${catalog ? 'чтение каталога моделей' : 'генерацию изображения'} (HTTP ${status}). Проверьте разрешения API-ключа и права в проекте OpenAI. Неверный ключ не подтверждён.`,
      );
    return error(
      'authentication',
      `Images API: ключ не принят (HTTP ${status}). Проверьте, что ключ действующий и относится к нужному проекту OpenAI.`,
    );
  }
  if (status === 429)
    return error(
      'quota',
      rawCode === 'insufficient_quota'
        ? 'Images API: исчерпана квота API. Подписка ChatGPT не подменяется другим подключением.'
        : 'Images API: достигнут лимит запросов. Автоматического повтора нет.',
    );
  if ([400, 404, 422].includes(status)) {
    const explanation =
      ['content_policy_violation', 'moderation_blocked', 'safety_violations'].includes(rawCode) ||
      /blocked by.*(?:safety|moderation)|content policy/i.test(message)
        ? 'Images API отклонил запрос или референс при проверке безопасности.'
        : ['model_not_found', 'model_not_available'].includes(rawCode)
          ? 'Images API: выбранная модель недоступна для этого подключения.'
          : diagnostic.param
            ? `Images API отклонил параметр «${diagnostic.param}». Проверьте его значение и поддержку выбранной моделью.`
            : 'Images API отклонил запрос. Сервер не указал распознанный параметр отказа.';
    return error('parameters', `${explanation} Автоматической подмены нет. Повтор не выполнен.`);
  }
  return error('generation', 'Images API вернул ошибку. Автоматического повтора нет.');
}
