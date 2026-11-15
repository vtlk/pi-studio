import { createHash } from 'node:crypto';

export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const safeFinding = (finding, disposition = 'needs-review') => ({
  rule: finding.RuleID,
  file: finding.File,
  line: finding.StartLine,
  ...(finding.Commit ? { commit: finding.Commit } : {}),
  disposition,
});

/** Never treats a high entropy string as safe merely because it has 64 hex characters. */
export async function classifyFinding(
  finding,
  read,
  canonicalDigests,
  verifyHistorical = async () => undefined,
) {
  let disposition = 'needs-review';
  if (finding.RuleID === 'generic-api-key') {
    const data = await read(finding.File, finding.Commit);
    const line = data?.toString('utf8').split('\n')[finding.StartLine - 1] ?? '';
    const pairs = [...line.matchAll(/["']([^"'\n]+)["']\s*:\s*["']([^"'\n]*)["']/g)];
    const pair = pairs.length === 1 && /^[a-f0-9]{64}$/.test(pairs[0][2]) ? pairs[0] : undefined;
    if (pair && Number.isInteger(finding.StartColumn) && Number.isInteger(finding.EndColumn)) {
      const first = Buffer.byteLength(line.slice(0, pair.index), 'utf8') + 1;
      const last = first + Buffer.byteLength(pair[0], 'utf8') - 1;
      const valueStart =
        first + Buffer.byteLength(pair[0].slice(0, pair[0].lastIndexOf(pair[2])), 'utf8');
      if (
        finding.StartColumn < first - 2 ||
        finding.StartColumn > valueStart ||
        Math.abs(last - finding.EndColumn) > 2
      )
        return safeFinding(finding);
    }
    if (pair && canonicalDigests.has(pair[2]) && pair[1] === 'images-api')
      disposition = 'verified-canonical-legacy-digest';
    else if (
      pair &&
      /^(src|scripts|tests|bundled)\//.test(pair[1]) &&
      !pair[1].split('/').includes('..')
    ) {
      const referenced = await read(pair[1], finding.Commit);
      if (referenced && digest(referenced) === pair[2]) disposition = 'verified-source-file-sha256';
      else if (await verifyHistorical(pair[1], pair[2]))
        disposition = 'verified-historical-source-file-sha256';
    }
  }
  return safeFinding(finding, disposition);
}

export function privacyLines(text) {
  const pattern =
    /\/Users\/[a-zA-Z0-9._-]{1,60}\/|[a-z]:[\\/]+Users[\\/]+[a-zA-Z0-9._ -]{1,60}[\\/]/i;
  return text.split('\n').flatMap((line, index) => (pattern.test(line) ? [index + 1] : []));
}
