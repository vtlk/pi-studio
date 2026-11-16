import { t } from './i18n/index.ts';
import type { PiModelSummary } from './models.ts';

export const reasoningLabels = {
  off: 'Выключен',
  minimal: 'Минимальный',
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  xhigh: 'Максимальный',
  max: 'Предельный',
} as const;
export type ThinkingLevel = keyof typeof reasoningLabels;

/** Keep existing Russian selections and native Pi values; unknown strings never mean medium. */
export function parseReasoning(value: string | undefined): ThinkingLevel | 'default' | undefined {
  if (value === 'По умолчанию' || value === 'default') return 'default';
  return (Object.keys(reasoningLabels) as ThinkingLevel[]).find(
    (level) => value === level || value === reasoningLabels[level],
  );
}

export function resolveReasoning(value: string, model: PiModelSummary): ThinkingLevel {
  const selection = parseReasoning(value);
  if (!selection) throw new Error(t('error.reasoning.selectAValidAgentReasoning'));
  if (!model.reasoningLevels?.length || !model.defaultReasoningLevel)
    throw new Error(t('error.reasoning.thePiCatalogDidNot'));
  const level = selection === 'default' ? model.defaultReasoningLevel : selection;
  if (!model.reasoningLevels.includes(level))
    throw new Error(t('error.reasoning.theSelectedModelDoesNot'));
  return level;
}
