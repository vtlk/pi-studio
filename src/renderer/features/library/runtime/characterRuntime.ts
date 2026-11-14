import type { CharacterPreviewOptions } from '../model/characterPreview';

export type CharacterDesign = { id: string } & Record<string, unknown>;
export type CharacterPose = Record<string, number>;
export interface CharacterRuntime {
  designs: Record<string, CharacterDesign>;
  rig: {
    create: (design: CharacterDesign, meta: { prefix: string; title: string }) => SVGSVGElement;
    poseAt: (
      design: CharacterDesign,
      options: CharacterPreviewOptions,
      time: number,
    ) => CharacterPose;
    renderPose: (svg: SVGSVGElement, design: CharacterDesign, pose: CharacterPose) => void;
    mixPose: (previous: CharacterPose | null, next: CharacterPose, alpha: number) => CharacterPose;
    blinkAt: (time: number, offset: number) => number;
  };
}
