/** Resolve references within a single output directory, never across agents. */
export function resolveOutputReference(parent: string[], reference: string): string | null {
  if (
    !reference ||
    reference.startsWith('/') ||
    /[:\\]/.test(reference) ||
    reference.includes('\0')
  )
    return null;
  const parts = [...parent];
  for (const part of reference.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}
