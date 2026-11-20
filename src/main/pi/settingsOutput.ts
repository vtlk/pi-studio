import { createHash } from 'node:crypto';
import { t } from '../../shared/i18n/index.ts';

export const settingsReadProperties = {
  offset: { type: 'integer', minimum: 0 },
  max_bytes: { type: 'integer', minimum: 1024, maximum: 8192 },
  fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  include_derived_prompts: { type: 'boolean' },
};
export const settingsReadGuidance =
  'Bounded output: if pagination.complete=false, follow nextCall with its offset/fingerprint until complete. JSON-fragment pages concatenate their content verbatim into one JSON document. Never claim a full read from the first page or print the combined document into another tool output. Default omits duplicate derived prompt views; full main prompt and ALL instruction texts/enabled flags remain present. Set include_derived_prompts=true only to inspect combined/effective runtime prompts.';

/** Stay below native Pi MCP's 20 KiB limit, including JSON escaping and continuation metadata. */
export function settingsOutput(value: object, args: Record<string, unknown>) {
  const cap = args.max_bytes ?? 8192,
    offset = args.offset ?? 0;
  if (
    !Number.isSafeInteger(cap) ||
    Number(cap) < 1024 ||
    Number(cap) > 8192 ||
    !Number.isSafeInteger(offset) ||
    Number(offset) < 0 ||
    (args.include_derived_prompts !== undefined &&
      typeof args.include_derived_prompts !== 'boolean') ||
    (args.fingerprint !== undefined &&
      (typeof args.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(args.fingerprint))) ||
    (Number(offset) > 0 && args.fingerprint === undefined)
  )
    throw Error(t('SettingsRead.invalid'));
  const document = structuredClone(value) as Record<string, Record<string, unknown> | unknown>;
  if (args.include_derived_prompts !== true) {
    for (const [section, keys] of [
      ['currentConstructor', ['roleInstructions']],
      ['freshStudioContext', ['prompt']],
      ['appliedRuntime', ['roleInstructions', 'studioSystemPrompt']],
    ] as const) {
      const part = document[section] as Record<string, unknown> | null;
      if (!part || typeof part !== 'object') continue;
      for (const key of keys)
        if (typeof part[key] === 'string') {
          delete part[key];
          part.derivedPromptsAvailable = true;
        }
    }
  }
  const bytes = Buffer.from(JSON.stringify(document), 'utf8');
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  if (args.fingerprint !== undefined && args.fingerprint !== fingerprint)
    throw Error(t('SettingsRead.changed'));
  const start = Number(offset),
    maximum = Number(cap);
  const boundary = (index: number) => index >= bytes.length || (bytes[index] & 0xc0) !== 0x80;
  if (start > bytes.length || !boundary(start)) throw Error(t('SettingsRead.invalid'));
  const pagination = (end: number) => ({
    offset: start,
    nextOffset: end < bytes.length ? end : null,
    totalBytes: bytes.length,
    fingerprint,
    complete: end === bytes.length,
  });
  if (!start) {
    const inline = { ...document, pagination: pagination(bytes.length) };
    if (Buffer.byteLength(JSON.stringify(inline)) <= maximum) return inline;
  }
  const page = (end: number) => ({
    format: 'json-fragment',
    content: bytes.subarray(start, end).toString('utf8'),
    pagination: pagination(end),
    nextCall:
      end < bytes.length
        ? {
            tool: 'read_agent_settings',
            arguments: {
              agent_id: args.agent_id,
              offset: end,
              fingerprint,
              max_bytes: maximum,
              include_derived_prompts: args.include_derived_prompts === true,
            },
          }
        : null,
    note: 'Partial JSON document: concatenate content from every page in order. Read nextCall until pagination.complete=true; do not treat a partial page as the full settings.',
  });
  let low = start,
    high = Math.min(bytes.length, start + maximum);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(page(middle))) <= maximum) low = middle;
    else high = middle - 1;
  }
  while (low > start && !boundary(low)) low--;
  while (low > start && Buffer.byteLength(JSON.stringify(page(low))) > maximum) {
    low--;
    while (low > start && !boundary(low)) low--;
  }
  if (low === start && start < bytes.length) throw Error(t('SettingsRead.invalid'));
  return page(low);
}
