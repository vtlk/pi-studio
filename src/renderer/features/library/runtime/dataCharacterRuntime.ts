import type { LibraryCharacter, SvgNode } from '../../../../shared/characterRig';
import {
  characterPose,
  mixRigPose,
  rigBlink,
  blinkRigPose,
} from '../../../../shared/characterMotion';
import { rigPath } from '../../../../shared/parseCharacterRig';
import type { CharacterRuntime } from './characterRuntime';

const ns = 'http://www.w3.org/2000/svg';
export function dataCharacterRuntime(source: LibraryCharacter, id: string): CharacterRuntime {
  const { rig } = source;
  const instances = new WeakMap<
    SVGSVGElement,
    { parts: Map<string, SVGElement>; transforms: Map<string, SVGGElement> }
  >();
  const runtime: CharacterRuntime = {
    designs: { [id]: { id } },
    rig: {
      create(_design, meta) {
        const parts = new Map<string, SVGElement>(),
          transforms = new Map<string, SVGGElement>();
        const build = (node: SvgNode): SVGElement => {
          const element = document.createElementNS(ns, node.tag);
          for (const [key, value] of Object.entries(node.attributes)) {
            const scoped =
              key === 'id'
                ? `${meta.prefix}-${value}`
                : key === 'href' || key === 'xlink:href'
                  ? `#${meta.prefix}-${value.slice(1)}`
                  : value.replace(/url\(#([a-zA-Z][a-zA-Z0-9_-]*)\)/g, `url(#${meta.prefix}-$1)`);
            if (key === 'xlink:href')
              element.setAttributeNS('http://www.w3.org/1999/xlink', key, scoped);
            else element.setAttribute(key, scoped);
          }
          if (node.attributes['data-part']) parts.set(node.attributes['data-part'], element);
          for (const child of node.children)
            element.append(
              typeof child === 'string' ? document.createTextNode(child) : build(child),
            );
          return element;
        };
        const svg = build(source.svg) as SVGSVGElement;
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', meta.title);
        svg.setAttribute('data-character-engine', rig.engine);
        for (const binding of rig.transforms) {
          const part = parts.get(binding.part)!;
          const wrapper = document.createElementNS(ns, 'g');
          wrapper.setAttribute('data-rig-transform', binding.part);
          part.replaceWith(wrapper);
          wrapper.append(part);
          transforms.set(binding.part, wrapper);
        }
        instances.set(svg, { parts, transforms });
        return svg;
      },
      poseAt: (_design, options, time) => characterPose(rig, options, time),
      mixPose: mixRigPose,
      blinkAt: rigBlink,
      renderPose(svg, _design, pose) {
        const instance = instances.get(svg);
        if (!instance) return;
        const drawn = blinkRigPose(rig, pose);
        for (const binding of rig.transforms) {
          const value = (key: 'x' | 'y' | 'rotate' | 'scaleX' | 'scaleY', fallback: number) =>
            binding[key] ? drawn[binding[key]!] : fallback;
          const [x, y] = binding.pivot;
          instance.transforms
            .get(binding.part)!
            .setAttribute(
              'transform',
              `translate(${value('x', 0)} ${value('y', 0)}) rotate(${value('rotate', 0)} ${x} ${y}) translate(${x} ${y}) scale(${value('scaleX', 1)} ${value('scaleY', 1)}) translate(${-x} ${-y})`,
            );
        }
        for (const binding of rig.paths)
          instance.parts.get(binding.part)!.setAttribute('d', rigPath(binding.template, drawn));
      },
    },
  };
  return runtime;
}
