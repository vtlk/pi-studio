import type { VideoItem } from '../../../../shared/video';

/** Display overlapping clips on separate lanes without changing semantic playback order. */
export function timelineLanes(items: VideoItem[]) {
  const ends: number[] = [];
  const lanes = new Map<string, number>();
  for (const item of [...items].sort((a, b) => a.from - b.from)) {
    let lane = ends.findIndex((end) => end <= item.from);
    if (lane === -1) lane = ends.length;
    ends[lane] = item.from + item.duration;
    lanes.set(item.id, lane);
  }
  return { count: Math.max(1, ends.length), lanes };
}
