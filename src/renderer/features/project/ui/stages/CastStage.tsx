import { useLaunch } from '@/features/launch/model/Launch';
import { AddArea } from '@/shared/ui/AddArea';
import { CastCards } from '../CastCards';
export function CastStage() {
  const { setDialog } = useLaunch();
  return (
    <div className="stage-page">
      <AddArea
        label="Добавить персонажа"
        onClick={() =>
          setDialog({ title: 'Добавить персонажа', kind: 'picker', assetType: 'characters' })
        }
      />
      <CastCards />
    </div>
  );
}
