import { Trash2 } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { useConfirm } from '@/shared/model/Confirm';
import { useNotice } from '@/shared/model/Notice';
import { useWorkspace } from '../model/Workspace';
import type { ProjectAgent } from '../model/workspace.types';

export function ProjectAgentDeleteButton({ agent }: { agent: ProjectAgent }) {
  const { selectedProject, removeProjectAgent, restoreProjectAgent, busy } = useWorkspace();
  const { confirm } = useConfirm();
  const { demo } = useNotice();
  if (!selectedProject) return null;
  const projectId = selectedProject.id;
  return (
    <IconButton
      title="Удалить агента из проекта"
      disabled={busy}
      onClick={() =>
        confirm({
          title: `Удалить агента «${agent.profile.name || 'Без названия'}» из проекта?`,
          description:
            'Агент исчезнет из списка этого проекта. Открытый Pi этого агента будет остановлен. Выходные файлы, история диалога и общий профиль во вкладке «Агенты» сохранятся. Удаление можно отменить.',
          onConfirm: () => {
            void (async () => {
              if ((await removeProjectAgent(projectId, agent.profile.id)) === false) return;
              demo('Агент убран из проекта. Файлы и история сохранены.', {
                label: 'Вернуть',
                onClick: () => {
                  void restoreProjectAgent(projectId, agent.profile.id);
                },
              });
            })();
          },
        })
      }
    >
      <Trash2 size={18} />
    </IconButton>
  );
}
