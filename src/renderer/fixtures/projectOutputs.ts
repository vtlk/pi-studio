import { productionExamples } from './productionExamples';
import { montageExamples } from './montageExamples';
import { characters, locations, scenes } from './studio';
import type { OutputEntry, OutputFile } from '@/features/project/model/workspace.types';

const text = (id: string, name: string, content: string): OutputFile => ({
  kind: 'file',
  id,
  name,
  format: name.endsWith('.json') ? 'json' : /\.(md|markdown)$/i.test(name) ? 'markdown' : 'text',
  content,
});
const image = (id: string, name: string, src: string): OutputFile => ({
  kind: 'file',
  id,
  name,
  format: 'image',
  src,
});

const outputExamples: Record<string, OutputEntry[]> = {
  writer: [
    text(
      'script',
      'сценарий.md',
      `# Посылка с характером

## Персонажи

- **Механик** — находит незнакомую посылку.
- **Соседка** — предупреждает об опасности.
- **Маленький робот** — ищет дорогу домой.

${scenes.map((scene, index) => `## Сцена ${index + 1}. ${scene.name}\n\n${scene.description}\n\n**Реплика:** «${scene.line}»\n\n*План:* ${scene.camera}`).join('\n\n')}

## Материалы

| Результат | Файл |
| --- | --- |
| Сценарий | \`сценарий.md\` |
| Раскадровка | \`раскадровка.json\` |

> До анимации все статичные SVG-сцены должны быть явно одобрены человеком.

## Следующие действия

- [ ] Подобрать персонажей из библиотеки
- [ ] Согласовать превью сцен
`,
    ),
    text(
      'storyboard',
      'раскадровка.json',
      JSON.stringify(
        {
          characters: ['Механик', 'Соседка', 'Маленький робот'],
          scenes: scenes.map((scene) => ({
            id: scene.id,
            title: scene.name,
            action: scene.description,
            line: scene.line,
            camera: scene.camera,
          })),
        },
        null,
        2,
      ),
    ),
  ],
  characters: characters.slice(0, 2).map((item) => ({
    kind: 'folder',
    id: item.id,
    name: item.title,
    children: [
      image(`${item.id}-svg`, 'персонаж.svg', item.vector ?? item.image),
      image(`${item.id}-png`, 'референс.png', item.reference ?? item.image),
    ],
  })),
  scenes: scenes.map((scene, index) => {
    const location = locations[index % locations.length];
    return {
      kind: 'folder',
      id: scene.id,
      name: `Сцена ${index + 1}. ${scene.name}`,
      children: [
        text(
          `${scene.id}-description`,
          'сцена.json',
          JSON.stringify(
            {
              scene: scene.id,
              title: scene.name,
              action: scene.description,
              camera: scene.camera,
              sound: ['Атмосфера локации', 'Шаги', 'Звуки предметов'],
            },
            null,
            2,
          ),
        ),
        image(`${scene.id}-svg`, 'сцена.svg', location.vector ?? location.image),
        image(`${scene.id}-png`, 'референс.png', location.reference ?? location.image),
      ],
    };
  }),
  animation: [
    {
      kind: 'folder',
      id: 'animation-scene-01',
      name: 'Сцена 1. Находка',
      children: [
        text(
          'animation-plan',
          'анимация.json',
          JSON.stringify(
            {
              scene: 'sc-01',
              actions: ['Возвращается домой', 'Замечает посылку', 'Наклоняется к ящику'],
              voice: 'HeyGen',
              skill: 'ai-anime',
            },
            null,
            2,
          ),
        ),
        text(
          'sound-plan',
          'звуковой-план.txt',
          'СЦЕНА 1. НАХОДКА\n\nОкружение: далёкий город, ветер во дворе.\nДействия: шаги по асфальту, шорох куртки, стук из ящика.\nРеплика механика: «Это ещё что такое?»\n\nВ прототипе показан пример плана. Аудиофайлы и анимация не сгенерированы.',
        ),
      ],
    },
  ],
  editor: [
    ...montageExamples,
    text(
      'composition',
      'композиция.json',
      JSON.stringify(
        {
          width: 1080,
          height: 1920,
          fps: 30,
          tools: ['Remotion', 'HyperFrames'],
          subtitles: 'UPPERCASE',
          finalRender: 'После принятия текущей версии человеком',
        },
        null,
        2,
      ),
    ),
  ],
  reviewer: [
    text(
      'report',
      'проверка.txt',
      'ПРОВЕРКА И ВЫДАЧА\n\nПроверить соответствие сцен раскадровке, внешность персонажей, синхронизацию анимации, озвучки и субтитров.\n\nПоказать общую сборку человеку. Финальный рендер запускается только после явного принятия текущей версии.\n\nЭто пример файла отчёта. Проверка видео пока не выполнялась.',
    ),
  ],
};

function withCreationTimes(entries: OutputEntry[]): OutputEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    createdAt: index + 1,
    ...(entry.kind === 'folder' ? { children: withCreationTimes(entry.children) } : {}),
  }));
}
export const demoOutputs: Record<string, OutputEntry[]> = Object.fromEntries(
  Object.entries(outputExamples).map(([id, entries]) => [
    id,
    withCreationTimes([...entries, ...(productionExamples[id] ?? [])]),
  ]),
);
