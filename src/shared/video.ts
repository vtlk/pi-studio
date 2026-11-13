/** Data-only montage contract. The viewer is trusted application code. */
export interface VideoManifest {
  type: 'pi-studio.video-project';
  schemaVersion: 1;
  editor: 'remotion-player';
  name: string;
  scope: 'scene' | 'film';
  state: string;
}
export interface VideoAsset {
  id: string;
  type: 'image' | 'video' | 'audio';
  src: string;
}
export interface VideoTransform {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
}
export interface MotionKeyframe extends VideoTransform {
  frame: number;
  ease?: 'linear' | 'hold' | 'smooth';
}
export interface VideoItem extends VideoTransform {
  id: string;
  name: string;
  from: number;
  duration: number;
  assetId?: string;
  text?: string;
  sourceFrom?: number;
  width?: number;
  height?: number;
  fit?: 'contain' | 'cover';
  volume?: number;
  pan?: number;
  fontSize?: number;
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right';
  keyframes?: MotionKeyframe[];
}
export interface VideoTrack {
  id: string;
  name: string;
  type: 'visual' | 'audio' | 'subtitles';
  items: VideoItem[];
}
export interface VideoTimeline {
  type: 'pi-studio.timeline';
  schemaVersion: 1;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  background: string;
  assets: VideoAsset[];
  tracks: VideoTrack[];
}
export interface ResolvedVideoAsset extends VideoAsset {
  projectPath: string;
  sha256: string;
  size: number;
  url: string;
}
export interface ValidatedVideoProject {
  manifest: VideoManifest;
  timeline: VideoTimeline;
  manifestPath: string;
  revision: string;
  assets: ResolvedVideoAsset[];
}
export type VideoProjectInspection =
  { ok: true; document: ValidatedVideoProject } | { ok: false; error: string };
