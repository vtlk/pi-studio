import { useStoredState } from '@/shared/storage/Storage';
import { useContext, type ReactNode } from 'react';
import type { CapabilityKind, Agent } from '@/entities/studio/types';
import { allSkills, allMcps, allPlugins } from '@/fixtures/agents';
import { ResourcesContext } from './Resources.context';

export interface Resource {
  id: string;
  name: string;
  kind: CapabilityKind;
  source: string;
  version: string;
  description: string;
  transport: string;
  args: string;
  credential: string;
  contents: string;
  createdAt: number;
}
export const resourceLabels: Record<CapabilityKind, string> = {
  skills: 'Skills',
  mcps: 'MCP',
  plugins: 'Плагины',
};
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
const initialResources: Resource[] = (
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

function useResourcesState() {
  const [resources, setResources] = useStoredState('resources', initialResources);
  return {
    resources,
    saveResource: (resource: Resource) =>
      setResources((previous) =>
        [
          resource,
          ...previous.filter((item) => item.id !== resource.id || item.kind !== resource.kind),
        ].sort((a, b) => b.createdAt - a.createdAt),
      ),
    removeResource: (kind: CapabilityKind, id: string) =>
      setResources((previous) => previous.filter((item) => item.kind !== kind || item.id !== id)),
  };
}
export type ResourcesValue = ReturnType<typeof useResourcesState>;
export function ResourcesProvider({ children }: { children: ReactNode }) {
  return (
    <ResourcesContext.Provider value={useResourcesState()}>{children}</ResourcesContext.Provider>
  );
}
export function useResources() {
  const value = useContext(ResourcesContext);
  if (!value) throw new Error('ResourcesProvider is missing');
  return value;
}
export function enabledResources(agent: Agent, kind: CapabilityKind) {
  return agent[kind].filter((id) => agent.capabilitySettings?.[`${kind}:${id}`]?.enabled !== false);
}
