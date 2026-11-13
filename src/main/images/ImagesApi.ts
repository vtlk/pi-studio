import { validatePngBytes } from '../storage/png.ts';

export class ImagesApiError extends Error {
  readonly kind:
    'authentication' | 'access' | 'quota' | 'parameters' | 'generation' | 'uncertain' | 'cancelled';
  constructor(kind: ImagesApiError['kind'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
  }
}

async function readBody(response: Response, limit: number) {
  if (!response.body) throw new Error('Пустой ответ Images API.');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > limit) throw new Error('Ответ Images API превышает допустимый размер.');
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
async function apiError(response: Response, catalog = false): Promise<never> {
  const body = await readBody(response, 16384).catch(() => null);
  const failure = body && typeof body === 'object' ? body.error : undefined;
  const detail =
    failure && typeof failure === 'object' ? (failure as Record<string, unknown>) : undefined;
  const code = typeof detail?.code === 'string' ? detail.code : '';
  const message =
    typeof failure === 'string'
      ? failure
      : typeof detail?.message === 'string'
        ? detail.message
        : '';
  // Provider text may contain credentials. Use it only for classification, never echo it.
  if (response.status === 401 || response.status === 403) {
    if (/\bapi\.model\.read\b/i.test(message))
      throw new ImagesApiError(
        'access',
        `OpenAI: не хватает разрешения api.model.read для чтения каталога. В OpenAI Platform включите «List models → Read» для ключа и проверьте права его владельца в проекте.${catalog ? ' Генерация не запускалась.' : ' Автоматического повтора нет.'}`,
      );
    if (
      ['unsupported_country_region_territory', 'country_not_supported'].includes(code) ||
      /(?:unsupported|not supported).*(?:country|region|territory)|(?:country|region|territory).*(?:unsupported|not supported)/i.test(
        message,
      )
    )
      throw new ImagesApiError(
        'access',
        'OpenAI: API недоступен для страны или региона текущего подключения. Проверьте доступность OpenAI API; замена модели не устранит это ограничение.',
      );
    if (
      code !== 'invalid_api_key' &&
      (response.status === 403 ||
        /missing scopes?|insufficient permissions|permission denied/i.test(message))
    )
      throw new ImagesApiError(
        'access',
        `OpenAI запретил ${catalog ? 'чтение каталога моделей' : 'генерацию изображения'} (HTTP ${response.status}). Проверьте разрешения API-ключа и права в проекте OpenAI. Неверный ключ не подтверждён.`,
      );
    throw new ImagesApiError(
      'authentication',
      `Images API: ключ не принят (HTTP ${response.status}). Проверьте, что ключ действующий и относится к нужному проекту OpenAI.`,
    );
  }
  if (response.status === 429) {
    throw new ImagesApiError(
      'quota',
      code === 'insufficient_quota'
        ? 'Images API: исчерпана квота API. Подписка ChatGPT не подменяется другим подключением.'
        : 'Images API: достигнут лимит запросов. Автоматического повтора нет.',
    );
  }
  if ([400, 404, 422].includes(response.status))
    throw new ImagesApiError(
      'parameters',
      'Images API не принял модель, параметры или запрос изображения. Автоматической подмены нет.',
    );
  throw new ImagesApiError(
    'generation',
    `Images API вернул ошибку HTTP ${response.status}. Автоматического повтора нет.`,
  );
}

export interface ImageParameters {
  prompt: string;
  size: 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
  quality: 'auto' | 'low' | 'medium' | 'high';
  background: 'auto' | 'opaque' | 'transparent';
}
export function imageParameters(value: Record<string, unknown>): ImageParameters {
  if (
    Object.keys(value).some(
      (key) => !['prompt', 'size', 'quality', 'background', 'retryOperationId'].includes(key),
    )
  )
    throw new Error(
      'Инструмент не принимает модель, ключ, endpoint или путь назначения от агента.',
    );
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 32000)
    throw new Error('Нужно непустое описание изображения до 32000 символов.');
  const result = {
    prompt: value.prompt.trim(),
    size: value.size ?? 'auto',
    quality: value.quality ?? 'auto',
    background: value.background ?? 'auto',
  };
  if (
    !['auto', '1024x1024', '1536x1024', '1024x1536'].includes(String(result.size)) ||
    !['auto', 'low', 'medium', 'high'].includes(String(result.quality)) ||
    !['auto', 'opaque', 'transparent'].includes(String(result.background))
  )
    throw new Error('Неподдерживаемые параметры изображения.');
  return result as ImageParameters;
}
export class ImagesApi {
  private request: typeof fetch;
  constructor(request: typeof fetch = fetch) {
    this.request = request;
  }
  async models(key: string) {
    let response: Response;
    try {
      response = await this.request('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new Error(
        'Не удалось проверить Images API. Проверьте сеть и повторите проверку; генерация не запускалась.',
      );
    }
    if (!response.ok) return apiError(response, true);
    let body: Record<string, unknown>;
    try {
      body = await readBody(response, 2 * 1024 ** 2);
    } catch {
      throw new Error('Images API вернул некорректный каталог. Генерация не запускалась.');
    }
    if (!Array.isArray(body.data)) throw new Error('Images API вернул несовместимый каталог.');
    return [
      ...new Set(
        body.data
          .map((model) => model?.id)
          .filter(
            (id): id is string =>
              typeof id === 'string' && /^gpt-image-[a-zA-Z0-9._-]{1,120}$/.test(id),
          ),
      ),
    ].sort();
  }
  async generate(key: string, model: string, parameters: ImageParameters, signal: AbortSignal) {
    if (!/^gpt-image-[a-zA-Z0-9._-]{1,120}$/.test(model))
      throw new Error('Выберите модель GPT Image в общих настройках инструмента.');
    let response: Response;
    try {
      response = await this.request('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...parameters, model, n: 1, output_format: 'png' }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
      });
    } catch {
      if (signal.aborted)
        throw new ImagesApiError(
          'cancelled',
          'Запрос к Images API отменён. API мог успеть выполнить его; автоматического повтора нет.',
        );
      throw new ImagesApiError(
        'uncertain',
        'Не удалось получить результат Images API. Запрос мог выполниться; автоматического повтора нет.',
      );
    }
    if (!response.ok) return apiError(response);
    try {
      const body = await readBody(response, 48 * 1024 ** 2);
      const data = body.data;
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        typeof data[0]?.b64_json !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(data[0].b64_json)
      )
        throw new Error('Некорректный ответ изображения.');
      const bytes = Buffer.from(data[0].b64_json, 'base64');
      if (
        bytes.length > 32 * 1024 ** 2 ||
        bytes.length < 8 ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error('Images API не вернул поддерживаемый PNG.');
      validatePngBytes(bytes);
      const usage: Record<string, number> = {};
      if (body.usage && typeof body.usage === 'object')
        for (const name of ['input_tokens', 'output_tokens', 'total_tokens'] as const) {
          const value = (body.usage as Record<string, unknown>)[name];
          if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
            usage[name] = value;
        }
      return { bytes, ...(Object.keys(usage).length ? { usage } : {}) };
    } catch {
      if (signal.aborted)
        throw new ImagesApiError(
          'cancelled',
          'Получение изображения отменено. Результат API не определён; автоматического повтора нет.',
        );
      throw new ImagesApiError(
        'uncertain',
        'Images API ответил, но изображение не получено полностью. Повтор может создать новый расход.',
      );
    }
  }
}
