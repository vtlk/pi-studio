import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { useTextareaFind } from './TextareaFind';

/** Inert current-match overlay: the textarea remains the only editable source of text. */
export function TextareaHighlight({
  field,
  result,
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  result: ReturnType<typeof useTextareaFind>['result'];
}) {
  const { text, matches, index } = result;
  const match = matches[index];
  const layer = useRef<HTMLDivElement>(null),
    mirror = useRef<HTMLDivElement>(null),
    marker = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const textarea = field.current!,
      overlay = layer.current!,
      content = mirror.current!;
    const scroll = () => {
      content.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    };
    const refresh = () => {
      const style = getComputedStyle(textarea);
      Object.assign(overlay.style, {
        left: `${textarea.offsetLeft + textarea.clientLeft}px`,
        top: `${textarea.offsetTop + textarea.clientTop}px`,
        width: `${textarea.clientWidth}px`,
        height: `${textarea.clientHeight}px`,
      });
      for (const property of [
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'font-variant',
        'line-height',
        'letter-spacing',
        'word-spacing',
        'text-indent',
        'text-align',
        'text-transform',
        'tab-size',
        'direction',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
      ])
        content.style.setProperty(property, style.getPropertyValue(property));
      content.style.whiteSpace = textarea.wrap === 'off' ? 'pre' : 'pre-wrap';
      scroll();
    };
    const show = () => {
      refresh();
      if (document.activeElement === textarea) return;
      const visibleHeight = Math.min(
        textarea.clientHeight,
        Math.max(120, innerHeight - Math.max(0, textarea.getBoundingClientRect().top)),
      );
      textarea.scrollTop = Math.max(0, marker.current!.offsetTop - visibleHeight / 2);
      if (textarea.scrollWidth > textarea.clientWidth)
        textarea.scrollLeft = Math.max(0, marker.current!.offsetLeft - textarea.clientWidth / 2);
      refresh();
    };
    show();
    const frame = requestAnimationFrame(show);
    const observer = new ResizeObserver(show);
    observer.observe(textarea);
    textarea.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', show);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      textarea.removeEventListener('scroll', scroll);
      window.removeEventListener('resize', show);
    };
  }, [field, result]);
  return (
    <div ref={layer} className="textarea-match-layer" aria-hidden="true">
      <div ref={mirror} className="textarea-match-text">
        {text.slice(0, match.start)}
        <mark ref={marker}>{text.slice(match.start, match.end)}</mark>
        {text.slice(match.end)}
        {'\u200b'}
      </div>
    </div>
  );
}
