import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { t, i18n } from '../../../shared/i18n';
import { Tooltip } from '@/shared/ui/Tooltip';
import { useNavigation } from '@/shared/model/Navigation';
import { useWorkspace } from '@/features/project/model/Workspace';
import { useChatPanels } from './ChatPanels.context';
import './chat.css';

export function PiProcesses() {
  useTranslation(undefined, { i18n });
  const [open, setOpen] = useState(false);
  const panels = useChatPanels(),
    { navigate } = useNavigation(),
    { projects, setProjectId } = useWorkspace();
  const { processes } = panels;
  if (!processes.length) return null;
  const label = t('Chat.processesTooltip', { count: processes.length });
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip label={label}>
        <Popover.Trigger className="pi-process-indicator" aria-label={label}>
          <Cpu size={17} aria-hidden="true" />
          <span>{processes.length}</span>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          className="pi-process-popover"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label={t('Chat.processesTitle')}
        >
          <h3>{t('Chat.processesTitle')}</h3>
          <p className="subtle">{t('Chat.processesHint')}</p>
          {processes.map((process) => (
            <button
              className="pi-process-row"
              key={process.runId}
              disabled={!process.embedded}
              onClick={() => {
                if (process.projectId !== 'pi-setup-assistant') {
                  if (!projects.some((project) => project.id === process.projectId)) return;
                  setProjectId(process.projectId);
                  navigate('project');
                }
                panels.show(process);
                setOpen(false);
              }}
            >
              <span>{process.agentName}</span>
              <small>
                {t(process.working ? 'Chat.processWorking' : 'Chat.processWaiting')} · PID{' '}
                {process.pid}
              </small>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
