import { uiText } from '@/shared/model/UiText';
import { agentName } from '@/shared/model/localizedProfiles';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { TeamWorkspaceMode } from '../../../../shared/agentTeams';
import { Fragment, useState } from 'react';
import { FileInput, FileOutput, Pencil, Trash2 } from 'lucide-react';
import { Disclosure } from '@/shared/ui/Disclosure';
import { ActionMenu } from '@/shared/ui/ActionMenu';
import { useConfirm } from '@/shared/model/Confirm';
import { useTeamTransfers } from '../model/TeamTransfers';
import { IconButton } from '@/shared/ui';
import { TeamNameDialog } from './TeamNameDialog';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useAgentTeamDrag } from '../model/useAgentTeamDrag';
import { AgentTeamDropTarget } from './AgentTeamDropTarget';
import { AgentTeamTransferDialog } from './AgentTeamTransferDialog';
import { AddArea } from '@/shared/ui/AddArea';
import { useAgentProfiles } from '../model/AgentProfiles';
import { AgentDragOverlay } from './AgentDragOverlay';
import { AgentListItem } from './AgentListItem';
import { useNotice } from '@/shared/model/Notice';
import { Tooltip } from '@/shared/ui/Tooltip';
import { cx } from '@/shared/ui';
import { AgentListLabel } from './AgentListLabel';
import { useTeamDisclosure } from '../model/useTeamDisclosure';
import { SetupAssistantAction } from './SetupAssistantAction';
import { useChatPanels } from '@/features/chat/ChatPanels.context';

export function AgentList() {
  useTranslation(undefined, { i18n });
  const {
    agents,
    teams,
    addTeam,
    renameTeam,
    removeTeam,
    restoreTeam,
    systemAgents,
    selectedAgent,
    setAgentId,
    addAgent,
    removeAgent,
    restoreAgent,
  } = useAgentProfiles();
  const { demo } = useNotice();
  const { confirm } = useConfirm();
  const transfer = useTeamTransfers();
  const disclosure = useTeamDisclosure();
  const [naming, setNaming] = useState<{
    id?: string;
    name?: string;
    workspaceMode?: TeamWorkspaceMode;
  } | null>(null);
  const drag = useAgentTeamDrag();
  const chats = useChatPanels();
  const selectAgent = (id: string) => {
    setAgentId(id);
    if (chats.target?.projectId === 'pi-setup-assistant') chats.hideFor(chats.target);
  };
  return (
    <nav className="section-menu" aria-label={t('AgentList.agentBuilder')}>
      <DndContext
        {...drag.context}
        accessibility={{
          screenReaderInstructions: { draggable: t('AgentList.spacePicksUpAnAgentArrowKeys') },
        }}
      >
        <div className="agent-teams-scroll">
          <div className="agent-teams-heading column-heading">
            <h2 className="agent-list-group-heading">{t('AgentList.myTeams')}</h2>
            <IconButton
              title={t('AgentList.importTeam')}
              disabled={transfer.busy || !transfer.available}
              onClick={() => void transfer.importTeam(true)}
            >
              <FileInput size={17} />
            </IconButton>
          </div>
          {teams.map((team, teamIndex) => {
            const profiles = team.agentIds.flatMap(
              (id) => agents.find((agent) => agent.id === id) ?? [],
            );
            return (
              <AgentTeamDropTarget
                key={team.id}
                id={team.id}
                highlighted={drag.insertion?.targetTeamId === team.id}
              >
                <Disclosure
                  label={team.name}
                  chevronPosition="start"
                  separator
                  open={disclosure.isOpen(team.id)}
                  onOpenChange={(open) => disclosure.setOpen(team.id, open)}
                  actions={
                    <>
                      <IconButton
                        title={t('AgentList.settingsForTeam', { value1: team.name })}
                        className="team-rename"
                        onClick={() =>
                          setNaming({
                            id: team.id,
                            name: team.name,
                            workspaceMode: team.workspaceMode,
                          })
                        }
                      >
                        <Pencil size={16} />
                      </IconButton>
                      <ActionMenu
                        label={t('AgentList.actionsForTeam', { value1: team.name })}
                        className="team-actions-menu"
                        disabled={transfer.busy}
                        actions={[
                          {
                            label: t('AgentList.exportTeam'),
                            icon: FileOutput,
                            disabled: !transfer.available,
                            onSelect: () => void transfer.exportTeam(team.id, true),
                          },
                          {
                            label: t('AgentList.deleteTeam'),
                            icon: Trash2,
                            separator: true,
                            danger: true,
                            onSelect: () =>
                              confirm({
                                title: uiText('AgentList.deleteTeam2', { value1: team.name }),
                                description: uiText('AgentList.theTeamAndItsAgentsWillBe'),
                                onConfirm: () => {
                                  removeTeam(team.id);
                                  demo(uiText('AgentList.teamDeleted', { value1: team.name }), {
                                    label: uiText('useResourceUnlink.undo'),
                                    onClick: () => restoreTeam(team, profiles, teamIndex),
                                  });
                                },
                              }),
                          },
                        ]}
                      />
                    </>
                  }
                >
                  <SortableContext items={profiles} strategy={verticalListSortingStrategy}>
                    {profiles.map((agent, index) => (
                      <Fragment key={agent.id}>
                        {drag.insertion?.targetTeamId === team.id &&
                          drag.insertion.beforeId === agent.id && (
                            <div
                              className="agent-drop-marker"
                              data-insert-before="true"
                              aria-hidden="true"
                            />
                          )}
                        <AgentListItem
                          agent={agent}
                          position={index + 1}
                          teamId={team.id}
                          selected={selectedAgent?.id === agent.id}
                          onSelect={() => selectAgent(agent.id)}
                          onDelete={() => {
                            removeAgent(agent.id);
                            demo(
                              uiText('AgentList.agentRemovedFromTheBuilder', {
                                value1: agent.name,
                              }),
                              {
                                label: uiText('useResourceUnlink.undo'),
                                onClick: () => restoreAgent(agent, index, team.id),
                              },
                            );
                          }}
                        />
                      </Fragment>
                    ))}
                  </SortableContext>
                  {drag.insertion?.targetTeamId === team.id && !drag.insertion.beforeId && (
                    <div className="agent-drop-marker" aria-hidden="true" />
                  )}
                  <AddArea
                    className="agent-team-add"
                    label={t('AgentList.addAnAgentTo', { value1: team.name })}
                    onClick={() => addAgent(team.id)}
                  />
                </Disclosure>
              </AgentTeamDropTarget>
            );
          })}
          <AddArea
            label={t('AgentList.createTeam')}
            showLabel
            className="agent-team-create"
            onClick={() => setNaming({})}
          />
        </div>
        <AgentDragOverlay
          agent={drag.activeAgent}
          position={drag.activePosition}
          selected={selectedAgent?.id === drag.activeAgent?.id}
        />
      </DndContext>
      {drag.pending && (
        <AgentTeamTransferDialog
          name={drag.pending.agent.name}
          team={drag.pending.target.name}
          onClose={drag.cancel}
          onChoose={(copy) => {
            drag.confirm(copy);
            disclosure.setOpen(drag.pending!.target.id, true);
          }}
        />
      )}
      {naming && (
        <TeamNameDialog
          name={naming.name}
          workspaceMode={naming.workspaceMode}
          onClose={() => setNaming(null)}
          onSave={(name, workspaceMode) => {
            if (naming.id) renameTeam(naming.id, name, workspaceMode);
            else addTeam(name, workspaceMode);
          }}
        />
      )}
      <div className="agent-system-list">
        <h2 className="agent-list-group-heading column-heading">{t('AgentList.system')}</h2>
        {systemAgents.map((agent, index) => (
          <div className="agent-list-entry" key={agent.id} data-system-role={agent.systemRole}>
            <Tooltip
              label={agentName(agent) || t('AgentList.untitled')}
              onlyWhenTruncated
              overflowSelector=".agent-list-name"
            >
              <button
                type="button"
                className={cx(
                  'section-menu-item',
                  'agent-list-item',
                  selectedAgent?.id === agent.id && 'active',
                )}
                data-enabled={agent.enabled}
                aria-label={t('AgentList.summary', {
                  value1: agentName(agent) || t('AgentList.untitled'),
                  value2: agent.enabled ? t('AgentList.enabled') : t('AgentList.disabled'),
                })}
                aria-current={selectedAgent?.id === agent.id ? 'true' : undefined}
                onClick={() => selectAgent(agent.id)}
              >
                <AgentListLabel agent={agent} position={index + 1} />
              </button>
            </Tooltip>
            {agent.systemRole === 'assistant' && <SetupAssistantAction enabled={agent.enabled} />}
          </div>
        ))}
      </div>
    </nav>
  );
}
