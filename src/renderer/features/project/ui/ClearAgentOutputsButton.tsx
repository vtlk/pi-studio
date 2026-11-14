import { Trash2 } from 'lucide-react';
import type { ProjectAgent } from '../model/workspace.types';
import { useWorkspace } from '../model/Workspace';
import { useStorage } from '@/shared/storage/Storage';
import { useConfirm } from '@/shared/model/Confirm';
import { IconButton } from '@/shared/ui';

export function ClearAgentOutputsButton({ agent }: { agent: ProjectAgent }) {
  const { selectedProject, clearAgentOutput, busy } = useWorkspace();
  const { isDesktop } = useStorage();
  const { confirm } = useConfirm();
  return (
    <IconButton
      className="clear-agent-outputs"
      title="Удалить все файлы агента"
      disabled={
        !isDesktop ||
        !selectedProject ||
        busy ||
        selectedProject.agents.some((item) => item.runStatus === 'running')
      }
      onClick={() => {
        if (!selectedProject) return;
        const projectId = selectedProject.id;
        confirm({
          title: `Удалить все файлы агента «${agent.profile.name}»?`,
          description:
            'Все файлы и подпапки результатов переместятся в Корзину macOS. История диалога Pi и настройки агента сохранятся. Восстановление доступно через Finder.',
          confirmLabel: 'Удалить файлы',
          onConfirm: () => void clearAgentOutput(projectId, agent.profile.id),
        });
      }}
    >
      <Trash2 size={17} aria-hidden="true" />
    </IconButton>
  );
}
