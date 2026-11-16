import { t, i18n, type MessageKey } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { Disclosure, DisclosureList } from '@/shared/ui/Disclosure';
import { useConfirm } from '@/shared/model/Confirm';
import type { WorkspaceProject } from '../../../../shared/project';
import type { TeamMessageInfo } from '../../../../shared/teamMessages';

const labels: Record<TeamMessageInfo['state'], MessageKey> = {
  queued: 'TeamMessages.queued',
  dispatching: 'TeamMessages.sending',
  received: 'TeamMessages.recipientIsWorkingOnTheTask',
  completed: 'MarkdownPreview.completed',
  failed: 'TeamMessages.stopped',
  uncertain: 'TeamMessages.deliveryUnconfirmed',
  cancelled: 'TeamMessages.cancelled',
};
export function TeamMessages({ project }: { project: WorkspaceProject }) {
  useTranslation(undefined, { i18n });
  const [messages, setMessages] = useState<TeamMessageInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const { confirm } = useConfirm();
  useEffect(() => {
    let disposed = false;
    const read = async () => {
      try {
        const rows = await window.studio!.listTeamMessages(project.id);
        if (!disposed) setMessages(rows);
      } catch {
        /* A project may be moving or closing; retain its last known rows. */
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [project.id]);
  const pending = messages.filter((item) => !['completed', 'cancelled'].includes(item.state));
  const name = (id: string) =>
    project.agents.find((item) => item.profile.id === id)?.profile.name ?? id;
  const act = async (item: TeamMessageInfo, action: 'resume' | 'cancel') => {
    try {
      setError('');
      await window.studio!.manageTeamMessage({ projectId: project.id, messageId: item.id, action });
      setMessages(await window.studio!.listTeamMessages(project.id));
    } catch (error) {
      setError(error instanceof Error ? error.message : t('TeamMessages.couldNotChangeTheTask'));
    }
  };
  if (!pending.length && !open) return null;
  return (
    <>
      <Button kind="primary" onClick={() => setOpen(true)}>
        <Inbox size={17} />
        {t('TeamMessages.tasks')}
        {pending.length}
      </Button>
      {open && (
        <Modal
          title={t('TeamMessages.teamTasks')}
          onClose={() => setOpen(false)}
          footer={<Button onClick={() => setOpen(false)}>{t('TeamTransfers.close')}</Button>}
        >
          {error && <p role="alert">{error}</p>}
          <DisclosureList>
            {messages.map((item) => (
              <Disclosure
                key={item.id}
                label={`${name(item.senderId)} → ${name(item.recipientId)} · ${t(labels[item.state])}`}
              >
                {item.reason && <p>{item.reason}</p>}
                {item.requiresExplicitResume && (
                  <p>{t('TeamMessages.deliveryDidNotResumeAutomaticallyAfterRestart')}</p>
                )}
                <p className="subtle">
                  {new Date(item.createdAt).toLocaleString(i18n.resolvedLanguage)}
                </p>
                {item.preview && <p>{item.preview}</p>}
                {item.state === 'queued' && item.requiresExplicitResume && (
                  <Button kind="primary" onClick={() => void act(item, 'resume')}>
                    {t('TeamMessages.resumeTask')}
                  </Button>
                )}
                {['queued', 'uncertain', 'failed'].includes(item.state) && (
                  <Button
                    onClick={() =>
                      confirm({
                        title: t('TeamMessages.cancelTask'),
                        description: t('TeamMessages.removeThisTaskFromTheQueueWithout'),
                        confirmLabel: t('TeamMessages.cancelTask2'),
                        onConfirm: () => act(item, 'cancel'),
                      })
                    }
                  >
                    {t('TeamMessages.cancelTask2')}
                  </Button>
                )}
              </Disclosure>
            ))}
          </DisclosureList>
        </Modal>
      )}
    </>
  );
}
