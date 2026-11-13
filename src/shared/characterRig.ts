export const rigActions = ['idle', 'walk', 'run', 'wave', 'gesture', 'think'] as const;
export const rigEmotions = [
  'neutral',
  'smile',
  'smirk',
  'fear',
  'sad',
  'angry',
  'surprised',
  'thinking',
] as const;
export const rigRoles = [
  'body',
  'head',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
  'leftPupil',
  'rightPupil',
  'leftLid',
  'rightLid',
  'mouth',
  'leftBrow',
  'rightBrow',
] as const;
export type RigAction = (typeof rigActions)[number];
export type RigEmotion = (typeof rigEmotions)[number];
export type RigPose = Record<string, number>;
export interface RigTransform {
  part: string;
  pivot: [number, number];
  x?: string;
  y?: string;
  rotate?: string;
  scaleX?: string;
  scaleY?: string;
}
export interface CharacterRig {
  schemaVersion: 1;
  engine: 'pistudio-character-1';
  parts: Record<(typeof rigRoles)[number], string>;
  defaults: RigPose;
  transforms: RigTransform[];
  paths: { part: string; template: string }[];
  actions: Record<RigAction, { duration: number; tracks: Record<string, [number, number][]> }>;
  emotions: Record<RigEmotion, RigPose>;
  controls: {
    headTilt: string;
    gazeX: { channel: string; range: number };
    gazeY: { channel: string; range: number };
    blink: { left: RigPose; right: RigPose };
  };
}
export interface SvgNode {
  tag: string;
  attributes: Record<string, string>;
  children: (SvgNode | string)[];
}
export interface LibraryCharacter {
  svg: SvgNode;
  rig: CharacterRig;
  revision: string;
}
