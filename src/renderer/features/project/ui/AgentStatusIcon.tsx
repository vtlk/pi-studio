import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleOff,
  CirclePause,
  LoaderCircle,
  MessageCircleQuestion,
} from 'lucide-react';
import { agentStatusLabels, type AgentDisplayStatus } from '../model/agentActivity';

const icons = {
  idle: CircleDashed,
  running: LoaderCircle,
  waiting: MessageCircleQuestion,
  ready: CircleCheck,
  error: CircleAlert,
  stopped: CirclePause,
  disabled: CircleOff,
};

export function AgentStatusIcon({ status }: { status: AgentDisplayStatus }) {
  const Icon = icons[status];
  return (
    <span
      className="agent-status-icon"
      data-status={status}
      role="img"
      aria-label={agentStatusLabels[status]}
    >
      <Icon size={18} aria-hidden="true" />
    </span>
  );
}
