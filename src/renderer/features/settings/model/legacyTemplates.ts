function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
/** Full content equality, including instructions/model/settings; never match only by demo ID. */
export function matchesTemplate(value: unknown, example: unknown) {
  return (
    example !== undefined && JSON.stringify(canonical(value)) === JSON.stringify(canonical(example))
  );
}
