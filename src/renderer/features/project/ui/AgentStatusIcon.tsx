import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleOff,
  CirclePause,
  Clock3,
  LoaderCircle,
} from 'lucide-react';
import { agentStatusLabels, type AgentDisplayStatus } from '../model/agentActivity';
import { Tooltip } from '@/shared/ui/Tooltip';

const icons = {
  idle: CircleDashed,
  running: LoaderCircle,
  waiting: Clock3,
  ready: CircleCheck,
  error: CircleAlert,
  stopped: CirclePause,
  disabled: CircleOff,
};

export function AgentStatusIcon({ status }: { status: AgentDisplayStatus }) {
  const Icon = icons[status];
  return (
    <Tooltip label={agentStatusLabels[status]}>
      <span
        className="agent-status-icon"
        data-status={status}
        role="img"
        aria-label={agentStatusLabels[status]}
      >
        <Icon size={18} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
