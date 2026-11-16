import type { Asset } from '@/entities/studio/types';
export type { Asset, Agent, Instruction } from '@/entities/studio/types';
export const assets: Asset[] = [];
export const characters = assets.filter((a) => a.type === 'characters');
export const locations = assets.filter((a) => a.type === 'scenes');
export const character = characters.find((a) => a.id === 'men-02-garage-guy')!;
export const steps = [
  'Сценарий',
  'План',
  'Персонажи',
  'Озвучка',
  'Сцены',
  'Анимация и монтаж',
  'Звук',
  'Экспорт',
];
export const scenes = [
  {
    id: 'sc-01',
    name: 'Находка',
    time: '00:00–00:12',
    duration: 12,
    location: 'panel-night',
    description:
      'Механик возвращается домой. У подъезда стоит незнакомый ящик. Он останавливается и прислушивается.',
    line: 'Это ещё что такое?',
    camera: 'Общий → средний план',
    status: 'На просмотре',
  },
  {
    id: 'sc-02',
    name: 'Странный стук',
    time: '00:12–00:29',
    duration: 17,
    location: 'panel-night',
    description:
      'Из ящика доносится тихий стук. Механик наклоняется, а из окна за ним наблюдает соседка.',
    line: 'Там кто-нибудь есть?',
    camera: 'Средний → деталь',
    status: 'Черновик',
  },
  {
    id: 'sc-03',
    name: 'Нежданный совет',
    time: '00:29–00:48',
    duration: 19,
    location: 'panel-night',
    description: 'Соседка выходит во двор и просит не трогать посылку. Но ящик снова подпрыгивает.',
    line: 'Я бы на твоём месте не открывала.',
    camera: 'Общий → диалог',
    status: 'Черновик',
  },
  {
    id: 'sc-04',
    name: 'Внутри',
    time: '00:48–01:09',
    duration: 21,
    location: 'factory-bunker',
    description: 'Герои открывают ящик. Внутри оказывается маленький робот с заводской наклейкой.',
    line: 'Кажется, он ищет дорогу домой.',
    camera: 'Деталь → крупный план',
    status: 'Нужны материалы',
  },
  {
    id: 'sc-05',
    name: 'Новый сосед',
    time: '01:09–01:24',
    duration: 15,
    location: 'panel-night',
    description: 'Робот устраивается на скамейке. Механик и соседка переглядываются и смеются.',
    line: 'Ну что, добро пожаловать во двор.',
    camera: 'Средний → общий план',
    status: 'Черновик',
  },
];
export { allSkills, allMcps, allPlugins, initialAgents } from './agents';
