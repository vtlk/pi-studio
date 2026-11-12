import { useStoredState } from '@/shared/storage/Storage';
import { ProjectContext } from './Project.context';
import { initialPlan } from '@/fixtures/plan';
import { useContext, useReducer, useState, type ReactNode, type SetStateAction } from 'react';
import { locations, scenes } from '@/fixtures/studio';
import { approvalReducer, initialApproval, isFilmAccepted } from './approval';

function useProjectState() {
  const [projectRemoved, setProjectRemoved] = useState(false);
  const [step, setStep] = useState(4);
  const [plan, setPlan] = useState(initialPlan);
  const [scene, setScene] = useState(0);
  const [removedSceneIds, setRemovedSceneIds] = useState<string[]>([]);
  const visibleScenes = scenes
    .map((item, index) => ({ ...item, index }))
    .filter((item) => !removedSceneIds.includes(item.id));
  const totalDuration = visibleScenes.reduce((total, item) => total + item.duration, 0);
  const [removedCastRoles, setRemovedCastRoles] = useState<string[]>([]);
  const [sceneTab, setSceneTab] = useState('Просмотр');
  const [approval, dispatchApproval] = useReducer(approvalReducer, initialApproval);
  const sceneApproved = approval.acceptedScenes;
  const filmApproved = isFilmAccepted(approval);
  const setFilmApproved = (accepted: boolean) =>
    dispatchApproval({ type: accepted ? 'accept-film' : 'revoke-film' });
  const setSceneApproved = (update: SetStateAction<number[]>) =>
    dispatchApproval({
      type: 'set-scenes',
      scenes: typeof update === 'function' ? update(sceneApproved) : update,
    });
  const [baseInstruction, setBaseInstruction] = useStoredState(
    'baseInstruction',
    'Сохраняй единый стиль проекта: геометрическая 2D-графика, приглушённые цвета, выразительные персонажи. Результаты передавай файлами и описанием созданных материалов.',
  );
  const [script, setScript] = useState(
    'Механик возвращается домой после длинного дня. У подъезда стоит незнакомый деревянный ящик. Изнутри раздаётся тихий стук.\n\nМЕХАНИК\nЭто ещё что такое?\n\nОн наклоняется к ящику и прислушивается. Наверху загорается окно. Соседка выглядывает во двор.\n\nСОСЕДКА\nЯ бы на твоём месте не открывала.',
  );
  const [locationOverrides, setLocationOverrides] = useState<Record<number, string>>({});
  const chooseLocation = (id: string) => {
    setLocationOverrides((previous) => ({ ...previous, [scene]: id }));
    dispatchApproval({ type: 'change-scene', scene });
  };
  const currentScene = scenes[scene];
  const selectedLocation =
    locations.find((l) => l.id === (locationOverrides[scene] ?? currentScene.location)) ??
    locations[0];
  const removeScene = (index: number) => {
    setRemovedSceneIds((previous) => [...previous, scenes[index].id]);
    if (scene === index) setScene(visibleScenes.find((item) => item.index !== index)?.index ?? 0);
    dispatchApproval({ type: 'change-scene', scene: index });
  };
  const restoreScene = (index: number) => {
    setRemovedSceneIds((previous) => previous.filter((id) => id !== scenes[index].id));
    setScene(index);
    dispatchApproval({ type: 'change-scene', scene: index });
  };
  const removeCastRole = (role: string) => {
    setRemovedCastRoles((previous) => [...previous, role]);
    dispatchApproval({ type: 'change-scene', scene });
  };
  const restoreCastRole = (role: string) => {
    setRemovedCastRoles((previous) => previous.filter((name) => name !== role));
    dispatchApproval({ type: 'change-scene', scene });
  };
  const invalidate = () => dispatchApproval({ type: 'change-scene', scene });
  return {
    projectRemoved,
    removeProject: () => setProjectRemoved(true),
    restoreProject: () => setProjectRemoved(false),
    visibleScenes,
    totalDuration,
    removeScene,
    restoreScene,
    removedCastRoles,
    removeCastRole,
    restoreCastRole,
    plan,
    setPlan,
    step,
    setStep,
    scene,
    setScene,
    sceneTab,
    setSceneTab,
    sceneApproved,
    setSceneApproved,
    filmApproved,
    setFilmApproved,
    script,
    setScript,
    baseInstruction,
    setBaseInstruction,
    currentScene,
    selectedLocation,
    chooseLocation,
    invalidate,
  };
}
export type ProjectContextValue = ReturnType<typeof useProjectState> | null;
export function ProjectProvider({ children }: { children: ReactNode }) {
  return <ProjectContext.Provider value={useProjectState()}>{children}</ProjectContext.Provider>;
}
export function useProject() {
  const value = useContext(ProjectContext);
  if (!value) throw new Error('ProjectProvider is missing');
  return value;
}
