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

/** Read-only media transport; main still validates the actual path and file. */
export function outputMediaUrl(projectId: string, path: string, version = '') {
  return `studio-media://output/${encodeURIComponent(projectId)}/${path.split('/').map(encodeURIComponent).join('/')}?v=${encodeURIComponent(version)}`;
}
