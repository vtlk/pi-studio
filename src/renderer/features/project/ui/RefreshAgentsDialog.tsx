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
import type { AgentRefreshReview } from '../../../../shared/agentRefresh';
import { useAgentRefreshReview } from '../model/useAgentRefreshReview';
import { RefreshRestartConfirmation } from './RefreshRestartConfirmation';
import { LoaderCircle } from 'lucide-react';

export function RefreshAgentsDialog({ onClose }: { onClose: () => void }) {
  useTranslation(undefined, { i18n });
  const { selectedProject, refreshAgents, restoreProjectAgent, busy } = useWorkspace();
  const { isDesktop, saveNow } = useStorage();
  const { agents: allAgents, teams } = useAgentProfiles();
  const { demo } = useNotice();
  const [updateExisting, setUpdateExisting] = useState(false);
  const [confirmation, setConfirmation] = useState<AgentRefreshReview | null>(null);
  const [checking, setChecking] = useState(false);
  const preview = useAgentRefreshReview(selectedProject?.id, updateExisting);
  if (!selectedProject) return null;
  const team = teams.find((team) => team.id === selectedProject.sourceTeamId);
  const agents =
    team?.agentIds.flatMap((id) => allAgents.find((agent) => agent.id === id) ?? []) ?? [];
  const diff = compareAgents(selectedProject.agents, agents);
  const changed =
    preview.review?.projectId === selectedProject.id ? preview.review.changed : diff.changed;
  const apply = async (review?: AgentRefreshReview) => {
    if (
      (await refreshAgents(
        updateExisting,
        review
          ? {
              revision: review.revision,
              running: [...review.restarting, ...review.removing]
                .filter((run) => run.working)
                .map(({ runId, sequence }) => ({ runId, sequence })),
            }
          : undefined,
      )) === false
    )
      return;
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
  };
  const hasChanges =
    diff.added.length > 0 ||
    diff.missing.length > 0 ||
    diff.reordered ||
    (updateExisting && changed.length > 0);
  return (
    <>
      <Modal
        inert={!!confirmation}
        title={t('ProjectView.refreshAgents2')}
        onClose={() => {
          if (!busy && !checking) onClose();
        }}
        footer={
          <>
            <Button disabled={busy || checking} onClick={onClose}>
              {t('TeamNameDialog.cancel')}
            </Button>
            <Button
              kind="primary"
              disabled={busy || checking || !team || !hasChanges}
              onClick={async () => {
                if (!window.studio) {
                  await apply();
                  return;
                }
                setChecking(true);
                try {
                  if (!(await saveNow())) return;
                  const review = await window.studio.prepareAgentRefresh({
                    projectId: selectedProject.id,
                    updateExisting,
                  });
                  if ([...review.restarting, ...review.removing].some((run) => run.working))
                    setConfirmation(review);
                  else await apply(review);
                } catch (error) {
                  demo(error instanceof Error ? error.message : t('AgentRefresh.invalidRequest'));
                } finally {
                  setChecking(false);
                }
              }}
            >
              {(busy || checking) && (
                <LoaderCircle size={16} className="project-launch-spinner" aria-hidden="true" />
              )}
              {busy ? t('AgentRefresh.applying') : t('RefreshAgentsDialog.apply')}
            </Button>
          </>
        }
      >
        <div className="agent-diff">
          {preview.error && (
            <p role="alert" className="error-message">
              {preview.error}
            </p>
          )}
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
          {team && changed.length > 0 && (
            <section>
              <h3>{t('RefreshAgentsDialog.settingsChanged')}</h3>
              <ul>
                {changed.map((agent) => (
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
              {updateExisting && <p>{t('AgentRefresh.restartHint')}</p>}
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
          {(diff.added.length > 0 || changed.length > 0 || diff.missing.length > 0) && (
            <p>{t('RefreshAgentsDialog.existingOutputFilesArePreserved')}</p>
          )}
        </div>
      </Modal>
      {confirmation && (
        <RefreshRestartConfirmation
          review={confirmation}
          busy={busy}
          onClose={() => setConfirmation(null)}
          onConfirm={() => {
            const review = confirmation;
            setConfirmation(null);
            setChecking(true);
            void apply(review).finally(() => setChecking(false));
          }}
        />
      )}
    </>
  );
}
