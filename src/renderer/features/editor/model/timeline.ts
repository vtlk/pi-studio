export interface DemoClip {
  id: string;
  label: string;
  src?: string;
  start: number;
  duration: number;
}
export interface DemoTrack {
  id: string;
  label: string;
  muted: boolean;
  gain: number;
  pan: number;
  clips: DemoClip[];
}
export interface DemoTimeline {
  type: 'pi-studio.prototype-timeline';
  fps: number;
  width: number;
  height: number;
  tracks: DemoTrack[];
  subtitles: string;
}
export interface EditorDocument {
  timeline: DemoTimeline;
  frame: number;
  selectedClip: string;
  revision: number;
}
export const durationFrames = (timeline: DemoTimeline) =>
  Math.max(
    1,
    ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)),
  );
export const createDocument = (timeline: DemoTimeline): EditorDocument => ({
  timeline: structuredClone(timeline),
  frame: 0,
  selectedClip: timeline.tracks[0]?.clips[0]?.id ?? '',
  revision: 1,
});
export function changeTimeline(document: EditorDocument, timeline: DemoTimeline): EditorDocument {
  return { ...document, timeline, revision: document.revision + 1 };
}
