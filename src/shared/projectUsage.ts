export const tokenFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const;
export type TokenField = (typeof tokenFields)[number];
export interface UsageValue {
  value: number | null;
  partial: boolean;
}
export interface UsageMoney extends UsageValue {
  currency: string;
  estimated: boolean;
}
export interface AgentUsage {
  duration: UsageValue;
  tokens: Record<TokenField, UsageValue>;
  costs: UsageMoney[];
  costPartial: boolean;
  costObserved: boolean;
}
export interface ProjectUsage {
  projectId: string;
  total: AgentUsage;
  agents: Record<string, AgentUsage>;
}
/** Numeric usage only; IDs are hashes of immutable native entry identity, without message text. */
export interface UsageRecord {
  id: string;
  tokens: Partial<Record<TokenField, number>>;
  cost?: { value: number; currency: string; estimated: boolean };
}
export interface UsageTime {
  sample: number;
  elapsedMs: number;
  intervals: number;
  active: boolean;
}
export interface UsageSample {
  records: UsageRecord[];
  time?: UsageTime;
}
