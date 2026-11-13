import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleOff,
  CirclePause,
  Clock3,
  LoaderCircle,
} from 'lucide-react';
import type { AgentDisplayStatus } from '../model/agentActivity';

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
    <span className="agent-status-icon" data-status={status} aria-hidden="true">
      <Icon size={32} strokeWidth={1.6} />
    </span>
  );
}
