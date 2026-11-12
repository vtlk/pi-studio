import { enabledResources } from '@/features/resources/model/Resources';
import { coreTools } from '@/entities/studio/tools';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLaunch } from '../../model/Launch';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useProject } from '@/features/project/model/Project';
export function PromptDialog() {
  const { setDialog } = useLaunch();
  const { selectedAgent } = useAgentProfiles();
  const { baseInstruction } = useProject();
  const text = [
    baseInstruction,
    `ОБЩИЕ ИНСТРУМЕНТЫ: ${coreTools.map((tool) => tool.name).join(', ')}`,
    selectedAgent?.mainInstruction ?? '',
    ...(selectedAgent?.instructions ?? [])
      .filter((item) => item.enabled)
      .map((item) => `${item.name}\n${item.content}`),
    `SKILLS: ${(selectedAgent ? enabledResources(selectedAgent, 'skills').join(', ') : '') || 'нет'}\nMCP: ${(selectedAgent ? enabledResources(selectedAgent, 'mcps').join(', ') : '') || 'нет'}\nПАКЕТЫ: ${(selectedAgent ? enabledResources(selectedAgent, 'plugins').join(', ') : '') || 'нет'}\nМОДЕЛЬ: ${selectedAgent?.model?.id || 'не выбрана'}`,
  ].join('\n\n');
  return (
    <Modal
      title="Итоговые инструкции"
      onClose={() => setDialog(null)}
      footer={<Button onClick={() => setDialog(null)}>Закрыть</Button>}
    >
      <textarea
        className="compiled-prompt"
        aria-label="Итоговые инструкции"
        readOnly
        value={text}
      />
    </Modal>
  );
}
