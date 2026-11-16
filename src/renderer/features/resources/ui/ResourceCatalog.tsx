import { resourceLabel } from '@/shared/model/localizedResources';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import type { CapabilityKind } from '@/entities/studio/types';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useWorkspace } from '@/features/project/model/Workspace';
import { AddArea } from '@/shared/ui/AddArea';
import { Button } from '@/shared/ui';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { useNotice } from '@/shared/model/Notice';
import { useResources, type Resource } from '../model/Resources';
import { ResourceEditor } from './ResourceEditor';
import { ResourceActions } from './ResourceActions';
import { resourceStatus } from '../model/resourceStatus';
import { ManagedSkillEditor } from './ManagedSkillEditor';
import { builtinResources, builtinResource } from '../../../../shared/builtinResources';

export function ResourceCatalog({
  kind,
  onPick,
  attached = [],
}: {
  kind: CapabilityKind;
  onPick?: (id: string) => void;
  attached?: string[];
}) {
  useTranslation(undefined, { i18n });
  const { resources, removeResource, saveResource } = useResources();
  const { agents } = useAgentProfiles();
  const { projects } = useWorkspace();
  const { demo } = useNotice();
  const [edit, setEdit] = useState<Resource | null>(null);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [query, setQuery] = useState('');
  const importing = useRef(false);
  const catalog = !onPick
    ? [
        ...builtinResources.filter((item) => item.kind === kind),
        ...resources.filter((item) => !builtinResource(item.id)),
      ]
    : resources;
  const add = async () => {
    if (window.studio && kind === 'skills') {
      if (importing.current) return;
      importing.current = true;
      try {
        const resource = await window.studio.chooseSkill();
        if (resource) {
          saveResource(resource);
          demo(t('ResourceCatalog.localSkillAddedItHasNotBeen'));
        }
      } catch (error) {
        demo(error instanceof Error ? error.message : t('ResourceCatalog.couldNotImportTheSkill'));
      } finally {
        importing.current = false;
      }
      return;
    }
    setEdit({
      id: crypto.randomUUID(),
      name: '',
      kind,
      source: '',
      version: '',
      description: '',
      transport: 'HTTP',
      args: '',
      credential: '',
      contents: '',
      createdAt: Date.now(),
    });
  };
  const usage = (resource: Resource) => {
    const users = agents
      .filter((agent) => agent[kind].includes(resource.id))
      .map((agent) => agent.name);
    const snapshots = projects
      .filter((project) =>
        project.agents.some((agent) => agent.profile[kind].includes(resource.id)),
      )
      .map((project) => project.name);
    return t('ResourceCatalog.agentsProjectsTheirReferencesAndResultsAre', {
      value1: users.join(', ') || t('ConnectionsPanel.none'),
      value2: snapshots.join(', ') || t('ConnectionsPanel.none'),
    });
  };
  const addArea = (
    <AddArea
      label={
        kind === 'skills'
          ? t('ResourceCatalog.addSkill')
          : kind === 'mcps'
            ? t('ResourceCatalog.addMcpServer')
            : t('ResourceCatalog.addPiPackage')
      }
      onClick={window.studio && kind === 'skills' ? undefined : () => void add()}
      actions={
        window.studio && kind === 'skills'
          ? [
              { label: t('TeamNameDialog.create'), onSelect: () => setCreatingSkill(true) },
              { label: t('ResourceCatalog.import'), onSelect: () => void add() },
            ]
          : undefined
      }
    />
  );
  return (
    <div className="resource-catalog">
      {!onPick && addArea}
      <label className="field-label">
        {t('ResourceCatalog.searchCatalog')}
        <input value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {catalog
        .filter(
          (item) =>
            item.kind === kind &&
            (resourceLabel(item, 'name') ?? '').toLowerCase().includes(query.toLowerCase()),
        )
        .map((resource) => (
          <div
            className="resource-row"
            key={resource.id}
            data-removable={builtinResource(resource.id) ? undefined : true}
          >
            <div>
              <div className="resource-heading">
                <strong>{resourceLabel(resource, 'name')}</strong>
                <small>
                  {builtinResource(resource.id)
                    ? t('ResourceCatalog.builtInIncludedWithPiStudio')
                    : resourceStatus(resource, !!window.studio)}
                </small>
              </div>
              <p>{resourceLabel(resource, 'description')}</p>
              {!builtinResource(resource.id) && <ResourceActions resource={resource} />}
            </div>
            <Button onClick={() => setEdit(resource)}>
              {builtinResource(resource.id)
                ? t('ResourceCatalog.details')
                : kind === 'skills'
                  ? resource.managedSkill
                    ? t('ResourceCatalog.edit')
                    : t('ResourceCatalog.details')
                  : t('ConnectionsPanel.configure')}
            </Button>
            {onPick && (
              <Button
                kind="primary"
                disabled={attached.includes(resource.id)}
                onClick={() => onPick(resource.id)}
              >
                {attached.includes(resource.id) ? t('McpPicker.added') : t('McpPicker.addToAgent')}
              </Button>
            )}
            {!onPick && !builtinResource(resource.id) && (
              <HoverDeleteButton
                label={t('ResourceCatalog.deleteResource', {
                  value1: resourceLabel(resource, 'name'),
                })}
                description={usage(resource)}
                onDelete={() => {
                  removeResource(kind, resource.id);
                  demo(t('ResourceCatalog.resourceRemovedFromCatalogSourceFilesPreserved'), {
                    label: t('useResourceUnlink.undo'),
                    onClick: () => saveResource(resource),
                  });
                }}
              />
            )}
          </div>
        ))}
      {onPick && addArea}
      {edit && <ResourceEditor key={edit.id} resource={edit} onClose={() => setEdit(null)} />}
      {creatingSkill && <ManagedSkillEditor onClose={() => setCreatingSkill(false)} />}
    </div>
  );
}
