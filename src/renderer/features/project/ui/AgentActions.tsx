import { useRef, useState } from 'react';
import { FolderOpen, LoaderCircle, MessageSquare, Play } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { SplitButton } from '@/shared/ui/SplitButton';
import { useStorage } from '@/shared/storage/Storage';
import { useNotice } from '@/shared/model/Notice';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { useWorkspace } from '../model/Workspace';
import type { ProjectAgent } from '../model/workspace.types';
import { getAgentLaunchAction } from '../model/session';
import { getCurrentAgentInstructions } from '../model/snapshot';
import { validateAgentModel } from '../../../../shared/modelConfiguration';
import { StartAgentDialog } from './StartAgentDialog';
import { AgentConfigurationDialog } from './AgentConfigurationDialog';
import { ProjectAgentDeleteButton } from './ProjectAgentDeleteButton';

export function AgentActions({
  agent,
  onLaunch,
  modelConfigured,
}: {
  agent: ProjectAgent;
  onLaunch: () => void;
  modelConfigured: boolean;
}) {
  const { demo } = useNotice();
  const { saveNow } = useStorage();
  const { setAutoContinue, selectedProject, busy } = useWorkspace();
  const { agents } = useAgentProfiles();
  const { connections } = useConnections();
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [continueAfterRun, setContinueAfterRun] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const updateOpening = (value: boolean) => {
    openingRef.current = value;
    setOpening(value);
  };
  const hasSession = !!agent.session;
  const launch = async (autoContinue: boolean) => {
    if (openingRef.current || busy) return;
    if (!getCurrentAgentInstructions(agent.profile.id, agents)) {
      demo('Профиль агента удалён. Текущие инструкции недоступны; другой агент не подставляется.');
      return;
    }
    const action = getAgentLaunchAction(agent);
    if (action.kind === 'blocked') {
      demo(action.reason);
      return;
    }
    const current = agents.find((profile) => profile.id === agent.profile.id);
    if (!validateAgentModel(current?.model, connections).ok) {
      setConfigurationOpen(true);
      return;
    }
    onLaunch();
    setContinueAfterRun(autoContinue);
    if (action.kind === 'start') {
      setStartOpen(true);
      return;
    }
    if (window.studio && selectedProject) {
      updateOpening(true);
      try {
        if (!(await saveNow())) {
          demo('Сначала сохраните текущие изменения настроек.');
          return;
        }
        await window.studio.launchAgent({
          projectId: selectedProject.id,
          agentId: agent.profile.id,
          autoContinue,
        });
      } catch (error) {
        demo(error instanceof Error ? error.message : 'Не удалось продолжить диалог Pi.');
      } finally {
        updateOpening(false);
      }
      return;
    }
    setAutoContinue(autoContinue);
    demo(
      `Pi не подключён. Будет открыт диалог ${action.session.path} без отправки сообщения${action.session.needsFork ? '; перед открытием требуется штатное ветвление в текущую папку проекта' : ''}.${autoContinue ? ' Цепочка ожидает нового запроса в Pi и подтверждённого завершения этапа.' : ''}`,
    );
  };
  return (
    <>
      <div
        className="project-agent-actions"
        role="toolbar"
        aria-label={`Действия агента «${agent.profile.name}»`}
      >
        <ProjectAgentDeleteButton agent={agent} className="project-agent-secondary-action" />
        <IconButton
          title={
            navigator.platform.startsWith('Win') ? 'Показать в Проводнике' : 'Показать в Finder'
          }
          className="project-agent-secondary-action"
          disabled={busy}
          onClick={async () => {
            if (!window.studio || !selectedProject) {
              demo('Finder доступен в приложении macOS.');
              return;
            }
            try {
              await window.studio.revealAgentOutput({
                projectId: selectedProject.id,
                agentId: agent.profile.id,
              });
            } catch (error) {
              demo(error instanceof Error ? error.message : 'Не удалось показать папку агента.');
            }
          }}
        >
          <FolderOpen size={18} />
        </IconButton>
        <SplitButton
          iconOnly
          kind="secondary"
          menuLabel="Другие варианты запуска"
          label={hasSession ? 'Продолжить диалог' : 'Запустить'}
          tooltipLabel={
            opening ? 'Открываем Pi…' : modelConfigured ? undefined : 'Подключение не настроено'
          }
          icon={
            opening ? (
              <LoaderCircle size={18} className="project-launch-spinner" aria-hidden="true" />
            ) : hasSession ? (
              <MessageSquare size={18} />
            ) : (
              <Play size={18} />
            )
          }
          busy={opening}
          disabled={busy || !agent.profile.enabled}
          onClick={() => void launch(false)}
          actions={[{ label: 'Запустить и продолжить', onSelect: () => void launch(true) }]}
        />
      </div>
      {startOpen && (
        <StartAgentDialog
          agent={agent}
          autoContinue={continueAfterRun}
          onOpeningChange={updateOpening}
          onClose={() => setStartOpen(false)}
        />
      )}
      {configurationOpen && (
        <AgentConfigurationDialog
          agentId={agent.profile.id}
          onClose={() => setConfigurationOpen(false)}
        />
      )}
    </>
  );
}
