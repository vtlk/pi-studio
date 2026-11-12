import { useStorage, useStoredState } from '@/shared/storage/Storage';
import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { useConfirm } from '@/shared/model/Confirm';
import { useNotice } from '@/shared/model/Notice';
import type { CapabilityKind, Agent } from '@/entities/studio/types';
import { allSkills, allMcps, allPlugins } from '@/fixtures/agents';
import { ResourcesContext } from './Resources.context';

import type { Resource } from '../../../../shared/resources';
export type { Resource } from '../../../../shared/resources';
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

function useResourcesState() {
  const { isDesktop } = useStorage();
  const [resources, setResources] = useStoredState<Resource[]>(
    'resources',
    isDesktop ? [] : exampleResources,
  );
  const { confirm } = useConfirm();
  const { demo } = useNotice();
  const reviewed = useRef(false);
  useEffect(() => {
    if (!isDesktop || reviewed.current) return;
    reviewed.current = true;
    const legacy = resources.filter(
      (resource) =>
        resource.createdAt === 0 &&
        resource.kind === 'skills' &&
        resource.source.includes('/.pistudio/packages/pi-studio-library/skills/'),
    );
    if (!legacy.length) return;
    confirm({
      title: 'Убрать прежние предустановленные шаблоны?',
      description: `Предыдущая сборка добавила в каталог: ${legacy.map((item) => item.name).join(', ')}. Убрать эти записи? Проекты и пользовательские файлы сохранятся. Новые студии будут пустыми.`,
      confirmLabel: 'Убрать шаблоны',
      onConfirm: () => {
        const ids = new Set(legacy.map((item) => item.id));
        setResources((current) => current.filter((item) => !ids.has(item.id)));
        demo('Предустановленные шаблоны убраны из каталога.', {
          label: 'Вернуть',
          onClick: () =>
            setResources((current) => [
              ...current,
              ...legacy.filter((item) => !current.some((value) => value.id === item.id)),
            ]),
        });
      },
    });
  }, [isDesktop, resources, confirm, setResources, demo]);
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
