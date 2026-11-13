export function plainText(html: string) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code: string) => {
      const value = code.startsWith('x') ? parseInt(code.slice(1), 16) : Number(code);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function attribute(attrs: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return match?.[1] ?? match?.[2] ?? '';
}
export function parseSearchResults(html: string) {
  const results: { title: string; url: string; snippet: string }[] = [];
  const anchors = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    if (!attribute(match[1], 'class').split(/\s+/).includes('result__a')) continue;
    const href = plainText(attribute(match[1], 'href'));
    try {
      const redirect = new URL(href, 'https://duckduckgo.com');
      const url = new URL(
        redirect.hostname.endsWith('duckduckgo.com') && redirect.pathname.startsWith('/l/')
          ? (redirect.searchParams.get('uddg') ?? '')
          : redirect.href,
      );
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      const after = html.slice(
        (match.index ?? 0) + match[0].length,
        (match.index ?? 0) + match[0].length + 5000,
      );
      const snippet =
        /<(?:a|div)\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(
          after,
        );
      if (!results.some((item) => item.url === url.href))
        results.push({
          title: plainText(match[2]).slice(0, 300),
          url: url.href,
          snippet: plainText(snippet?.[1] ?? '').slice(0, 800),
        });
    } catch {
      /* Non-web/ad URLs are not search results. */
    }
    if (results.length >= 8) break;
  }
  return results;
}
/** Free public search for every provider; never falls back to a paid API. */
export async function searchWeb(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 600)
    throw new Error('Поисковый запрос: 1–600 символов.');
  const query = value.trim();
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  let html: string;
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'text/html', 'User-Agent': 'PiStudio/1.0 (public web search)' },
    });
    if (!response.ok || !response.body) throw new Error('Unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 2_000_000) throw new Error('Too large');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    html = Buffer.concat(chunks).toString('utf8');
  } catch {
    throw new Error(
      'Бесплатный веб-поиск временно недоступен. Повторите позже или подключите поисковый MCP. Платный API не вызывался.',
    );
  }
  const results = parseSearchResults(html);
  if (!results.length)
    throw new Error(
      'Поиск не вернул доступных результатов или запросил проверку. Используйте штатный поиск модели либо подключённый поисковый MCP; платного переключения нет.',
    );
  return { provider: 'DuckDuckGo public HTML search', query, results };
}
