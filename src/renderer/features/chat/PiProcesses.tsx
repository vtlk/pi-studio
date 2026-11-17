import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import type { PiProcessInfo } from '../../../shared/chat';
import { t, i18n } from '../../../shared/i18n';
import { Tooltip } from '@/shared/ui/Tooltip';
import { useNavigation } from '@/shared/model/Navigation';
import { useWorkspace } from '@/features/project/model/Workspace';
import { useChatPanels } from './ChatPanels.context';
import './chat.css';

export function PiProcesses() {
  useTranslation(undefined, { i18n });
  const [processes, setProcesses] = useState<PiProcessInfo[]>([]),
    [open, setOpen] = useState(false);
  const panels = useChatPanels(),
    { navigate } = useNavigation(),
    { projects, setProjectId } = useWorkspace();
  useEffect(() => {
    let alive = true,
      reading = false;
    const read = async () => {
      if (!window.studio || reading) return;
      reading = true;
      try {
        const next = await window.studio.listPiProcesses();
        if (alive) setProcesses(next);
      } catch {
        /* Retain the last known count on a transient IPC failure. */
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1500);
    const unsubscribe = window.studio?.onChatChanged(() => void read());
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribe?.();
    };
  }, []);
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
