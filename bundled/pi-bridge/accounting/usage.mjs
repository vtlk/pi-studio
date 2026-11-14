import { createHash } from 'node:crypto';

const count = (value) => Number.isSafeInteger(value) && value >= 0;
/** Matches Pi 1.5.2 getSessionStats: all entries, including branch/compaction/tool usage. */
export function usageRecord(entry) {
  let usage;
  if (entry.type === 'message' && entry.message?.role === 'assistant') usage = entry.message.usage;
  else if (entry.type === 'message' && entry.message?.role === 'toolResult' && entry.message.usage)
    usage = entry.message.usage;
  else if (entry.type === 'usage') usage = entry.usage;
  else if (['compaction', 'branch_summary'].includes(entry.type) && entry.usage)
    usage = entry.usage;
  else return;
  if (typeof entry.id !== 'string' || !entry.id || typeof entry.timestamp !== 'string') return;
  const id = createHash('sha256')
    .update(`${entry.type}\0${entry.id}\0${entry.timestamp}`)
    .digest('hex')
    .slice(0, 32);
  const tokens = {};
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'])
    if (count(usage?.[key])) tokens[key] = usage[key];
  if (Object.keys(tokens).length === 4) {
    const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (count(total)) tokens.total = total;
  }
  const value = usage?.cost?.total;
  // Pi's catalog schema and telemetry define costs in USD. A default subscription zero is not a price.
  const knownCost =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    (value > 0 || usage.cost.totalFromProvider === true);
  return {
    id,
    tokens,
    ...(knownCost
      ? { cost: { value, currency: 'USD', estimated: usage.cost.totalFromProvider !== true } }
      : {}),
  };
}

export function collectUsage(entries) {
  return entries.map(usageRecord).filter(Boolean);
}
