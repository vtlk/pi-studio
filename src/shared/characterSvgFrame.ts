import type { LibraryCharacter, SvgNode } from './characterRig.ts';
import { characterPose, blinkRigPose, type CharacterMotionOptions } from './characterMotion.ts';
import { rigPath } from './parseCharacterRig.ts';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );

/** Serialize a validated data rig at an explicit time, using the same pose channels as the player. */
export function characterSvgFrame(
  source: Pick<LibraryCharacter, 'svg' | 'rig'>,
  options: CharacterMotionOptions,
  time: number,
) {
  const pose = blinkRigPose(source.rig, characterPose(source.rig, options, time));
  const transforms = new Map(source.rig.transforms.map((item) => [item.part, item]));
  const paths = new Map(source.rig.paths.map((item) => [item.part, item.template]));
  const node = (item: SvgNode | string): string => {
    if (typeof item === 'string') return escape(item);
    const part = item.attributes['data-part'];
    const attrs = { ...item.attributes };
    if (paths.has(part)) attrs.d = rigPath(paths.get(part)!, pose);
    const content = `<${item.tag} ${Object.entries(attrs)
      .map(([key, value]) => `${key}="${escape(value)}"`)
      .join(' ')}>${item.children.map(node).join('')}</${item.tag}>`;
    const binding = transforms.get(part);
    if (!binding) return content;
    const value = (key: 'x' | 'y' | 'rotate' | 'scaleX' | 'scaleY', fallback: number) =>
      binding[key] ? pose[binding[key]!] : fallback;
    const [x, y] = binding.pivot;
    return `<g transform="translate(${value('x', 0)} ${value('y', 0)}) rotate(${value('rotate', 0)} ${x} ${y}) translate(${x} ${y}) scale(${value('scaleX', 1)} ${value('scaleY', 1)}) translate(${-x} ${-y})">${content}</g>`;
  };
  return node(source.svg);
}
