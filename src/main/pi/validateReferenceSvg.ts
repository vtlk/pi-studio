/** SVG is an inert image. Scripts, external dependencies and animation are not decoded as reference inputs. */
export function validateStaticSvg(text: string) {
  if (
    !/<svg[\s>]/i.test(text) ||
    /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<\s*(script|foreignObject|animate\w*|set|audio|video|iframe|object|embed)\b|\son\w+\s*=|@import/i.test(
      text,
    )
  )
    throw new Error(
      'SVG содержит неподдерживаемые активные элементы. Используйте статичный SVG без скриптов и внешних ссылок.',
    );
  for (const match of text.matchAll(
    /(?:\b(?:xlink:)?href\s*=\s*["']([^"']*)["']|url\s*\(\s*["']?([^)'"\s]+))/gi,
  )) {
    if (!(match[1] ?? match[2]).startsWith('#'))
      throw new Error('SVG не должен ссылаться на внешние материалы.');
  }
  if (/javascript\s*:|&#|\\[0-9a-f]{1,6}/i.test(text))
    throw new Error('Закодированные активные ссылки в SVG не поддерживаются.');
}
