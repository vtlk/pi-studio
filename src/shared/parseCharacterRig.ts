import {
  rigActions,
  rigEmotions,
  rigRoles,
  type CharacterRig,
  type RigPose,
  type RigTransform,
  type SvgNode,
} from './characterRig.ts';

const name = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(value) ||
    ['constructor', 'prototype', '__proto__', 'blinkL', 'blinkR'].includes(value)
  )
    throw new Error('Недопустимое имя канала/части рига.');
  return value;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Ожидался объект rig.json.');
  return value as Record<string, unknown>;
};
const number = (value: unknown, limit = 100000): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit)
    throw new Error('Некорректное число rig.json.');
  return value;
};
const list = (value: unknown, limit: number): unknown[] => {
  if (!Array.isArray(value) || !value.length || value.length > limit)
    throw new Error('Некорректный список rig.json.');
  return value;
};
export function templateChannels(template: string) {
  return [...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g)].map((match) => match[1]);
}
export function rigPath(template: string, pose: RigPose) {
  return template.replace(
    /\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g,
    (_match, key: string) => ` ${Math.round(pose[key] * 10000) / 10000} `,
  );
}
function checkPath(value: unknown, defaults: RigPose) {
  if (typeof value !== 'string' || value.length > 8000)
    throw new Error('Некорректный шаблон кривой рига.');
  const channels = templateChannels(value);
  if (!channels.length || channels.some((key) => !Object.hasOwn(defaults, key)))
    throw new Error('Кривая использует неизвестный канал.');
  const path = rigPath(value, defaults);
  const tokens =
    path.match(/[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  if (
    path.replace(/[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[\s,]/g, '') ||
    !/^m$/i.test(tokens[0] ?? '')
  )
    throw new Error('Кривые рига используют M/L/H/V/C/S/Q/T/Z и числовые каналы.');
  const arity: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, z: 0 };
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++].toLowerCase(),
      count = arity[command];
    if (count === undefined) throw new Error('Некорректная команда кривой рига.');
    let n = 0;
    while (i < tokens.length && !/^[a-z]$/i.test(tokens[i])) {
      number(Number(tokens[i++]));
      n++;
    }
    if (count === 0 ? n !== 0 : n === 0 || n % count !== 0)
      throw new Error('Некорректное число координат кривой рига.');
  }
  return value;
}
export function parseCharacterRig(value: unknown, svgParts: Map<string, SvgNode>): CharacterRig {
  const data = object(value);
  if (data.schemaVersion !== 1 || data.engine !== 'pistudio-character-1')
    throw new Error('Несовместимая версия анимационного рига.');
  const rawDefaults = object(data.defaults);
  if (!Object.keys(rawDefaults).length || Object.keys(rawDefaults).length > 512)
    throw new Error('Риг поддерживает 1–512 каналов.');
  const defaults: RigPose = Object.fromEntries(
    Object.entries(rawDefaults).map(([key, value]) => [name(key), number(value)]),
  );
  const channel = (value: unknown) => {
    const key = name(value);
    if (!Object.hasOwn(defaults, key)) throw new Error(`Канал ${key} отсутствует в defaults.`);
    return key;
  };
  const pose = (value: unknown): RigPose =>
    Object.fromEntries(
      Object.entries(object(value)).map(([key, value]) => [channel(key), number(value)]),
    );
  const part = (value: unknown) => {
    const key = name(value);
    if (!svgParts.has(key)) throw new Error(`SVG-часть ${key} отсутствует.`);
    return key;
  };
  const rawParts = object(data.parts);
  const parts = Object.fromEntries(
    rigRoles.map((role) => [role, part(rawParts[role])]),
  ) as CharacterRig['parts'];
  if (new Set(Object.values(parts)).size !== rigRoles.length)
    throw new Error('Роли рига должны ссылаться на отдельные SVG-части.');
  const contains = (node: SvgNode, part: string): boolean =>
    node.children.some(
      (child) =>
        typeof child !== 'string' &&
        (child.attributes['data-part'] === part || contains(child, part)),
    );
  if (svgParts.get(parts.body)?.tag !== 'g' || svgParts.get(parts.head)?.tag !== 'g')
    throw new Error('Тело и голова рига должны быть группами SVG.');
  for (const role of ['head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const)
    if (!contains(svgParts.get(parts.body)!, parts[role]))
      throw new Error('Голова и конечности должны находиться внутри группы тела.');
  for (const role of [
    'leftPupil',
    'rightPupil',
    'leftLid',
    'rightLid',
    'mouth',
    'leftBrow',
    'rightBrow',
  ] as const)
    if (!contains(svgParts.get(parts.head)!, parts[role]))
      throw new Error('Лицевые части должны находиться внутри группы головы.');
  const transforms: RigTransform[] = list(data.transforms, 100).map((value) => {
    const item = object(value),
      pivot = list(item.pivot, 2).map((value) => number(value));
    if (pivot.length !== 2) throw new Error('Опорная точка рига содержит две координаты.');
    const channels = Object.fromEntries(
      ['x', 'y', 'rotate', 'scaleX', 'scaleY']
        .filter((key) => item[key] !== undefined)
        .map((key) => [key, channel(item[key])]),
    );
    if (!Object.keys(channels).length) throw new Error('Трансформация рига не содержит каналов.');
    return { part: part(item.part), pivot: pivot as [number, number], ...channels };
  });
  if (new Set(transforms.map((item) => item.part)).size !== transforms.length)
    throw new Error('Для части допустима одна трансформация рига.');
  for (const role of [
    'body',
    'head',
    'leftArm',
    'rightArm',
    'leftLeg',
    'rightLeg',
    'leftPupil',
    'rightPupil',
  ] as const)
    if (!transforms.some((item) => item.part === parts[role]))
      throw new Error(`Отсутствует трансформация ${role}.`);
  const paths = list(data.paths, 100).map((value) => {
    const item = object(value),
      key = part(item.part);
    if (svgParts.get(key)?.tag !== 'path') throw new Error('Кривая рига должна быть path.');
    return { part: key, template: checkPath(item.template, defaults) };
  });
  if (new Set(paths.map((item) => item.part)).size !== paths.length)
    throw new Error('Повторяющаяся кривая рига.');
  for (const role of ['leftLid', 'rightLid', 'mouth', 'leftBrow', 'rightBrow'] as const)
    if (!paths.some((item) => item.part === parts[role]))
      throw new Error(`Отсутствует кривая ${role}.`);
  const bound = new Set([
    ...transforms.flatMap((item) =>
      Object.entries(item)
        .filter(([key]) => !['part', 'pivot'].includes(key))
        .map(([, value]) => value as string),
    ),
    ...paths.flatMap((item) => templateChannels(item.template)),
  ]);
  if (Object.keys(defaults).some((key) => !bound.has(key)))
    throw new Error('Канал рига не связан с SVG.');
  const rawActions = object(data.actions);
  const actions = Object.fromEntries(
    rigActions.map((action) => {
      const item = object(rawActions[action]),
        duration = number(item.duration, 30);
      if (duration < 0.4) throw new Error('Длительность действия: 0.4–30 секунд.');
      const tracks = Object.fromEntries(
        Object.entries(object(item.tracks)).map(([key, value]) => {
          const keys = list(value, 128).map((value) => {
            const pair = list(value, 2);
            if (pair.length !== 2) throw new Error('Ключ рига содержит время и смещение.');
            return [number(pair[0], duration), number(pair[1])] as [number, number];
          });
          if (
            keys.length < 2 ||
            keys[0][0] !== 0 ||
            keys.at(-1)![0] !== duration ||
            keys[0][1] !== keys.at(-1)![1] ||
            keys.some(([time], i) => time < 0 || (i > 0 && time <= keys[i - 1][0]))
          )
            throw new Error(
              'Ключи действия возрастают от 0 до duration; начало и конец петли совпадают.',
            );
          return [channel(key), keys];
        }),
      );
      if (!Object.values(tracks).some((keys) => keys.some(([, value]) => value !== keys[0][1])))
        throw new Error(`Действие ${action} не содержит движения.`);
      return [action, { duration, tracks }];
    }),
  ) as CharacterRig['actions'];
  const rawEmotions = object(data.emotions);
  const emotions = Object.fromEntries(
    rigEmotions.map((emotion) => [emotion, pose(rawEmotions[emotion])]),
  ) as CharacterRig['emotions'];
  const neutral = { ...defaults, ...emotions.neutral };
  const faceChannels = new Set(paths.flatMap((item) => templateChannels(item.template)));
  for (const emotion of rigEmotions.filter((value) => value !== 'neutral'))
    if (
      !Object.entries(emotions[emotion]).some(
        ([key, value]) => faceChannels.has(key) && value !== neutral[key],
      )
    )
      throw new Error(`Эмоция ${emotion} не изменяет позу.`);
  const rawControls = object(data.controls),
    rawBlink = object(rawControls.blink);
  const gaze = (value: unknown) => {
    const item = object(value),
      range = number(item.range, 1000);
    if (range <= 0) throw new Error('Нужен положительный диапазон взгляда.');
    return { channel: channel(item.channel), range };
  };
  const controls = {
    headTilt: channel(rawControls.headTilt),
    gazeX: gaze(rawControls.gazeX),
    gazeY: gaze(rawControls.gazeY),
    blink: { left: pose(rawBlink.left), right: pose(rawBlink.right) },
  };
  if (transforms.find((item) => item.part === parts.head)?.rotate !== controls.headTilt)
    throw new Error('Наклон головы должен управлять поворотом её части.');
  for (const role of ['leftPupil', 'rightPupil'] as const) {
    const binding = transforms.find((item) => item.part === parts[role]);
    if (binding?.x !== controls.gazeX.channel || binding.y !== controls.gazeY.channel)
      throw new Error('Оба зрачка должны быть связаны с горизонтальным/вертикальным взглядом.');
  }
  for (const side of ['left', 'right'] as const) {
    const template = paths.find((item) => item.part === parts[`${side}Lid`])!.template,
      channels = new Set(templateChannels(template));
    if (
      !Object.entries(controls.blink[side]).some(
        ([key, value]) => channels.has(key) && value !== defaults[key],
      ) ||
      Object.keys(controls.blink[side]).some((key) => !channels.has(key))
    )
      throw new Error('Моргание должно двигать существующую кривую соответствующего века.');
  }
  if (Object.keys(controls.blink.left).some((key) => Object.hasOwn(controls.blink.right, key)))
    throw new Error('Левое и правое веко имеют отдельные каналы моргания.');
  return {
    schemaVersion: 1,
    engine: 'pistudio-character-1',
    parts,
    defaults,
    transforms,
    paths,
    actions,
    emotions,
    controls,
  };
}
