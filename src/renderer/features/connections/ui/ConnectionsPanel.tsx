import { agentName } from '@/shared/model/localizedProfiles';
import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { AddArea } from '@/shared/ui/AddArea';
import { Button } from '@/shared/ui';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { useNotice } from '@/shared/model/Notice';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useWorkspace } from '@/features/project/model/Workspace';
import { useConnections, type Connection } from '../model/Connections';
import { ConnectionEditor } from './ConnectionEditor';
import { ImageToolSettings } from './ImageToolSettings';
export function ConnectionsPanel() {
  useTranslation(undefined, { i18n });
  const {
    connections,
    saveConnection,
    removeConnection,
    imageTool,
    providerStatuses,
    imageStatuses,
  } = useConnections();
  const { agents, systemAgents } = useAgentProfiles();
  const { projects } = useWorkspace();
  const { demo } = useNotice();
  const [edit, setEdit] = useState<Connection | null>(null);
  return (
    <>
      <h2>{t('ConnectionsPanel.connections')}</h2>
      <p>{t('ConnectionsPanel.eachAgentHasOneModelAndOne')}</p>
      <div className="resource-catalog">
        {connections.map((connection) => {
          const uses = (agent: Pick<(typeof agents)[number], 'model'>) =>
            agent.model?.connectionId === connection.id;
          const users = [...agents, ...systemAgents].filter(uses).map(agentName);
          const projectUsers = projects
            .filter((project) => project.agents.some((agent) => uses(agent.profile)))
            .map((project) => project.name);
          return (
            <div className="resource-row" key={connection.id} data-removable>
              <div>
                <strong>{connection.name}</strong>
                <p>
                  {connection.purpose === 'local' || connection.purpose === 'compatible'
                    ? connection.endpoint
                    : connection.providerId}{' '}
                  ·{' '}
                  {connection.purpose === 'codex'
                    ? t('ConnectionsPanel.subscription')
                    : connection.purpose === 'images'
                      ? t('ConnectionsPanel.paidApi')
                      : t('ConnectionsPanel.piSignInMethod')}
                  {connection.purpose !== 'images' &&
                    t('ConnectionsPanel.summary', {
                      value1:
                        connection.authScope === 'connection'
                          ? t('ConnectionsPanel.separateLogin')
                          : t('ConnectionEditor.sharedPiLogin'),
                    })}
                </p>
                <small>
                  {connection.purpose === 'images'
                    ? imageStatuses[connection.id]?.authentication === 'ready'
                      ? t('ConnectionsPanel.keyAcceptedByTheApi')
                      : imageStatuses[connection.id]?.authentication === 'invalid'
                        ? t('ConnectionsPanel.apiAuthenticationError')
                        : imageStatuses[connection.id]?.authentication === 'restricted'
                          ? t('ConnectionsPanel.apiAccessRestrictedCheckPermissions')
                          : imageStatuses[connection.id]?.keyStored
                            ? t('ConnectionsPanel.keySavedAuthenticationUnchecked')
                            : t('ConnectionsPanel.noSavedApiKey')
                    : providerStatuses[connection.id] === 'ready'
                      ? t('ConnectionsPanel.connected')
                      : providerStatuses[connection.id] === 'not_ready'
                        ? t('ConnectionsPanel.piSignInRequired')
                        : providerStatuses[connection.id] === 'invalid'
                          ? t('ConnectionsPanel.piAuthenticationError')
                          : providerStatuses[connection.id] === 'checking'
                            ? t('ConnectionsPanel.checkingConnection')
                            : providerStatuses[connection.id] === 'unavailable'
                              ? t('ConnectionsPanel.couldNotCheckTheConnection')
                              : t('ConnectionsPanel.authenticationUnchecked')}
                </small>
              </div>
              <Button onClick={() => setEdit(connection)}>{t('ConnectionsPanel.configure')}</Button>
              <HoverDeleteButton
                label={uiText('ConnectionsPanel.deleteConnection', { value1: connection.name })}
                description={uiText(
                  'ConnectionsPanel.agentsProjectsImageGenerationToolReferencesWill',
                  {
                    value1: users.join(', ') || t('ConnectionsPanel.none'),
                    value2: projectUsers.join(', ') || t('ConnectionsPanel.none'),
                    value3:
                      imageTool.connectionId === connection.id
                        ? t('ConnectionsPanel.usesThisConnection')
                        : t('ConnectionsPanel.doesNotUseIt'),
                  },
                )}
                onDelete={() => {
                  removeConnection(connection.id);
                  demo(uiText('ConnectionsPanel.connectionRecordDeleted'), {
                    label: uiText('useResourceUnlink.undo'),
                    onClick: () => saveConnection(connection),
                  });
                }}
              />
            </div>
          );
        })}
        <AddArea
          label={t('ConnectionEditor.addConnection')}
          onClick={() =>
            setEdit({
              id: crypto.randomUUID(),
              name: '',
              purpose: 'pi',
              authScope: 'connection',
              providerId: '',
              endpoint: '',
              account: '',
              createdAt: Date.now(),
            })
          }
        />
        {edit && <ConnectionEditor key={edit.id} connection={edit} onClose={() => setEdit(null)} />}
      </div>
      <ImageToolSettings />
    </>
  );
}
