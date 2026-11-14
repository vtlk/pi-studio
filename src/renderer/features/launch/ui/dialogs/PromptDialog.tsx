import { enabledResources, useResources } from '@/features/resources/model/Resources';
import { coreTools, coreToolStatus } from '@/entities/studio/tools';
import { systemAgentDefinitions } from '../../../../../shared/systemAgents';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLaunch } from '../../model/Launch';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useProject } from '@/features/project/model/projectHooks';
import { useStorage } from '@/shared/storage/Storage';
import { libraryMcp } from '../../../../../shared/builtinResources';
function CompiledPrompt({ baseInstruction = '' }: { baseInstruction?: string }) {
  const { setDialog } = useLaunch();
  const { selectedAgent, selectedSystemRole } = useAgentProfiles();
  const { resources } = useResources();
  const { isDesktop } = useStorage();
  const names = (kind: 'skills' | 'mcps' | 'plugins') =>
    selectedAgent
      ? enabledResources(selectedAgent, kind).map((id) =>
          kind === 'mcps' && id === libraryMcp.id
            ? libraryMcp.name
            : (resources.find((item) => item.kind === kind && item.id === id)?.name ?? id),
        )
      : [];
  const internalMcp = selectedSystemRole
    ? systemAgentDefinitions[selectedSystemRole].mcp
    : isDesktop
      ? 'Pi Studio · Проект'
      : undefined;
  const mcps = [
    ...(internalMcp ? [`${internalMcp} (встроенный, закреплён)`] : []),
    ...names('mcps'),
  ];
  const text = [
    baseInstruction,
    `ОБЩИЕ ИНСТРУМЕНТЫ: ${coreTools
      .filter((tool) => selectedSystemRole !== 'assistant' || tool.id === 'web-search')
      .map((tool) => `${tool.name} · ${coreToolStatus(tool.id, isDesktop)}`)
      .join(', ')}`,
    selectedAgent?.mainInstruction ?? '',
    ...(selectedAgent?.instructions ?? [])
      .filter((item) => item.enabled)
      .map((item) => `${item.name}\n${item.content}`),
    `SKILLS: ${names('skills').join(', ') || 'нет'}\nMCP: ${mcps.join(', ') || 'нет'}\nПАКЕТЫ: ${names('plugins').join(', ') || 'нет'}\nМОДЕЛЬ: ${selectedAgent?.model?.id || 'не выбрана'}\nEFFORT: ${selectedAgent?.model?.reasoning || 'по умолчанию'}`,
  ].join('\n\n');
  return (
    <Modal
      title="Итоговые инструкции"
      onClose={() => setDialog(null)}
      footer={<Button onClick={() => setDialog(null)}>Закрыть</Button>}
    >
      {isDesktop && (
        <p>
          Текущие инструкции и назначения профиля. Пути, входные файлы и контекст будут собраны при
          запуске; тексты skills читаются из текущих файлов.
        </p>
      )}
      <textarea
        className="compiled-prompt"
        aria-label="Итоговые инструкции"
        readOnly
        value={text}
      />
    </Modal>
  );
}
function LegacyPrompt() {
  const { baseInstruction } = useProject();
  return <CompiledPrompt baseInstruction={baseInstruction} />;
}
export function PromptDialog() {
  const { isDesktop } = useStorage();
  return isDesktop ? <CompiledPrompt /> : <LegacyPrompt />;
}
