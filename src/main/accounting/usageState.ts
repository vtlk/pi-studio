import {
  tokenFields,
  type AgentUsage,
  type UsageRecord,
  type UsageSample,
  type UsageValue,
} from '../../shared/projectUsage.ts';

export interface Measure {
  sum: number;
  known: number;
  unknown: number;
}
export interface AgentLedger {
  legacy: boolean;
  seen: string[];
  duration: Measure;
  tokens: Record<(typeof tokenFields)[number], Measure>;
  costs: Record<string, { sum: number; estimated: boolean }>;
  unknownCost: number;
  run?: { id: string; sample: number; elapsedMs: number; intervals: number; active: boolean };
}
const empty = (): Measure => ({ sum: 0, known: 0, unknown: 0 });
export function emptyAgentLedger(legacy: boolean): AgentLedger {
  return {
    legacy,
    seen: [],
    duration: { ...empty(), unknown: legacy ? 1 : 0 },
    tokens: Object.fromEntries(tokenFields.map((key) => [key, empty()])) as AgentLedger['tokens'],
    costs: {},
    unknownCost: 0,
  };
}
const value = (measure: Measure, legacy = false): UsageValue => ({
  value: (measure.unknown || legacy) && !measure.known ? null : measure.sum,
  partial: measure.unknown > 0 || legacy,
});
export function agentUsage(state: AgentLedger): AgentUsage {
  const costPartial = state.unknownCost > 0 || state.legacy;
  const costs: AgentUsage['costs'] = Object.entries(state.costs).map(([currency, money]) => ({
    currency,
    value: money.sum,
    estimated: money.estimated,
    partial: costPartial,
  }));
  if (!costs.length && !costPartial && !state.seen.length)
    costs.push({ currency: 'USD', value: 0, estimated: false, partial: false });
  return {
    duration: value(state.duration),
    tokens: Object.fromEntries(
      tokenFields.map((key) => [key, value(state.tokens[key], state.legacy)]),
    ) as AgentUsage['tokens'],
    costs,
    costPartial,
    costObserved: Object.keys(state.costs).length > 0,
  };
}
export function startUsageRun(state: AgentLedger, runId: string) {
  if (state.run?.id === runId) return;
  if (state.run?.active) state.duration.unknown++;
  state.run = { id: runId, sample: 0, elapsedMs: 0, intervals: 0, active: false };
}
export function loseUsageRun(state: AgentLedger, runId?: string) {
  if (state.run && (!runId || state.run.id === runId) && state.run.active) {
    state.duration.unknown++;
    state.run.active = false;
  }
}
export function applyUsageSample(
  state: AgentLedger,
  runId: string | undefined,
  sample: UsageSample,
) {
  const seen = new Set(state.seen);
  for (const record of sample.records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    state.seen.push(record.id);
    for (const field of tokenFields) {
      const number = record.tokens[field],
        measure = state.tokens[field];
      if (number === undefined) measure.unknown++;
      else {
        measure.sum += number;
        measure.known++;
      }
    }
    if (record.cost) {
      const money = state.costs[record.cost.currency] ?? { sum: 0, estimated: false };
      money.sum += record.cost.value;
      money.estimated ||= record.cost.estimated;
      state.costs[record.cost.currency] = money;
    } else state.unknownCost++;
  }
  const time = sample.time,
    cursor = state.run;
  if (
    time &&
    cursor &&
    runId === cursor?.id &&
    time.sample > cursor.sample &&
    time.elapsedMs >= cursor.elapsedMs &&
    time.intervals >= cursor.intervals
  ) {
    state.duration.sum += time.elapsedMs - cursor.elapsedMs;
    state.duration.known += time.intervals - cursor.intervals;
    state.run = { id: cursor.id, ...time };
  }
}
export function sumUsage(states: AgentUsage[]): AgentUsage {
  if (!states.length) return agentUsage(emptyAgentLedger(false));
  const sum = (values: UsageValue[]): UsageValue => ({
    value:
      values.some((item) => item.value !== null) &&
      !(values.some((item) => item.value === null) && values.every((item) => !item.value))
        ? values.reduce((total, item) => total + (item.value ?? 0), 0)
        : null,
    partial: values.some((item) => item.partial || item.value === null),
  });
  const costs = new Map<string, AgentUsage['costs'][number]>();
  const costPartial = states.some((state) => state.costPartial);
  for (const state of states)
    for (const money of state.costs) {
      if (costPartial && !state.costObserved) continue;
      const previous = costs.get(money.currency);
      costs.set(money.currency, {
        currency: money.currency,
        value: (previous?.value ?? 0) + (money.value ?? 0),
        estimated: !!previous?.estimated || money.estimated,
        partial: costPartial,
      });
    }
  return {
    duration: sum(states.map((state) => state.duration)),
    tokens: Object.fromEntries(
      tokenFields.map((field) => [field, sum(states.map((state) => state.tokens[field]))]),
    ) as AgentUsage['tokens'],
    costs: [...costs.values()],
    costPartial,
    costObserved: states.some((state) => state.costObserved),
  };
}

export function parseUsageSample(value: unknown): UsageSample {
  if (!value || typeof value !== 'object') throw new Error('Invalid usage sample');
  const sample = value as UsageSample;
  if (!Array.isArray(sample.records) || sample.records.length > 1000)
    throw new Error('Invalid usage records');
  const integer = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const records: UsageRecord[] = sample.records.map((record) => {
    if (
      !record ||
      typeof record.id !== 'string' ||
      !/^[a-f0-9]{32}$/.test(record.id) ||
      !record.tokens ||
      typeof record.tokens !== 'object' ||
      Array.isArray(record.tokens)
    )
      throw new Error('Invalid usage entry');
    const tokens: UsageRecord['tokens'] = {};
    for (const field of tokenFields)
      if (record.tokens[field] !== undefined) {
        if (!integer(record.tokens[field])) throw new Error('Invalid token count');
        tokens[field] = record.tokens[field];
      }
    const cost = record.cost;
    if (
      cost &&
      (!Number.isFinite(cost.value) ||
        cost.value < 0 ||
        typeof cost.currency !== 'string' ||
        !/^[A-Z]{3}$/.test(cost.currency) ||
        typeof cost.estimated !== 'boolean')
    )
      throw new Error('Invalid cost');
    return {
      id: record.id,
      tokens,
      ...(cost
        ? { cost: { value: cost.value, currency: cost.currency, estimated: cost.estimated } }
        : {}),
    };
  });
  if (
    sample.time &&
    (!integer(sample.time.sample) ||
      !integer(sample.time.elapsedMs) ||
      !integer(sample.time.intervals) ||
      typeof sample.time.active !== 'boolean')
  )
    throw new Error('Invalid elapsed time');
  return {
    records,
    ...(sample.time
      ? {
          time: {
            sample: sample.time.sample,
            elapsedMs: sample.time.elapsedMs,
            intervals: sample.time.intervals,
            active: sample.time.active,
          },
        }
      : {}),
  };
}
