import { SetupChatPanel } from '@/features/chat/SetupChatPanel';
import { AgentList } from './AgentList';
import { AgentProfileEditor } from './AgentProfileEditor';

export function AgentsView() {
  return (
    <div className="agents-workspace">
      <aside className="agent-stages">
        <AgentList />
      </aside>
      <AgentProfileEditor />
      <SetupChatPanel inline />
    </div>
  );
}
