import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { TeamWorkspaceMode } from '../../../../shared/agentTeams';
import { useState } from 'react';
import { FileInput, FileOutput, Pencil, Trash2 } from 'lucide-react';
import { TeamIcon } from './TeamIcon';
import { Disclosure } from '@/shared/ui/Disclosure';
import { ActionMenu } from '@/shared/ui/ActionMenu';
import { useConfirm } from '@/shared/model/Confirm';
import { useTeamTransfers } from '../model/TeamTransfers';
import { IconButton } from '@/shared/ui';
import { TeamNameDialog } from './TeamNameDialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AddArea } from '@/shared/ui/AddArea';
import { useAgentProfiles } from '../model/AgentProfiles';
import { AgentListItem } from './AgentListItem';
import { useNotice } from '@/shared/model/Notice';
import { Tooltip } from '@/shared/ui/Tooltip';
import { cx } from '@/shared/ui';
import { AgentListLabel } from './AgentListLabel';
import { SetupAssistantAction } from './SetupAssistantAction';

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
    moveAgent,
    removeAgent,
    restoreAgent,
  } = useAgentProfiles();
  const { demo } = useNotice();
  const { confirm } = useConfirm();
  const transfer = useTeamTransfers();
  const [naming, setNaming] = useState<{
    id?: string;
    name?: string;
    workspaceMode?: TeamWorkspaceMode;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorder = ({ active, over }: DragEndEvent) => {
    if (over) moveAgent(String(active.id), String(over.id));
  };
  return (
    <nav className="section-menu" aria-label={t('AgentList.agentBuilder')}>
      <h2 className="agent-list-group-heading column-heading">{t('AgentList.myTeams')}</h2>
      {teams.map((team, teamIndex) => {
        const profiles = team.agentIds.flatMap(
          (id) => agents.find((agent) => agent.id === id) ?? [],
        );
        return (
          <div className="agent-team" key={team.id} data-team-id={team.id}>
            <Disclosure
              label={team.name}
              icon={TeamIcon}
              defaultOpen
              actions={
                <>
                  <IconButton
                    title={t('AgentList.teamSettings', { name: team.name })}
                    className="team-rename"
                    onClick={() =>
                      setNaming({ id: team.id, name: team.name, workspaceMode: team.workspaceMode })
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
                        label: t('AgentList.importTeam'),
                        icon: FileInput,
                        disabled: !transfer.available,
                        onSelect: () => void transfer.importTeam(true),
                      },
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
                            title: t('AgentList.deleteTeam2', { value1: team.name }),
                            description: t('AgentList.theTeamAndItsAgentsWillBe'),
                            onConfirm: () => {
                              removeTeam(team.id);
                              demo(t('AgentList.teamDeleted', { value1: team.name }), {
                                label: t('useResourceUnlink.undo'),
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={reorder}
                accessibility={{
                  screenReaderInstructions: {
                    draggable: t('AgentList.spacePicksUpAnAgentArrowKeys'),
                  },
                }}
              >
                <SortableContext items={profiles} strategy={verticalListSortingStrategy}>
                  {profiles.map((agent, index) => (
                    <AgentListItem
                      key={agent.id}
                      agent={agent}
                      position={index + 1}
                      selected={selectedAgent?.id === agent.id}
                      onSelect={() => setAgentId(agent.id)}
                      onDelete={() => {
                        removeAgent(agent.id);
                        demo(t('AgentList.agentRemovedFromTheBuilder', { value1: agent.name }), {
                          label: t('useResourceUnlink.undo'),
                          onClick: () => restoreAgent(agent, index, team.id),
                        });
                      }}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              <AddArea
                className="agent-team-add"
                label={t('AgentList.addAnAgentTo', { value1: team.name })}
                onClick={() => addAgent(team.id)}
              />
            </Disclosure>
          </div>
        );
      })}
      <AddArea
        label={t('AgentList.createTeam')}
        showLabel
        className="agent-team-create"
        onClick={() => setNaming({})}
      />
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
      <h2 className="agent-list-group-heading column-heading">{t('AgentList.system')}</h2>
      {systemAgents.map((agent, index) => (
        <div className="agent-list-entry" key={agent.id} data-system-role={agent.systemRole}>
          <Tooltip
            label={agent.name || t('AgentList.untitled')}
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
                value1: agent.name || t('AgentList.untitled'),
                value2: agent.enabled ? t('AgentList.enabled') : t('reasoning.off'),
              })}
              aria-current={selectedAgent?.id === agent.id ? 'true' : undefined}
              onClick={() => setAgentId(agent.id)}
            >
              <AgentListLabel agent={agent} position={index + 1} />
            </button>
          </Tooltip>
          {agent.systemRole === 'assistant' && <SetupAssistantAction enabled={agent.enabled} />}
        </div>
      ))}
    </nav>
  );
}
