import { markdownFile, type MarkdownFiles } from './markdownFiles';
import { outputMediaUrl } from '../../../../shared/outputPaths';

/** Inert template only: never insert the original document into the application DOM. */
export async function inlineHtmlAssets(
  template: HTMLTemplateElement,
  context: MarkdownFiles | undefined,
  signal: AbortSignal,
) {
  let missing = false,
    remaining = 8 * 1024 * 1024,
    count = 0;
  const lookup = (reference: string) => context && markdownFile(context, reference);
  for (const link of template.content.querySelectorAll('link[rel~="stylesheet"]')) {
    signal.throwIfAborted();
    const file = lookup(link.getAttribute('href') ?? '');
    if (!file || !/\.css$/i.test(file.name) || (file.size ?? 0) > 1_000_000 || ++count > 16) {
      missing = true;
      continue;
    }
    try {
      const loaded =
        window.studio && context && file.diskPath
          ? await window.studio.readOutput({ projectId: context.projectId, path: file.diskPath })
          : file;
      signal.throwIfAborted();
      if (typeof loaded.content !== 'string' || loaded.content.length > 1_000_000) throw Error();
      const style = document.createElement('style');
      style.textContent = loaded.content.replace(/</g, String.raw`\3c `);
      link.replaceWith(style);
    } catch {
      signal.throwIfAborted();
      missing = true;
    }
  }
  for (const image of template.content.querySelectorAll('img[src]')) {
    signal.throwIfAborted();
    const reference = image.getAttribute('src') ?? '';
    if (reference.startsWith('data:image/')) continue;
    const file = lookup(reference);
    image.removeAttribute('src');
    if (
      !context ||
      !file?.diskPath ||
      file.format !== 'image' ||
      (file.size ?? 0) > remaining ||
      ++count > 16
    ) {
      missing = true;
      continue;
    }
    try {
      const response = await fetch(
        outputMediaUrl(context.projectId, file.diskPath, file.fingerprint),
        { signal },
      );
      const type = response.headers.get('content-type')?.split(';')[0];
      if (
        !response.ok ||
        !type ||
        !/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(type) ||
        !response.body
      )
        throw Error();
      const reader = response.body.getReader(),
        parts: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > remaining) throw Error();
          parts.push(part.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      remaining -= size;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      image.setAttribute('src', `data:${type};base64,${btoa(binary)}`);
    } catch {
      signal.throwIfAborted();
      missing = true;
    }
  }
  return missing;
}
