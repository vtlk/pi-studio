import type { OutputEntry } from '@/features/project/model/workspace.types';
import type { DemoTimeline } from '@/features/editor/model/timeline';
import { locations } from './studio';
const timeline: DemoTimeline = {
  type: 'pi-studio.prototype-timeline',
  fps: 30,
  width: 1080,
  height: 1920,
  subtitles: 'ЭТО ЕЩЁ ЧТО ТАКОЕ?',
  tracks: [
    {
      id: 'picture',
      label: 'Изображение',
      gain: 100,
      pan: 0,
      muted: false,
      clips: [
        {
          id: 'scene-one',
          label: 'Находка',
          src: './assets/scene-01.svg',
          start: 0,
          duration: 360,
        },
        {
          id: 'scene-two',
          label: 'Странный стук',
          src: './assets/scene-02.svg',
          start: 360,
          duration: 510,
        },
      ],
    },
    {
      id: 'voice',
      label: 'Речь',
      gain: 90,
      pan: 0,
      muted: false,
      clips: [{ id: 'voice-one', label: 'Реплика · пример', start: 30, duration: 75 }],
    },
    {
      id: 'atmosphere',
      label: 'Атмосфера',
      gain: 30,
      pan: 0,
      muted: false,
      clips: [{ id: 'city', label: 'Двор · пример', start: 0, duration: 870 }],
    },
    {
      id: 'effects',
      label: 'Эффекты',
      gain: 70,
      pan: -20,
      muted: false,
      clips: [{ id: 'knock', label: 'Стук · пример', start: 300, duration: 30 }],
    },
    {
      id: 'music',
      label: 'Музыка',
      gain: 20,
      pan: 0,
      muted: false,
      clips: [{ id: 'music-one', label: 'Подложка · пример', start: 0, duration: 870 }],
    },
  ],
};
function manifest(
  id: string,
  name: string,
  state = './timeline.json',
  schemaVersion = 1,
): OutputEntry {
  return {
    kind: 'file',
    id,
    montageScope: id === 'scene-manifest' ? 'scene' : 'film',
    name: `${name}.pistudio.json`,
    format: 'json',
    content: JSON.stringify(
      {
        type: 'pi-studio.video-project',
        schemaVersion,
        editor: 'remotion-editor-starter',
        name,
        state,
      },
      null,
      2,
    ),
  };
}
export const montageExamples: OutputEntry[] = [
  manifest('film-manifest', 'Мультфильм'),
  {
    kind: 'file',
    id: 'film-timeline',
    name: 'timeline.json',
    format: 'json',
    content: JSON.stringify(timeline, null, 2),
  },
  {
    kind: 'folder',
    id: 'film-assets',
    name: 'assets',
    children: locations
      .slice(0, 2)
      .map((location, index) => ({
        kind: 'file',
        id: `film-image-${index}`,
        name: `scene-0${index + 1}.svg`,
        format: 'image',
        src: location.vector ?? location.image,
      })),
  },
  {
    kind: 'folder',
    id: 'scene-montage',
    name: 'Сцена 1',
    children: [
      manifest('scene-manifest', 'Находка'),
      {
        kind: 'file',
        id: 'scene-timeline',
        name: 'timeline.json',
        format: 'json',
        content: JSON.stringify(
          {
            ...timeline,
            tracks: timeline.tracks.map((track) => ({
              ...track,
              clips: track.clips
                .slice(0, 1)
                .map((clip) => ({ ...clip, src: clip.src ? '../assets/scene-01.svg' : undefined })),
            })),
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    kind: 'folder',
    id: 'invalid-montages',
    name: 'Примеры ошибок',
    children: [
      manifest('unsupported-manifest', 'Несовместимая версия', './timeline.json', 99),
      manifest('missing-state-manifest', 'Отсутствующий материал', './missing.json'),
      {
        kind: 'file',
        id: 'broken-manifest',
        name: 'Повреждённый.pistudio.json',
        format: 'json',
        content: '{invalid',
      },
      {
        kind: 'file',
        id: 'tsx-example',
        name: 'composition.tsx',
        format: 'text',
        content: '// Пример исходника. Не запускается и не превращается в монтажную шкалу.',
      },
    ],
  },
];
