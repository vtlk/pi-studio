import { t, i18n } from '../../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Textarea } from '@/shared/ui/Textarea';
import { enabledResources, useResources } from '@/features/resources/model/Resources';
import { useCoreTools } from '@/features/connections/model/useCoreTools';
import { systemAgentDefinitions } from '../../../../../shared/systemAgents';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLaunch } from '../../model/Launch';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useProject } from '@/features/project/model/projectHooks';
import { useStorage } from '@/shared/storage/Storage';
import { builtinResource, browserMcp, computerMcp } from '../../../../../shared/builtinResources';
function CompiledPrompt({ baseInstruction = '' }: { baseInstruction?: string }) {
  useTranslation(undefined, { i18n });
  const coreTools = useCoreTools();
  const { setDialog } = useLaunch();
  const { selectedAgent, selectedSystemRole } = useAgentProfiles();
  const { resources } = useResources();
  const { isDesktop } = useStorage();
  const names = (kind: 'skills' | 'mcps' | 'plugins') =>
    selectedAgent
      ? enabledResources(selectedAgent, kind).map((id) =>
          kind === 'mcps' && builtinResource(id)
            ? builtinResource(id)!.name
            : (resources.find((item) => item.kind === kind && item.id === id)?.name ?? id),
        )
      : [];
  const internalMcp = selectedSystemRole
    ? systemAgentDefinitions[selectedSystemRole].mcp
    : isDesktop
      ? t('CapabilitiesPanel.piStudioProject')
      : undefined;
  const mcps = [
    ...(internalMcp ? [t('PromptDialog.builtInPinned', { value1: internalMcp })] : []),
    ...(isDesktop
      ? [browserMcp, computerMcp].map((resource) =>
          t('PromptDialog.builtInPinned', { value1: resource.name }),
        )
      : []),
    ...names('mcps'),
  ];
  const text = [
    baseInstruction,
    t('PromptDialog.sharedTools', {
      value1: coreTools
        .filter((tool) => selectedSystemRole !== 'assistant' || tool.id === 'web-search')
        .map((tool) => `${tool.name} · ${tool.status}`)
        .join(', '),
    }),
    selectedAgent?.mainInstruction ?? '',
    ...(selectedAgent?.instructions ?? [])
      .filter((item) => item.enabled)
      .map((item) => `${item.name}\n${item.content}`),
    t('PromptDialog.skillsMcpPackagesModelEffort', {
      value1: names('skills').join(', ') || t('ConnectionsPanel.none'),
      value2: mcps.join(', ') || t('ConnectionsPanel.none'),
      value3: names('plugins').join(', ') || t('ConnectionsPanel.none'),
      value4: selectedAgent?.model?.id || t('PromptDialog.notSelected'),
      value5: selectedAgent?.model?.reasoning || t('PromptDialog.default'),
    }),
  ].join('\n\n');
  return (
    <Modal
      title={t('PromptDialog.finalInstructions')}
      onClose={() => setDialog(null)}
      footer={<Button onClick={() => setDialog(null)}>{t('TeamTransfers.close')}</Button>}
    >
      {isDesktop && <p>{t('PromptDialog.currentProfileInstructionsAndAssignmentsPathsInputs')}</p>}
      <Textarea
        className="compiled-prompt"
        aria-label={t('PromptDialog.finalInstructions')}
        readOnly
        value={text}
      />
    </Modal>
  );
}
function LegacyPrompt() {
  useTranslation(undefined, { i18n });
  const { baseInstruction } = useProject();
  return <CompiledPrompt baseInstruction={baseInstruction} />;
}
export function PromptDialog() {
  useTranslation(undefined, { i18n });
  const { isDesktop } = useStorage();
  return isDesktop ? <CompiledPrompt /> : <LegacyPrompt />;
}
