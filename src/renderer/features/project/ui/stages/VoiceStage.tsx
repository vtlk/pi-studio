import { PrototypeButton } from '@/features/agents/ui/PrototypeButton';
import { VoiceRows } from '../VoiceRows';
export function VoiceStage() {
  return (
    <div className="stage-page">
      <div className="stage-actions">
        <PrototypeButton title="Озвучить реплики" agentId="animation" />
      </div>
      <VoiceRows />
    </div>
  );
}
