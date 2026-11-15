import { ArrowDown, ArrowUp } from 'lucide-react';
import type { AgentUsage } from '../../../../shared/projectUsage';
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
  return (
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
  );
}
