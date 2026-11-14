/** Stable JSON for fingerprints: sort object keys, preserve array order and every value. */
export function canonicalJson(value: unknown): string | undefined {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => [key, canonical(value)]),
      );
    return item;
  };
  return JSON.stringify(canonical(value));
}
