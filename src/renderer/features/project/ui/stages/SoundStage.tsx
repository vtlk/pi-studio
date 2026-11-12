import { useNotice } from '@/shared/model/Notice';
import { SectionMenu } from '@/shared/ui/SectionMenu';
import { useProject } from '../../model/Project';
import { SoundLayers } from '../SoundLayers';
export function SoundStage() {
  const { scene, setScene, visibleScenes, removeScene, restoreScene } = useProject();
  const { demo } = useNotice();
  if (!visibleScenes.length) return <div className="stage-page">Сцен пока нет.</div>;
  return (
    <div className="stage-page scene-section-layout">
      <SectionMenu
        label="Сцены для звука"
        items={visibleScenes
          .map((item, position) => ({
            onRemove: () => {
              removeScene(item.index);
              demo(`Сцена «${item.name}» убрана из проекта.`, {
                label: 'Вернуть',
                onClick: () => restoreScene(item.index),
              });
            },
            id: item.index,
            label: `${position + 1}. ${item.name}`,
          }))
          .reverse()}
        selected={scene}
        onSelect={setScene}
      />
      <div className="scene-section-body">
        <SoundLayers />
      </div>
    </div>
  );
}
