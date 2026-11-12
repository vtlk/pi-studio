import { Button } from '@/shared/ui';
import { useLaunch } from '@/features/launch/model/Launch';
import { useProject } from '../../model/Project';

export function PlanStage() {
  const { plan, setPlan } = useProject();
  const { openRun } = useLaunch();
  return (
    <div className="stage-page plan-workspace">
      <div className="stage-actions">
        <Button
          kind="primary"
          onClick={() =>
            openRun(
              'Составить план',
              'Разбери принятый сценарий. Верни читаемый план и структурированный перечень персонажей, локаций, сцен и кадров. Точный тайминг уточняется после озвучки.',
              'writer',
            )
          }
        >
          Составить план
        </Button>
        <span>Агент: сценарий и раскадровка</span>
      </div>
      <textarea
        className="plan-editor"
        aria-label="План мультфильма"
        value={plan}
        onChange={(event) => setPlan(event.target.value)}
      />
    </div>
  );
}
