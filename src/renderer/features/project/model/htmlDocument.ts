import DOMPurify from 'dompurify';
import type { MarkdownFiles } from './markdownFiles';
import { inlineHtmlAssets } from './htmlAssets';

export const htmlPreviewPolicy =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

export async function htmlDocument(
  content: string,
  files: MarkdownFiles | undefined,
  signal: AbortSignal,
) {
  const template = document.createElement('template');
  template.innerHTML = content;
  const missing = await inlineHtmlAssets(template, files, signal);
  signal.throwIfAborted();
  const clean = DOMPurify.sanitize(template.content, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: [
      'script',
      'iframe',
      'frame',
      'frameset',
      'object',
      'embed',
      'base',
      'meta',
      'link',
      'form',
      'foreignobject',
      'animate',
      'animatemotion',
      'animatetransform',
      'set',
      'discard',
      'audio',
      'video',
      'source',
      'track',
    ],
    FORBID_ATTR: [
      'href',
      'xlink:href',
      'srcset',
      'action',
      'formaction',
      'target',
      'ping',
      'download',
      'srcdoc',
      'autofocus',
      'contenteditable',
      'is',
      'nonce',
    ],
  });
  for (const node of clean.querySelectorAll('[src]')) {
    if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml)(;|,)/i.test(node.getAttribute('src') ?? ''))
      node.removeAttribute('src');
  }
  for (const node of clean.querySelectorAll('input,select,textarea,button'))
    node.setAttribute('disabled', '');
  template.content.replaceChildren(clean);
  return {
    missing,
    srcDoc: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${htmlPreviewPolicy}"><meta name="referrer" content="no-referrer"><style>html{color-scheme:light}body{margin:8px;background:#fff;color:#111}</style></head><body>${template.innerHTML}</body></html>`,
  };
}
