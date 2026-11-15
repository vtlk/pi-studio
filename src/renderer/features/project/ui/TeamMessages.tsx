import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { Disclosure, DisclosureList } from '@/shared/ui/Disclosure';
import { useConfirm } from '@/shared/model/Confirm';
import type { WorkspaceProject } from '../../../../shared/project';
import type { TeamMessageInfo } from '../../../../shared/teamMessages';

const labels: Record<TeamMessageInfo['state'], string> = {
  queued: 'В очереди',
  dispatching: 'Отправляется',
  received: 'Получатель выполняет поручение',
  completed: 'Выполнено',
  failed: 'Остановлено',
  uncertain: 'Доставка не подтверждена',
  cancelled: 'Отменено',
};
export function TeamMessages({ project }: { project: WorkspaceProject }) {
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
      setError(error instanceof Error ? error.message : 'Не удалось изменить поручение.');
    }
  };
  if (!pending.length && !open) return null;
  return (
    <>
      <Button kind="primary" onClick={() => setOpen(true)}>
        <Inbox size={17} />
        Поручения · {pending.length}
      </Button>
      {open && (
        <Modal
          title="Поручения команды"
          onClose={() => setOpen(false)}
          footer={<Button onClick={() => setOpen(false)}>Закрыть</Button>}
        >
          {error && <p role="alert">{error}</p>}
          <DisclosureList>
            {messages.map((item) => (
              <Disclosure
                key={item.id}
                label={`${name(item.senderId)} → ${name(item.recipientId)} · ${labels[item.state]}`}
              >
                {item.reason && <p>{item.reason}</p>}
                {item.requiresExplicitResume && (
                  <p>После перезапуска доставка не продолжалась автоматически.</p>
                )}
                <p className="subtle">{new Date(item.createdAt).toLocaleString('ru-RU')}</p>
                {item.preview && <p>{item.preview}</p>}
                {item.state === 'queued' && item.requiresExplicitResume && (
                  <Button kind="primary" onClick={() => void act(item, 'resume')}>
                    Продолжить поручение
                  </Button>
                )}
                {['queued', 'uncertain', 'failed'].includes(item.state) && (
                  <Button
                    onClick={() =>
                      confirm({
                        title: 'Отменить поручение?',
                        description:
                          'Убрать поручение из очереди без повторной отправки? Уже полученное задание и диалог Pi сохранятся; работающий агент не прерывается.',
                        confirmLabel: 'Отменить поручение',
                        onConfirm: () => act(item, 'cancel'),
                      })
                    }
                  >
                    Отменить поручение
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
