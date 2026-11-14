// Forward a small category only; never send provider messages, headers or tokens to Studio.
export function classifyProviderFailure(value) {
  const text = typeof value === 'string' ? value.slice(0, 20000).toLowerCase() : '';
  if (/usage limit|usage_limit|insufficient_quota|quota.{0,30}(exceed|reach)/.test(text))
    return 'usage_limit';
  if (/rate.?limit|too many requests|\b429\b/.test(text)) return 'rate_limit';
  if (/unauthoriz|authentication|invalid.{0,20}api.?key|\b401\b/.test(text))
    return 'authentication';
  if (/network|fetch failed|econn|timed? ?out|connection.{0,20}(reset|refused)/.test(text))
    return 'network';
  return 'provider';
}
