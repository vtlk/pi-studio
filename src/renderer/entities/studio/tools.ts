// Mandatory studio-wide tools. Runtime adapters are not connected in the UI prototype.
export const coreTools = [
  { id: 'web-search', name: 'Веб-поиск', status: 'Не подключён' },
  { id: 'generate-image', name: 'Генерация изображений', status: 'Не подключён' },
] as const;
export function coreToolStatus(id: string, native: boolean) {
  if (native && id === 'web-search') return 'Доступен в Pi';
  return 'Не подключён';
}
