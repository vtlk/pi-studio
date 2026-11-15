import { literalMatches } from '@/shared/ui/literalSearch';

const blocks = 'p,h1,h2,h3,h4,h5,h6,pre,li,dt,dd,td,th,blockquote';

/** Search the rendered document, preserving inline markup and paragraph boundaries. */
export function previewRanges(root: HTMLElement, query: string): Range[] {
  if (!query) return [];
  const nodes: { node: Text; start: number; end: number }[] = [];
  const parts: string[] = [];
  let length = 0;
  let previous: Element | null = null;
  const separator = () => {
    parts.push('\n');
    length++;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof HTMLBRElement) {
      separator();
      continue;
    }
    if (!(node instanceof Text) || !node.data) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest('[aria-hidden="true"],script,style,[data-find-ignore]')) continue;
    const block = parent.closest(blocks) ?? root;
    if (length && block !== previous) separator();
    previous = block;
    nodes.push({ node, start: length, end: length + node.length });
    parts.push(node.data);
    length += node.length;
  }
  if (!nodes.length) return [];
  const point = (offset: number, end: boolean) => {
    let low = 0,
      high = nodes.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (end ? nodes[mid].end < offset : nodes[mid].end <= offset) low = mid + 1;
      else high = mid;
    }
    const found = nodes[low];
    return {
      node: found.node,
      offset: Math.max(0, Math.min(found.node.length, offset - found.start)),
    };
  };
  return literalMatches(parts.join(''), query).map((match) => {
    const start = point(match.start, false),
      end = point(match.end, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  });
}

/** Move this column only; never scroll the project/agent/file lists or move selection. */
export function revealPreviewRange(container: HTMLElement, range: Range) {
  const rect = range.getClientRects()[0];
  if (!rect) return;
  const bounds = container.getBoundingClientRect();
  if (rect.top < bounds.top + 12) container.scrollTop += rect.top - bounds.top - 12;
  else if (rect.bottom > bounds.bottom - 12)
    container.scrollTop += rect.bottom - bounds.bottom + 12;
  if (rect.left < bounds.left + 12) container.scrollLeft += rect.left - bounds.left - 12;
  else if (rect.right > bounds.right - 12) container.scrollLeft += rect.right - bounds.right + 12;
}
