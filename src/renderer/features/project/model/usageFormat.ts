import type { AgentUsage, UsageValue } from '../../../../shared/projectUsage';

export function durationText(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000),
    hours = Math.floor(seconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours
    ? `${hours}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
    : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}
export function tokensText(value: number) {
  const suffixes = ['', 'k', 'm', 'b'];
  let scale = 0;
  while (scale < 3 && value >= 1000 ** (scale + 1)) scale++;
  if (!scale) return String(value);
  let rounded = Math.round((value / 1000 ** scale) * 10) / 10;
  if (rounded >= 1000 && scale < 3) {
    scale++;
    rounded = Math.round((value / 1000 ** scale) * 10) / 10;
  }
  return `${rounded}${suffixes[scale]}`;
}
export function usageText(value: UsageValue | undefined, formatter: (value: number) => string) {
  if (!value) return '…';
  if (value.value === null) return '—';
  return `${formatter(value.value)}${value.partial ? '*' : ''}`;
}
export function moneyText(value: number, currency: string) {
  const format = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  });
  return value > 0 && value < 0.0001 ? `<${format.format(0.0001)}` : format.format(value);
}
export function costText(usage: AgentUsage | undefined) {
  if (!usage) return '…';
  if (usage.costs.length !== 1) return '—';
  const cost = usage.costs[0];
  return usageText({ value: cost.value, partial: usage.costPartial || cost.partial }, (value) =>
    moneyText(value, cost.currency),
  );
}
export function usageAccessible(usage: AgentUsage | undefined, includeTime = true) {
  if (!usage) return 'Расход загружается';
  const metric = (value: UsageValue, unit: string) =>
    `${unit}: ${value.value === null ? 'неизвестно' : `${value.value}${value.partial ? ', частичные данные' : ''}`}`;
  const time =
    usage.duration.value === null
      ? 'Время работы неизвестно'
      : `Время работы: ${Math.floor(usage.duration.value / 1000)} секунд${usage.duration.partial ? ', частичные данные' : ''}`;
  const costs = usage.costs.length
    ? usage.costs.map((cost) => `${cost.value} ${cost.currency}`).join('; ')
    : 'неизвестно';
  return [
    includeTime ? time : '',
    metric(usage.tokens.input, 'Входные токены'),
    metric(usage.tokens.output, 'Выходные токены'),
    `Стоимость по данным Pi: ${costs}${usage.costPartial ? ', частичные данные' : ''}`,
  ]
    .filter(Boolean)
    .join('. ');
}
