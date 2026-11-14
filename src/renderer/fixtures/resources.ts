import type { Resource } from '../../shared/resources';
import { allSkills, allMcps, allPlugins } from './agents.ts';

const descriptions: Record<string, string> = {
  'Сценарий и диалоги': 'Сценарий, реплики и развитие истории с сохранением контекста.',
  'Раскадровка и камера': 'Планы, действия и переходы между кадрами каждой сцены.',
  'Создание SVG-персонажей': 'Ручная послойная SVG-перерисовка одобренного эталона.',
  'Послойные SVG-локации': 'Окружение, реквизит и планы для статичных превью сцен.',
  'ai-anime': 'Анимация нарисованных персонажей и сцен.',
  'Озвучка и тайминг': 'Реплики, голоса и тайминг до детальной анимации.',
  'Звуковой дизайн': 'Атмосфера, звуки действий, акценты и музыка.',
  Remotion: 'Анимация и сборка видео средствами Remotion.',
  HyperFrames: 'Сборка видео из HTML-композиций и материалов.',
  'Проверка видео': 'Проверка согласованности, синхронизации и готовности к выдаче.',
  ImageGen: 'Генерация и редактирование растровых изображений.',
  HeyGen: 'Озвучка и генерация видеоматериалов.',
  'Музыка и звуковые эффекты': 'Получение музыки и звуков для сцен.',
  'Поиск референсов': 'Поиск визуальных материалов и источников.',
};
export const exampleResources: Resource[] = (
  [
    ['skills', allSkills],
    ['mcps', allMcps],
    ['plugins', allPlugins],
  ] as const
).flatMap(([kind, names]) =>
  names.map((name, index) => ({
    id: name,
    name,
    kind,
    source: '',
    version: 'Не закреплена',
    description: descriptions[name] ?? name,
    transport: 'HTTP',
    args: '',
    credential: '',
    contents: kind === 'plugins' ? 'Skills, расширения Pi, шаблоны инструкций' : '',
    createdAt: 100 - index,
  })),
);
