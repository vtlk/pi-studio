import test from 'node:test';
import assert from 'node:assert/strict';
import {
  durationText,
  tokensText,
  moneyText,
  usageText,
  usageAccessible,
  costText,
} from '../src/renderer/features/project/model/usageFormat.ts';
import { agentUsage, emptyAgentLedger } from '../src/main/accounting/usageState.ts';

test('project metrics preserve units, rounded token thresholds, long duration and nonzero tiny spend', () => {
  assert.deepEqual([0, 999, 1000, 1700, 999950, 999950000].map(tokensText), [
    '0',
    '999',
    '1k',
    '1.7k',
    '1m',
    '1b',
  ]);
  assert.equal(durationText(1234), '00:01');
  assert.equal(durationText(3600000), '1:00:00');
  assert.equal(durationText(25 * 3600000 + 12000), '25:00:12');
  assert.equal(moneyText(0, 'USD'), '$0.00');
  assert.equal(moneyText(0.0044, 'USD'), '$0.0044');
  assert.equal(moneyText(0.0000001, 'USD'), '<$0.0001');
  assert.equal(usageText(undefined, tokensText), '…');
  assert.equal(usageText({ value: null, partial: true }, tokensText), '—');
  assert.equal(usageText({ value: 1700, partial: true }, tokensText), '1.7k*');
  const usage = agentUsage(emptyAgentLedger(false));
  assert.match(
    usageAccessible(usage),
    /0 seconds.*Input tokens: 0.*Output tokens: 0.*Cost reported by Pi/,
  );
  usage.costs.push({ value: 1, currency: 'EUR', partial: false, estimated: true });
  assert.equal(costText(usage), '—', 'Different currencies never become a fabricated sum.');
  assert.match(usageAccessible(usage), /USD; 1 EUR/);
});
