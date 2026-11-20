import assert from 'node:assert/strict';

export async function readAllSettings<T>(
  read: (args: Record<string, unknown>) => Promise<unknown>,
  args: Record<string, unknown>,
): Promise<T> {
  let result = (await read(args)) as Record<string, unknown>;
  const parts: string[] = [];
  for (let count = 0; count < 10000; count++) {
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= Number(args.max_bytes ?? 8192));
    if (result.format !== 'json-fragment') return result as T;
    parts.push(String(result.content));
    const next = result.nextCall as { arguments: Record<string, unknown> } | null;
    if (!next) return JSON.parse(parts.join('')) as T;
    result = (await read(next.arguments)) as Record<string, unknown>;
  }
  throw Error('Settings pagination did not terminate');
}
