import type { VideoItem, VideoTransform } from './video.ts';

export interface FrameTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}
/** Sparse keyframes interpolate each channel independently; values hold at both ends. */
export function evaluateVideoTransform(item: VideoItem, localFrame: number): FrameTransform {
  const base: FrameTransform = {
    x: item.x ?? 0,
    y: item.y ?? 0,
    scale: item.scale ?? 1,
    rotation: item.rotation ?? 0,
    opacity: item.opacity ?? 1,
  };
  for (const property of Object.keys(base) as (keyof VideoTransform)[]) {
    const keys = (item.keyframes ?? []).filter((key) => key[property] !== undefined);
    let before = { frame: 0, value: base[property], ease: 'linear' };
    for (const key of keys) {
      const value = key[property]!;
      if (key.frame <= localFrame) before = { frame: key.frame, value, ease: key.ease ?? 'linear' };
      else {
        let ratio = Math.max(0, (localFrame - before.frame) / (key.frame - before.frame));
        if (before.ease === 'hold') ratio = 0;
        else if (before.ease === 'smooth') ratio = ratio * ratio * (3 - 2 * ratio);
        base[property] = before.value + (value - before.value) * ratio;
        break;
      }
      base[property] = before.value;
    }
  }
  return base;
}
export function activeVideoItems(items: VideoItem[], frame: number) {
  return items.filter((item) => item.from <= frame && frame < item.from + item.duration);
}
