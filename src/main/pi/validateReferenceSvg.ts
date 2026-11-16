import { t } from '../../shared/i18n/index.ts';
/** SVG is an inert image. Scripts, external dependencies and animation are not decoded as reference inputs. */
export function validateStaticSvg(text: string) {
  if (
    !/<svg[\s>]/i.test(text) ||
    /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<\s*(script|foreignObject|animate\w*|set|audio|video|iframe|object|embed)\b|\son\w+\s*=|@import/i.test(
      text,
    )
  )
    throw new Error(t('error.validateReferenceSvg.theSvgContainsUnsupportedActive'));
  for (const match of text.matchAll(
    /(?:\b(?:xlink:)?href\s*=\s*["']([^"']*)["']|url\s*\(\s*["']?([^)'"\s]+))/gi,
  )) {
    if (!(match[1] ?? match[2]).startsWith('#'))
      throw new Error(t('error.validateReferenceSvg.theSvgMustNotReference'));
  }
  if (/javascript\s*:|&#|\\[0-9a-f]{1,6}/i.test(text))
    throw new Error(t('error.validateReferenceSvg.encodedActiveLinksInSvg'));
}
