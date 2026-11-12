export const characterActions = [
  { value: 'idle', label: 'Спокойно' },
  { value: 'walk', label: 'Ходить' },
  { value: 'run', label: 'Бежать' },
  { value: 'wave', label: 'Махать' },
  { value: 'gesture', label: 'Двигать руками' },
  { value: 'think', label: 'Думать' },
] as const;

export const characterEmotions = [
  { value: 'neutral', label: 'Безразличие' },
  { value: 'smile', label: 'Улыбка' },
  { value: 'smirk', label: 'Ухмылка' },
  { value: 'fear', label: 'Страх' },
  { value: 'sad', label: 'Грусть' },
  { value: 'angry', label: 'Злость' },
  { value: 'surprised', label: 'Удивление' },
  { value: 'thinking', label: 'Задумчивость' },
] as const;

export interface CharacterPreviewOptions {
  action: string;
  emotion: string;
  intensity: number;
  headTilt: number;
  gazeX: number;
  gazeY: number;
  autoGaze: boolean;
  manualGaze: boolean;
  talking: boolean;
  blink: boolean;
  speed: number;
}

export const defaultCharacterPreview: CharacterPreviewOptions = {
  action: 'idle',
  emotion: 'smirk',
  intensity: 1,
  headTilt: 0,
  gazeX: 0,
  gazeY: 0,
  autoGaze: true,
  manualGaze: false,
  talking: false,
  blink: true,
  speed: 1,
};
