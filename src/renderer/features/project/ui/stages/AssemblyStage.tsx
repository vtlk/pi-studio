import { Button } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';
import { PrototypeButton } from '@/features/agents/ui/PrototypeButton';
import { Preview } from '@/features/preview/ui/Preview';
import { Timeline } from '@/features/preview/ui/Timeline';
export function AssemblyStage() {
  const { demo } = useNotice();
  return (
    <div className="stage-page">
      <div className="stage-actions">
        <PrototypeButton title="Собрать мультфильм" agentId="editor" />
        <Button onClick={() => demo('Встраивание Remotion Studio пока не подключено.')}>
          Открыть Studio
        </Button>
      </div>
      <div className="assembly-preview">
        <Preview full />
        <Timeline full />
      </div>
    </div>
  );
}
