import { useRef, useState } from 'react';
import {
  FolderOpen,
  ListStart,
  LoaderCircle,
  MessageSquare,
  Play,
  Settings2,
  Trash2,
} from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { ActionMenu } from '@/shared/ui/ActionMenu';
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
import { useProjectAgentRemoval } from '../model/useProjectAgentRemoval';

export function AgentActions({
  agent,
  onLaunch,
  modelConfigured,
  autoContinue,
  onOpenSettings,
}: {
  agent: ProjectAgent;
  onLaunch: () => void;
  modelConfigured: boolean;
  autoContinue: boolean;
  onOpenSettings: (agentId: string, tab?: string) => void;
}) {
  const { demo } = useNotice();
  const { saveNow } = useStorage();
  const { setAutoContinue, selectedProject, busy } = useWorkspace();
  const { agents } = useAgentProfiles();
  const { connections } = useConnections();
  const removal = useProjectAgentRemoval(agent);
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
  const launchLabel = autoContinue
    ? 'Запустить и продолжить'
    : hasSession
      ? 'Продолжить диалог'
      : 'Запустить';
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
        aria-busy={opening || undefined}
      >
        <IconButton
          label={launchLabel}
          title={
            opening ? 'Открываем Pi…' : modelConfigured ? launchLabel : 'Подключение не настроено'
          }
          className="project-agent-launch"
          busy={opening}
          disabled={busy || !agent.profile.enabled}
          onClick={() => void launch(autoContinue)}
        >
          {opening ? (
            <LoaderCircle size={18} className="project-launch-spinner" aria-hidden="true" />
          ) : autoContinue ? (
            <ListStart size={18} aria-hidden="true" />
          ) : hasSession ? (
            <MessageSquare size={18} aria-hidden="true" />
          ) : (
            <Play size={18} aria-hidden="true" />
          )}
        </IconButton>
        <ActionMenu
          label={`Действия агента «${agent.profile.name}»`}
          className="project-agent-menu-trigger"
          disabled={busy || opening}
          actions={[
            {
              label: 'Запустить и продолжить',
              icon: ListStart,
              disabled: !agent.profile.enabled,
              onSelect: () => void launch(true),
            },
            {
              label: navigator.platform.startsWith('Win')
                ? 'Показать в Проводнике'
                : 'Показать в Finder',
              icon: FolderOpen,
              onSelect: () =>
                void (async () => {
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
                    demo(
                      error instanceof Error ? error.message : 'Не удалось показать папку агента.',
                    );
                  }
                })(),
            },
            {
              label: 'Настройки агента',
              icon: Settings2,
              onSelect: () => {
                if (!agents.some((profile) => profile.id === agent.profile.id)) {
                  demo('Этот агент удалён из конструктора. Другой профиль не подставляется.');
                  return;
                }
                onOpenSettings(agent.profile.id);
              },
            },
            {
              label: 'Удалить агента из проекта',
              icon: Trash2,
              separator: true,
              danger: true,
              disabled: removal.disabled,
              onSelect: removal.remove,
            },
          ]}
        />
      </div>
      {startOpen && (
        <StartAgentDialog
          agent={agent}
          autoContinue={continueAfterRun}
          onOpeningChange={updateOpening}
          onOpenSettings={onOpenSettings}
          onClose={() => setStartOpen(false)}
        />
      )}
      {configurationOpen && (
        <AgentConfigurationDialog
          agentId={agent.profile.id}
          onConfigure={onOpenSettings}
          onClose={() => setConfigurationOpen(false)}
        />
      )}
    </>
  );
}
