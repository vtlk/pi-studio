import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SetupChatPanel } from '@/features/chat/SetupChatPanel';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
import { useElementWidth } from '@/shared/ui/useElementWidth';
import { i18n, t } from '../../../../shared/i18n';
import { AgentList } from './AgentList';
import { AgentProfileEditor } from './AgentProfileEditor';

export function AgentsView() {
  useTranslation(undefined, { i18n });
  const { ref, width } = useElementWidth();
  const [listWidth, setListWidth] = useState(320);
  const maxListWidth = Math.max(200, (width || 1200) - 420);
  const actualListWidth = Math.min(listWidth, maxListWidth);
  return (
    <div
      className="agents-workspace"
      ref={ref}
      style={{ gridTemplateColumns: `${actualListWidth}px 8px minmax(0, 1fr)` }}
    >
      <aside className="agent-stages">
        <AgentList />
      </aside>
      <ResizeHandle
        label={t('ProjectView.agentColumnWidth')}
        value={actualListWidth}
        min={200}
        max={maxListWidth}
        onChange={setListWidth}
      />
      <AgentProfileEditor />
      <SetupChatPanel inline />
    </div>
  );
}
