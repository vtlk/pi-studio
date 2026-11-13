import { SaxesParser } from 'saxes';
import type { SvgNode } from './characterRig.ts';

const tags = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'line',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'title',
  'desc',
]);
const attributes = new Set([
  'xmlns',
  'xmlns:xlink',
  'id',
  'data-part',
  'viewBox',
  'width',
  'height',
  'preserveAspectRatio',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'transform',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'mask',
  'maskUnits',
  'maskContentUnits',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'href',
  'xlink:href',
  'fx',
  'fy',
]);
const identifier = /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/;
/** Strict XML plus a small inert SVG vocabulary, also used before creating inline DOM. */
export function parseCharacterSvg(text: string) {
  if (typeof text !== 'string' || text.length > 2 * 1024 * 1024)
    throw new Error('SVG персонажа превышает 2 МБ.');
  const parser = new SaxesParser({ xmlns: true });
  const stack: SvgNode[] = [];
  const parts = new Map<string, SvgNode>();
  const ids = new Set<string>();
  const references: string[] = [];
  let root: SvgNode | undefined,
    count = 0;
  parser.on('doctype', () => {
    throw new Error('DOCTYPE в SVG персонажа запрещён.');
  });
  parser.on('processinginstruction', () => {
    throw new Error('Инструкции XML в SVG персонажа запрещены.');
  });
  parser.on('opentag', (tag) => {
    if (
      !tags.has(tag.name) ||
      tag.uri !== 'http://www.w3.org/2000/svg' ||
      stack.length > 64 ||
      ++count > 10000
    )
      throw new Error('SVG персонажа содержит неподдерживаемый элемент или слишком сложен.');
    if ((!root && tag.name !== 'svg') || (root && tag.name === 'svg'))
      throw new Error('Нужен один корневой SVG.');
    const node: SvgNode = { tag: tag.name, attributes: {}, children: [] };
    for (const attribute of Object.values(tag.attributes)) {
      const { name, value } = attribute;
      if (
        !attributes.has(name) ||
        (/[<>\\]|javascript\s*:|(?:https?|data|file)\s*:/i.test(value) &&
          name !== 'xmlns' &&
          name !== 'xmlns:xlink')
      )
        throw new Error(`Недопустимый SVG-атрибут ${name}.`);
      if (
        (name === 'xmlns' && value !== 'http://www.w3.org/2000/svg') ||
        (name === 'xmlns:xlink' && value !== 'http://www.w3.org/1999/xlink')
      )
        throw new Error('Неизвестное пространство имён SVG.');
      if (name === 'id' || name === 'data-part') {
        if (!identifier.test(value)) throw new Error('Некорректный ID/data-part SVG.');
        const exists = name === 'id' ? ids.has(value) : parts.has(value);
        if (exists) throw new Error('Повторяющийся ID/data-part SVG.');
        if (name === 'id') ids.add(value);
        else parts.set(value, node);
      }
      if (name === 'href' || name === 'xlink:href') {
        if (!value.startsWith('#') || !identifier.test(value.slice(1)))
          throw new Error('В SVG допустимы только локальные ссылки.');
        references.push(value.slice(1));
      }
      if (/url\s*\(/i.test(value)) {
        if (!/^url\(#[a-zA-Z][a-zA-Z0-9_-]{0,99}\)$/.test(value))
          throw new Error('Внешняя ссылка SVG запрещена.');
        references.push(value.slice(5, -1));
      }
      node.attributes[name] = value;
    }
    if (stack.length) stack.at(-1)!.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.on('text', (text) => {
    if (!text.trim()) return;
    const node = stack.at(-1);
    if (!node || !['title', 'desc'].includes(node.tag))
      throw new Error('Текст допустим только в title/desc SVG.');
    node.children.push(text);
  });
  parser.on('cdata', () => {
    throw new Error('CDATA в SVG персонажа не поддерживается.');
  });
  parser.write(text).close();
  if (!root || !root.attributes.viewBox) throw new Error('SVG персонажа должен иметь viewBox.');
  const viewBox = root.attributes.viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    viewBox.length !== 4 ||
    viewBox.some((n) => !Number.isFinite(n) || Math.abs(n) > 100000) ||
    viewBox[2] <= 0 ||
    viewBox[3] <= 0
  )
    throw new Error('Некорректный viewBox персонажа.');
  if (references.some((id) => !ids.has(id))) throw new Error('SVG ссылается на отсутствующий ID.');
  return { svg: root, parts };
}
