import type {
  MotionKeyframe,
  VideoItem,
  VideoManifest,
  VideoTimeline,
} from '../../shared/video.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Ожидается объект JSON.');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Неизвестное поле монтажа: ${key}`);
}
function text(value: unknown, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
    throw new Error('Некорректная строка монтажа.');
  return value;
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(`Ожидается число от ${min} до ${max}${integer ? ' (целое)' : ''}.`);
  return value;
}
function choice<const T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error(`Ожидается: ${choices.join(', ')}.`);
  return value as T;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`Ожидается массив, максимум ${max} элементов.`);
  return value;
}
function color(value: unknown) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value))
    throw new Error('Цвет должен иметь формат #RRGGBB или #RRGGBBAA.');
  return value;
}
const transforms = {
  x: [-15360, 15360],
  y: [-15360, 15360],
  scale: [0.001, 100],
  rotation: [-36000, 36000],
  opacity: [0, 1],
} as const;
function transform(value: Record<string, unknown>) {
  const result: Partial<Record<keyof typeof transforms, number>> = {};
  for (const key of Object.keys(transforms) as (keyof typeof transforms)[]) {
    if (value[key] !== undefined)
      result[key] = number(value[key], transforms[key][0], transforms[key][1]);
  }
  return result;
}
export function parseVideoManifest(value: unknown): VideoManifest {
  const item = object(value);
  fields(item, ['type', 'schemaVersion', 'editor', 'name', 'scope', 'state']);
  if (
    item.type !== 'pi-studio.video-project' ||
    item.schemaVersion !== 1 ||
    item.editor !== 'remotion-player'
  )
    throw new Error('Неподдерживаемый формат монтажа. Требуется remotion-player, версия 1.');
  return {
    type: item.type,
    schemaVersion: 1,
    editor: item.editor,
    name: text(item.name),
    scope: choice(item.scope, ['scene', 'film']),
    state: text(item.state, 2000),
  };
}
export function parseVideoTimeline(value: unknown): VideoTimeline {
  const data = object(value);
  fields(data, [
    'type',
    'schemaVersion',
    'width',
    'height',
    'fps',
    'durationInFrames',
    'background',
    'assets',
    'tracks',
  ]);
  if (data.type !== 'pi-studio.timeline' || data.schemaVersion !== 1)
    throw new Error('Неподдерживаемая версия таймлайна.');
  const width = number(data.width, 2, 3840, true),
    height = number(data.height, 2, 3840, true);
  if (width % 2 || height % 2) throw new Error('Размеры видео должны быть чётными.');
  const fps = number(data.fps, 1, 60, true),
    durationInFrames = number(data.durationInFrames, 1, 36000, true);
  if (durationInFrames / fps > 600) throw new Error('Длительность V1 — не более 10 минут.');
  const ids = new Set<string>();
  const id = (value: unknown) => {
    const result = text(value, 200);
    if (ids.has(result)) throw new Error(`Повторяется ID: ${result}`);
    ids.add(result);
    return result;
  };
  const assets = list(data.assets, 1000).map((value) => {
    const asset = object(value);
    fields(asset, ['id', 'type', 'src']);
    return {
      id: id(asset.id),
      type: choice(asset.type, ['image', 'video', 'audio']),
      src: text(asset.src, 2000),
    };
  });
  let totalItems = 0;
  const tracks = list(data.tracks, 128).map((value) => {
    const track = object(value);
    fields(track, ['id', 'name', 'type', 'items']);
    const trackId = id(track.id),
      type = choice(track.type, ['visual', 'audio', 'subtitles']);
    const items = list(track.items, 5000).map((value): VideoItem => {
      if (++totalItems > 5000) throw new Error('Слишком много клипов (максимум 5000).');
      const item = object(value);
      fields(item, [
        'id',
        'name',
        'from',
        'duration',
        'assetId',
        'text',
        'sourceFrom',
        'width',
        'height',
        'volume',
        'pan',
        'fontSize',
        'color',
        'background',
        'fit',
        'align',
        'keyframes',
        ...Object.keys(transforms),
      ]);
      const from = number(item.from, 0, durationInFrames - 1, true),
        duration = number(item.duration, 1, durationInFrames - from, true);
      const result: VideoItem = {
        id: id(item.id),
        name: text(item.name),
        from,
        duration,
        ...transform(item),
      };
      if (type === 'subtitles') result.text = text(item.text, 10000);
      else {
        result.assetId = text(item.assetId, 200);
        const asset = assets.find((asset) => asset.id === result.assetId);
        if (!asset || (type === 'audio' ? asset.type !== 'audio' : asset.type === 'audio'))
          throw new Error(`Несовместимый или отсутствующий материал: ${result.assetId}`);
      }
      for (const [key, min, max] of [
        ['sourceFrom', 0, 216000],
        ['width', 1, 15360],
        ['height', 1, 15360],
        ['volume', 0, 4],
        ['pan', -1, 1],
        ['fontSize', 1, 500],
      ] as const) {
        if (item[key] !== undefined)
          result[key] = number(item[key], min, max, key === 'sourceFrom');
      }
      if (item.fit !== undefined) result.fit = choice(item.fit, ['contain', 'cover']);
      if (item.align !== undefined) result.align = choice(item.align, ['left', 'center', 'right']);
      if (item.color !== undefined) result.color = color(item.color);
      if (item.background !== undefined) result.background = color(item.background);
      if (item.keyframes !== undefined) {
        let previous = -1;
        result.keyframes = list(item.keyframes, 1000).map((value): MotionKeyframe => {
          const key = object(value),
            frame = number(key.frame, 0, duration - 1, true);
          fields(key, ['frame', 'ease', ...Object.keys(transforms)]);
          if (frame <= previous)
            throw new Error('Ключевые кадры должны идти по возрастанию без повторов.');
          previous = frame;
          return {
            frame,
            ...transform(key),
            ...(key.ease === undefined
              ? {}
              : { ease: choice(key.ease, ['linear', 'hold', 'smooth']) }),
          };
        });
      }
      return result;
    });
    return { id: trackId, name: text(track.name), type, items };
  });
  return {
    type: 'pi-studio.timeline',
    schemaVersion: 1,
    width,
    height,
    fps,
    durationInFrames,
    background: color(data.background ?? '#000000'),
    assets,
    tracks,
  };
}
