import { resourceVersion } from '@/shared/model/localizedResources';
import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Textarea } from '@/shared/ui/Textarea';
import { useState } from 'react';
import { Button, EmptyIntegration } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { Select } from '@/shared/ui/Select';
import { useNotice } from '@/shared/model/Notice';
import { useResources, type Resource } from '../model/Resources';
import { LocalSkillInfo } from './LocalSkillInfo';
import { ManagedSkillEditor } from './ManagedSkillEditor';
import { builtinResource } from '../../../../shared/builtinResources';
import { BuiltinResourceInfo } from './BuiltinResourceInfo';

export function ResourceEditor({ resource, onClose }: { resource: Resource; onClose: () => void }) {
  useTranslation(undefined, { i18n });
  const [draft, setDraft] = useState(resource);
  const { saveResource, resources } = useResources();
  const { demo } = useNotice();
  const field = (key: keyof Resource, label: string, placeholder = '') => (
    <label className="field-label">
      {label}
      <input
        value={String(draft[key])}
        placeholder={placeholder}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
      />
    </label>
  );
  const existingSkill =
    resource.kind === 'skills' &&
    resources.some((item) => item.kind === 'skills' && item.id === resource.id);
  const builtIn = builtinResource(resource.id);
  if (builtIn) return <BuiltinResourceInfo resource={builtIn} onClose={onClose} />;
  if (window.studio && resource.kind === 'skills' && resource.managedSkill)
    return <ManagedSkillEditor resource={resource} onClose={onClose} />;
  if (window.studio && resource.kind === 'skills' && resource.localSkill)
    return <LocalSkillInfo id={resource.id} name={resource.name} onClose={onClose} />;
  if (existingSkill)
    return (
      <Modal
        title={resource.name}
        onClose={onClose}
        footer={<Button onClick={onClose}>{t('TeamTransfers.close')}</Button>}
      >
        <p>{resource.description}</p>
        <dl className="data-list">
          <dt>{t('LocalSkillInfo.skillFolder')}</dt>
          <dd>{resource.source || t('ResourceEditor.notImported')}</dd>
          <dt>{t('ResourceEditor.version')}</dt>
          <dd>{resourceVersion(resource) || t('ResourceEditor.notPinned')}</dd>
          <dt>{t('ResourceEditor.contents')}</dt>
          <dd>{t('ResourceEditor.skillMdAndSupportingFiles')}</dd>
        </dl>
        <p className="subtle">{t('ResourceEditor.nameAndDescriptionAreReadFromSkill')}</p>
      </Modal>
    );
  return (
    <Modal
      title={resource.name || t('ResourceEditor.newResource')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('TeamNameDialog.cancel')}</Button>
          <Button
            kind="primary"
            disabled={!draft.name.trim()}
            onClick={() => {
              saveResource({
                ...draft,
                check:
                  draft.source === resource.source &&
                  draft.args === resource.args &&
                  draft.credential === resource.credential
                    ? resource.check
                    : undefined,
              });
              onClose();
            }}
          >
            {t('TeamNameDialog.save')}
          </Button>
        </>
      }
    >
      {field('name', t('ConnectionEditor.name'))}
      <Textarea
        label={t('ManagedSkillEditor.description')}
        value={draft.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
      />
      {draft.kind === 'mcps' ? (
        <>
          <label className="field-label">
            {t('ResourceEditor.transport')}
            <Select
              label={t('ResourceEditor.mcpTransport')}
              options={['HTTP', 'stdio']}
              value={draft.transport}
              onValueChange={(transport) => setDraft({ ...draft, transport })}
            />
          </label>
          {field(
            'source',
            draft.transport === 'HTTP'
              ? t('ResourceEditor.serverUrl')
              : t('ResourceEditor.executable'),
            draft.transport === 'HTTP' ? 'https://example.com/mcp' : '/path/to/server',
          )}
          {draft.transport === 'stdio' &&
            field(
              'args',
              t('ResourceEditor.launchArguments'),
              t('ResourceEditor.separateJsonArgumentsArray'),
            )}
          {!window.studio &&
            field(
              'credential',
              t('ResourceEditor.credentialReference'),
              t('ResourceEditor.forExampleKeychainHeygenNoToken'),
            )}
          {!window.studio && (
            <div className="action-row">
              <Button
                onClick={() =>
                  demo(uiText('ResourceEditor.mcpAuthenticationHasNotBeenPerformedThe'))
                }
              >
                {t('ResourceEditor.authenticate')}
              </Button>
              <Button
                onClick={() => demo(uiText('ResourceEditor.connectionNotCheckedMcpIsNotConnected'))}
              >
                {t('ClaudeCodeAuth.checkConnection')}
              </Button>
            </div>
          )}
          <p className="subtle">
            {window.studio
              ? t('ResourceEditor.forOauthAndOtherAuthenticationMethodsConnect')
              : t('ResourceEditor.exampleMcpNotConnectedNoSecretsEntered')}
          </p>
        </>
      ) : (
        <>
          {field(
            'source',
            draft.kind === 'skills'
              ? t('ResourceEditor.skillFolderSkillMd')
              : t('ResourceEditor.packageSourceNpmGitLocalFolder'),
          )}
          {draft.kind === 'plugins' &&
            !window.studio &&
            field('version', t('ResourceEditor.pinnedVersion'))}
          {draft.kind === 'plugins' && window.studio && (
            <p className="subtle">
              {t('ResourceEditor.installedVersion')}
              {resourceVersion(resource) || t('ResourceEditor.unknown')}
              {t('ResourceEditor.setThePackageVersionInItsSource')}
            </p>
          )}
          {draft.kind === 'plugins' && (
            <Textarea
              label={t('ResourceEditor.packageContents')}
              value={draft.contents}
              onChange={(event) => setDraft({ ...draft, contents: event.target.value })}
            />
          )}
          {!window.studio && (
            <Button
              onClick={() =>
                demo(
                  draft.kind === 'skills'
                    ? uiText('ResourceEditor.fileImportIsNotConnectedYetThe')
                    : uiText('ResourceEditor.packageInstallationIsNotConnectedYetSource'),
                )
              }
            >
              {draft.kind === 'skills'
                ? t('ResourceEditor.importFromFolder')
                : t('ResourceActions.installPackage')}
            </Button>
          )}
          <p className="subtle">
            {window.studio
              ? t('ResourceEditor.afterSavingInstallAndCheckThePackage')
              : t('ResourceEditor.exampleNotInstalled')}
          </p>
        </>
      )}
      <EmptyIntegration>
        {t('ResourceEditor.savingSettingsDoesNotInstallTheResource')}
      </EmptyIntegration>
    </Modal>
  );
}
