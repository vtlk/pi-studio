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

const scripts = [
  'characters',
  'rig',
  'drinker-vector',
  'detailed-rig',
  'bezier-face',
  'garage-vector',
  'garage-rig',
  'character-shapes',
  'remaining-vectors',
  'layered-rig',
];
let loading: Promise<CharacterRuntime> | undefined;
const loaded = new Map<string, Promise<void>>();

function loadScript(name: string) {
  const existing = loaded.get(name);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}library-runtime/${name}.js`;
    script.onload = () => resolve();
    script.onerror = () => {
      loaded.delete(name);
      script.remove();
      reject(new Error('Не удалось загрузить анимационный движок библиотеки.'));
    };
    document.head.append(script);
  });
  loaded.set(name, promise);
  return promise;
}

/** Only the vetted, bundled runtime is executable; library outputs never supply scripts. */
export function loadCharacterRuntime(): Promise<CharacterRuntime> {
  loading ??= (async () => {
    for (const script of scripts) await loadScript(script);
    const source = window as unknown as {
      CharacterRig: CharacterRuntime['rig'];
      CharacterDesigns: CharacterRuntime['designs'];
    };
    if (!source.CharacterRig || !source.CharacterDesigns)
      throw new Error('Риг библиотеки недоступен.');
    return { rig: source.CharacterRig, designs: source.CharacterDesigns };
  })().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
