export const libraryStandards = {
  'create-library-character': {
    id: 'Создание SVG-персонажей',
    name: 'Создание SVG-персонажей',
    description: 'Создание и доработка персонажей по эталону: послойный SVG и анимационный риг.',
  },
  'create-library-scene': {
    id: 'Послойные SVG-локации',
    name: 'Послойные SVG-локации',
    description: 'Создание и доработка локаций: послойное окружение и камера.',
  },
} as const;
export type LibraryStandard = keyof typeof libraryStandards;
export type StandardFile = 'SKILL.md' | 'references/standard.md';
export interface StandardDocument {
  content: string;
  source: string;
}
