import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useNotice } from '@/shared/model/Notice';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { Switch } from '@/shared/ui/SelectionControls';
import { useWorkspace } from '../model/Workspace';
import { compareAgents } from '../model/snapshot';
import { useStorage } from '@/shared/storage/Storage';

export function RefreshAgentsDialog({ onClose }: { onClose: () => void }) {
  useTranslation(undefined, { i18n });
  const { selectedProject, refreshAgents, restoreProjectAgent, busy } = useWorkspace();
  const { isDesktop } = useStorage();
  const { agents: allAgents, teams } = useAgentProfiles();
  const { demo } = useNotice();
  const [updateExisting, setUpdateExisting] = useState(false);
  if (!selectedProject) return null;
  const team = teams.find((team) => team.id === selectedProject.sourceTeamId);
  const agents =
    team?.agentIds.flatMap((id) => allAgents.find((agent) => agent.id === id) ?? []) ?? [];
  const diff = compareAgents(selectedProject.agents, agents);
  const hasChanges =
    diff.added.length > 0 ||
    diff.missing.length > 0 ||
    diff.reordered ||
    (updateExisting && diff.changed.length > 0);
  return (
    <Modal
      title={t('ProjectView.refreshAgents2')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t('TeamNameDialog.cancel')}
          </Button>
          <Button
            kind="primary"
            disabled={busy || !team || !hasChanges}
            onClick={async () => {
              if ((await refreshAgents(updateExisting)) === false) return;
              demo(
                isDesktop
                  ? uiText('RefreshAgentsDialog.agentListSynchronizedFilesAndPiHistory')
                  : uiText('RefreshAgentsDialog.agentSnapshotUpdatedInPrototypeMemory'),
                diff.missing.length
                  ? {
                      label: uiText('RefreshAgentsDialog.restoreRemovedAgents'),
                      onClick: async () => {
                        for (const agent of diff.missing)
                          await restoreProjectAgent(selectedProject.id, agent.id);
                      },
                    }
                  : undefined,
              );
              onClose();
            }}
          >
            {t('RefreshAgentsDialog.apply')}
          </Button>
        </>
      }
    >
      <div className="agent-diff">
        {!team ? (
          <p role="alert">{t('RefreshAgentsDialog.theSourceTeamIsMissingOrDeleted')}</p>
        ) : (
          <p>
            {t('RefreshAgentsDialog.team')}
            {team.name}
          </p>
        )}
        {team &&
          (diff.added.length > 0 ? (
            <section>
              <h3>{t('RefreshAgentsDialog.willBeAddedToTheProject')}</h3>
              <ul>
                {diff.added.map((agent) => (
                  <li key={agent.id}>{agent.name || t('AgentList.untitled')}</li>
                ))}
              </ul>
            </section>
          ) : (
            <p>{t('RefreshAgentsDialog.noNewAgents')}</p>
          ))}
        {team && diff.changed.length > 0 && (
          <section>
            <h3>{t('RefreshAgentsDialog.settingsChanged')}</h3>
            <ul>
              {diff.changed.map((agent) => (
                <li key={agent.id}>{agent.name || t('AgentList.untitled')}</li>
              ))}
            </ul>
            <label className="refresh-existing">
              <span>{t('RefreshAgentsDialog.updateTheseProfiles')}</span>
              <Switch
                label={t('RefreshAgentsDialog.updateChangedProfiles')}
                checked={updateExisting}
                onChange={setUpdateExisting}
              />
            </label>
          </section>
        )}
        {team && diff.missing.length > 0 && (
          <section>
            <h3>{t('RefreshAgentsDialog.willLeaveTheProject')}</h3>
            <ul>
              {diff.missing.map((agent) => (
                <li key={agent.id}>{agent.name || t('AgentList.untitled')}</li>
              ))}
            </ul>
            <p>{t('RefreshAgentsDialog.theseAgentsAreNoLongerOnThe')}</p>
          </section>
        )}
        {team && diff.reordered && (
          <p>{t('RefreshAgentsDialog.stageOrderWillMatchTheSourceTeam')}</p>
        )}
        {(diff.added.length > 0 || diff.changed.length > 0 || diff.missing.length > 0) && (
          <p>{t('RefreshAgentsDialog.existingOutputFilesArePreserved')}</p>
        )}
      </div>
    </Modal>
  );
}
