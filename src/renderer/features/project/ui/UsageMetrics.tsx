import { ArrowDown, ArrowUp } from 'lucide-react';
import type { AgentUsage } from '../../../../shared/projectUsage';
import { Tooltip } from '@/shared/ui/Tooltip';
import {
  costText,
  durationText,
  tokensText,
  usageAccessible,
  usageText,
} from '../model/usageFormat';

export function UsageMetrics({
  usage,
  includeTime = true,
}: {
  usage?: AgentUsage;
  includeTime?: boolean;
}) {
  const label = usageAccessible(usage, includeTime);
  const partial =
    !!usage &&
    (usage.duration.partial ||
      usage.tokens.input.partial ||
      usage.tokens.output.partial ||
      usage.costPartial);
  const estimated = usage?.costs.some((cost) => cost.estimated);
  const mixed = (usage?.costs.length ?? 0) > 1;
  const information = [
    label,
    partial ? 'Итог неполный: учтены только доступные подтверждённые данные.' : '',
    estimated
      ? 'Стоимость рассчитана Pi по тарифам модели; это не подтверждение банковского списания.'
      : '',
    usage?.costPartial ? 'Неизвестная стоимость не означает бесплатную работу.' : '',
    mixed ? 'Разные валюты показаны отдельно и не складываются.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tooltip label={information} onlyWhenTruncated={!partial && !estimated && !mixed}>
      <span className="usage-metrics" role="group" aria-label={label}>
        {includeTime && (
          <>
            <span>{usageText(usage?.duration, durationText)}</span>
            <span aria-hidden="true"> · </span>
          </>
        )}
        <ArrowUp size={12} aria-hidden="true" /> {usageText(usage?.tokens.input, tokensText)}{' '}
        <ArrowDown size={12} aria-hidden="true" /> {usageText(usage?.tokens.output, tokensText)}
        <span aria-hidden="true"> · </span>
        {costText(usage)}
      </span>
    </Tooltip>
  );
}
