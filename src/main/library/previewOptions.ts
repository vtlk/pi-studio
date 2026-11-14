import { rigActions, rigEmotions } from '../../shared/characterRig.ts';
import type { CharacterMotionOptions } from '../../shared/characterMotion.ts';

const object = (value: unknown, keys: string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Некорректные параметры кадра.');
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error('Неизвестный параметр кадра.');
  return value as Record<string, unknown>;
};
const number = (value: unknown, fallback: number, min: number, max: number) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Параметр кадра должен быть числом от ${min} до ${max}.`);
  return value;
};
const boolean = (value: unknown, fallback: boolean) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('Некорректный флаг кадра.');
  return value;
};
export function previewOptions(args: Record<string, unknown>) {
  const width = number(args.width, 512, 64, 2048),
    height = number(args.height, 512, 64, 2048);
  if (!Number.isInteger(width) || !Number.isInteger(height))
    throw new Error('Размеры кадра должны быть целыми.');
  const controls =
    args.character === undefined
      ? undefined
      : object(args.character, [
          'action',
          'emotion',
          'time',
          'intensity',
          'headTilt',
          'gazeX',
          'gazeY',
          'autoGaze',
          'blink',
        ]);
  if (controls?.action !== undefined && !rigActions.includes(controls.action as never))
    throw new Error('Неизвестное действие персонажа.');
  if (controls?.emotion !== undefined && !rigEmotions.includes(controls.emotion as never))
    throw new Error('Неизвестная эмоция персонажа.');
  const autoGaze = boolean(controls?.autoGaze, false);
  const character: CharacterMotionOptions = {
    action: String(controls?.action ?? 'idle'),
    emotion: String(controls?.emotion ?? 'neutral'),
    intensity: number(controls?.intensity, 1, 0, 1),
    headTilt: number(controls?.headTilt, 0, -10, 10),
    gazeX: number(controls?.gazeX, 0, -1, 1),
    gazeY: number(controls?.gazeY, 0, -1, 1),
    autoGaze,
    manualGaze: !autoGaze,
    blink: boolean(controls?.blink, false),
  };
  const camera = args.camera === undefined ? undefined : object(args.camera, ['zoom', 'x', 'y']);
  return {
    width,
    height,
    character,
    time: number(controls?.time, 0, 0, 3600),
    camera: camera
      ? {
          zoom: number(camera.zoom, 1, 1, 4),
          x: number(camera.x, 0, -16384, 16384),
          y: number(camera.y, 0, -16384, 16384),
        }
      : undefined,
  };
}
export interface PreviewFrame {
  width: number;
  height: number;
  transparent: boolean;
  camera?: { zoom: number; x: number; y: number };
}
export type PreviewRenderer = (source: string, frame: PreviewFrame) => Promise<Buffer>;
