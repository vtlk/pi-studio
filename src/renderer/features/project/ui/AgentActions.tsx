import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
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
  useTranslation(undefined, { i18n });
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
    ? t('AgentActions.launchAndContinue')
    : hasSession
      ? t('AgentActions.continueDialogue')
      : t('AgentActions.launch');
  const launch = async (autoContinue: boolean) => {
    if (openingRef.current || busy) return;
    if (!getCurrentAgentInstructions(agent.profile.id, agents)) {
      demo(t('AgentActions.agentProfileDeletedCurrentInstructionsAreUnavailable'));
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
          demo(t('useNativeWorkspaceState.saveCurrentSettingsChangesFirst'));
          return;
        }
        await window.studio.launchAgent({
          projectId: selectedProject.id,
          agentId: agent.profile.id,
          autoContinue,
        });
      } catch (error) {
        demo(
          error instanceof Error ? error.message : t('AgentActions.couldNotResumeThePiDialogue'),
        );
      } finally {
        updateOpening(false);
      }
      return;
    }
    setAutoContinue(autoContinue);
    demo(
      t('AgentActions.piIsNotConnectedDialogueWillOpen', {
        value1: action.session.path,
        value2: action.session.needsFork
          ? t('AgentActions.aStandardForkIntoTheCurrentProject')
          : '',
        value3: autoContinue ? t('AgentActions.theChainAwaitsANewPiRequest') : '',
      }),
    );
  };
  return (
    <>
      <div
        className="project-agent-actions"
        role="toolbar"
        aria-label={t('AgentActions.actionsForAgent', { value1: agent.profile.name })}
        aria-busy={opening || undefined}
      >
        <IconButton
          label={launchLabel}
          title={
            opening
              ? t('AgentActions.openingPi')
              : modelConfigured
                ? launchLabel
                : t('AgentActions.connectionNotConfigured')
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
          label={t('AgentActions.actionsForAgent', { value1: agent.profile.name })}
          className="project-agent-menu-trigger"
          disabled={busy || opening}
          actions={[
            {
              label: t('AgentActions.launchAndContinue'),
              icon: ListStart,
              disabled: !agent.profile.enabled,
              onSelect: () => void launch(true),
            },
            {
              label: navigator.platform.startsWith('Win')
                ? t('AgentActions.showInExplorer')
                : t('AgentActions.showInFinder'),
              icon: FolderOpen,
              onSelect: () =>
                void (async () => {
                  if (!window.studio || !selectedProject) {
                    demo(t('AgentActions.finderIsAvailableInTheMacosApp'));
                    return;
                  }
                  try {
                    await window.studio.revealAgentOutput({
                      projectId: selectedProject.id,
                      agentId: agent.profile.id,
                    });
                  } catch (error) {
                    demo(
                      error instanceof Error
                        ? error.message
                        : t('AgentActions.couldNotRevealTheAgentFolder'),
                    );
                  }
                })(),
            },
            {
              label: t('AgentProfileEditor.agentSettings'),
              icon: Settings2,
              onSelect: () => {
                if (!agents.some((profile) => profile.id === agent.profile.id)) {
                  demo(t('AgentActions.thisAgentWasRemovedFromTheBuilder'));
                  return;
                }
                onOpenSettings(agent.profile.id);
              },
            },
            {
              label: t('AgentActions.removeAgentFromProject'),
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
