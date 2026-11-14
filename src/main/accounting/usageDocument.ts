import { tokenFields } from '../../shared/projectUsage.ts';
import { parseUsageSample, type AgentLedger, type Measure } from './usageState.ts';

export interface UsageDocument {
  schemaVersion: 1;
  projectId: string;
  legacy: boolean;
  agents: Record<string, AgentLedger>;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid usage ledger object');
  return value as Record<string, unknown>;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid usage total');
  return value;
}
function measure(value: unknown): Measure {
  const row = object(value);
  return { sum: integer(row.sum), known: integer(row.known), unknown: integer(row.unknown) };
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
    throw new Error('Invalid usage identity');
  return value;
}
/** Rebuild the allowed schema, so unrelated text/credentials can never be persisted as accounting. */
export function parseUsageDocument(value: unknown): UsageDocument {
  const doc = object(value);
  if (doc.schemaVersion !== 1 || typeof doc.legacy !== 'boolean')
    throw new Error('Invalid usage ledger version');
  const agents = Object.entries(object(doc.agents)).map(([id, value]): [string, AgentLedger] => {
    identifier(id);
    const state = object(value),
      tokens = object(state.tokens);
    if (
      typeof state.legacy !== 'boolean' ||
      !Array.isArray(state.seen) ||
      state.seen.length > 250000 ||
      state.seen.some((id) => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) ||
      new Set(state.seen).size !== state.seen.length
    )
      throw new Error('Invalid usage cursor');
    const costs = Object.entries(object(state.costs)).map(([currency, value]) => {
      const cost = object(value);
      if (
        !/^[A-Z]{3}$/.test(currency) ||
        typeof cost.sum !== 'number' ||
        !Number.isFinite(cost.sum) ||
        cost.sum < 0 ||
        typeof cost.estimated !== 'boolean'
      )
        throw new Error('Invalid cost');
      return [currency, { sum: cost.sum, estimated: cost.estimated }];
    });
    let run: AgentLedger['run'];
    if (state.run !== undefined) {
      const row = object(state.run);
      const time = parseUsageSample({ records: [], time: row }).time!;
      run = { id: identifier(row.id), ...time };
    }
    return [
      id,
      {
        legacy: state.legacy,
        seen: [...state.seen],
        duration: measure(state.duration),
        tokens: Object.fromEntries(
          tokenFields.map((field) => [field, measure(tokens[field])]),
        ) as AgentLedger['tokens'],
        costs: Object.fromEntries(costs),
        unknownCost: integer(state.unknownCost),
        ...(run ? { run } : {}),
      },
    ];
  });
  return {
    schemaVersion: 1,
    projectId: identifier(doc.projectId),
    legacy: doc.legacy,
    agents: Object.fromEntries(agents),
  };
}
