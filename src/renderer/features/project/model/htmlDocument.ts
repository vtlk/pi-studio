import DOMPurify from 'dompurify';
import type { MarkdownFiles } from './markdownFiles';
import { inlineHtmlAssets } from './htmlAssets';

export const htmlScriptNonce = 'pistudio-output-preview-61c5794a';
export const htmlPreviewPolicy =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

export async function htmlDocument(
  content: string,
  files: MarkdownFiles | undefined,
  signal: AbortSignal,
  scripts = false,
) {
  const template = document.createElement('template');
  template.innerHTML = content;
  const missing = await inlineHtmlAssets(template, files, signal, scripts);
  const handlers: { id: string; event: string; code: string }[] = [];
  if (scripts)
    for (const node of template.content.querySelectorAll('*')) {
      for (const attribute of Array.from(node.attributes))
        if (/^on[a-z]+$/i.test(attribute.name)) {
          const id = node.getAttribute('data-pistudio-handler') ?? crypto.randomUUID();
          node.setAttribute('data-pistudio-handler', id);
          handlers.push({ id, event: attribute.name.slice(2), code: attribute.value });
          node.removeAttribute(attribute.name);
        }
    }
  signal.throwIfAborted();
  const clean = DOMPurify.sanitize(template.content, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: scripts ? ['style', 'script', 'form'] : ['style'],
    FORBID_TAGS: [
      ...(scripts ? [] : ['script', 'form']),
      'iframe',
      'frame',
      'frameset',
      'object',
      'embed',
      'base',
      'meta',
      'link',
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
  for (const node of clean.querySelectorAll(
    scripts ? 'input[type="file"]' : 'input,select,textarea,button',
  ))
    node.setAttribute('disabled', '');
  if (scripts)
    for (const script of clean.querySelectorAll('script'))
      script.setAttribute('nonce', htmlScriptNonce);
  template.content.replaceChildren(clean);
  const policy = scripts
    ? htmlPreviewPolicy.replace("script-src 'none'", `script-src 'nonce-${htmlScriptNonce}'`)
    : htmlPreviewPolicy;
  const bootstrap = scripts
    ? `<script nonce="${htmlScriptNonce}">for(const key of ['RTCPeerConnection','webkitRTCPeerConnection']){try{Object.defineProperty(globalThis,key,{value:undefined,writable:false,configurable:false})}catch{}}</script>`
    : '';
  const listeners = scripts
    ? `<script nonce="${htmlScriptNonce}">${handlers
        .map(
          ({ id, event, code }) =>
            `document.querySelector('[data-pistudio-handler="${id}"]')?.addEventListener(${JSON.stringify(event)},function(event){${code}\n});`,
        )
        .join('\n')
        .replace(/<\/script/gi, '<\\/script')}</script>`
    : '';
  return {
    missing,
    srcDoc: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>html{color-scheme:light}body{margin:8px;background:#fff;color:#111}</style></head><body>${bootstrap}${template.innerHTML}${listeners}</body></html>`,
  };
}
