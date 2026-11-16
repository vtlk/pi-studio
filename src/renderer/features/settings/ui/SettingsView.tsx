import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Textarea } from '@/shared/ui/Textarea';
import { useState } from 'react';
import { useNotice } from '@/shared/model/Notice';
import { useProject } from '@/features/project/model/projectHooks';
import { Button, EmptyIntegration } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { SectionMenu } from '@/shared/ui/SectionMenu';
import { SetupAssistant } from '@/features/setup-assistant/ui/SetupAssistant';
import { useCoreTools } from '@/features/connections/model/useCoreTools';
import { ConnectionsPanel } from '@/features/connections/ui/ConnectionsPanel';
import { ResourceCatalog } from '@/features/resources/ui/ResourceCatalog';
import type { CapabilityKind } from '@/entities/studio/types';
import { useStorage, useStoredState } from '@/shared/storage/Storage';
import type { PiCheck } from '../../../../shared/contracts';
import { TeamTransferPanel } from '@/features/agents/ui/TeamTransferPanel';

function LegacyRules() {
  useTranslation(undefined, { i18n });
  const { baseInstruction, setBaseInstruction } = useProject();
  return (
    <>
      <h2>{t('SettingsView.sharedInstructions')}</h2>
      <Textarea
        aria-label={t('SettingsView.sharedProjectInstructions')}
        value={baseInstruction}
        onChange={(event) => setBaseInstruction(event.target.value)}
      />
      <p>{t('SettingsView.changesStayInWebPreviewMemory')}</p>
    </>
  );
}
export function SettingsView() {
  useTranslation(undefined, { i18n });
  const coreTools = useCoreTools();
  const { demo } = useNotice();
  const [section, setSection] = useState('workspace');
  const { bootstrap, isDesktop, openStudio, chooseStudio, saving } = useStorage();
  const [folder, setFolder] = useState(bootstrap?.folder ?? '');
  const [pi, setPi] = useStoredState('piPath', '');
  const [piCheck, setPiCheck] = useState<PiCheck>();
  const [checking, setChecking] = useState(false);
  return (
    <div className="page-body settings-layout">
      <SectionMenu
        label={t('SettingsView.studioSettings')}
        items={[
          { id: 'workspace', label: t('SettingsView.workspace') },
          { id: 'connections', label: t('ConnectionsPanel.connections') },
          { id: 'assistant', label: t('SettingsView.connectionAssistant') },
          { id: 'teams', label: t('TeamTransferPanel.agentTeams') },
          { id: 'skills', label: t('SettingsView.skillsCatalog') },
          { id: 'mcps', label: t('SettingsView.mcpServers') },
          { id: 'plugins', label: t('SettingsView.piPackages') },
          ...(!isDesktop ? [{ id: 'rules', label: t('SettingsView.sharedInstructions') }] : []),
        ]}
        selected={section}
        onSelect={setSection}
      />
      <section className="settings-content">
        {section === 'teams' ? (
          <TeamTransferPanel />
        ) : section === 'workspace' ? (
          <>
            <h2>{t('SettingsView.workspace')}</h2>
            <p>
              {isDesktop
                ? t('SettingsView.settingsAndProjectsAreSavedInThe')
                : t('SettingsView.webPreviewSettingsInMemory')}
            </p>
            <div className="settings-field-row">
              <label className="field-label">
                {t('SettingsView.studioFolder')}
                <input
                  placeholder="/Users/…/Pi Studio"
                  value={folder}
                  data-unsaved-draft={folder !== (bootstrap?.folder ?? '') || undefined}
                  onChange={(event) => setFolder(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && isDesktop) void openStudio(folder.trim());
                  }}
                />
              </label>
              <Button
                disabled={saving}
                onClick={() =>
                  isDesktop
                    ? void chooseStudio()
                    : demo(t('SettingsView.systemFolderSelectionIsAvailableInThe'))
                }
              >
                {t('SettingsView.chooseFolder')}
              </Button>
            </div>
            <label className="field-label">
              {t('SettingsView.piPath')}
              <input
                value={pi}
                onChange={(event) => setPi(event.target.value)}
                placeholder={t('SettingsView.piExecutable')}
              />
            </label>
            <div className="settings-field-row">
              <label className="field-label">
                {t('SettingsView.agentLaunch')}
                <Select
                  label={t('SettingsView.agentLaunch')}
                  options={[
                    {
                      value: 'terminal',
                      label: navigator.platform.startsWith('Win')
                        ? t('SettingsView.openWindowsTerminal')
                        : t('SettingsView.openMacosTerminal'),
                    },
                    { value: 'rpc', label: t('SettingsView.insideTheAppRpcLater'), disabled: true },
                  ]}
                />
              </label>
              <Button
                disabled={checking}
                onClick={async () => {
                  if (!window.studio) {
                    demo(t('SettingsView.piChecksAreAvailableInTheMacos'));
                    return;
                  }
                  setChecking(true);
                  setPiCheck(undefined);
                  try {
                    const result = await window.studio.checkPi(pi);
                    setPiCheck(result);
                    setPi(result.path);
                  } catch (error) {
                    demo(error instanceof Error ? error.message : t('SettingsView.piCheckError'));
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                {checking ? t('ResourceActions.checking') : t('SettingsView.checkPi')}
              </Button>
            </div>
            {piCheck && (
              <p role="status">
                Pi {piCheck.version} ·{' '}
                {piCheck.supported
                  ? t('SettingsView.supportedVersion')
                  : t('SettingsView.versionNotYetVerifiedWithStudio')}{' '}
                · MCP: {piCheck.nativeMcp ? t('SettingsView.builtIn') : t('SettingsView.notFound')}{' '}
                {t('SettingsView.exactSessions')}{' '}
                {piCheck.exactSessions
                  ? t('SettingsView.supported')
                  : t('SettingsView.unconfirmed')}
                {t('SettingsView.theCheckDoesNotStartGeneration')}
              </p>
            )}
            <p className="section-space">
              {t('SettingsView.sharedTools')}{' '}
              {coreTools.map((tool) => `${tool.name} — ${tool.status.toLowerCase()}`).join(', ')}.
            </p>
            <EmptyIntegration>
              {t('SettingsView.providerAuthenticationAndSecretsAreStoredSeparately')}
            </EmptyIntegration>
          </>
        ) : section === 'assistant' ? (
          <SetupAssistant />
        ) : section === 'connections' ? (
          <ConnectionsPanel />
        ) : section === 'rules' ? (
          <LegacyRules />
        ) : (
          <>
            <h2>
              {section === 'skills'
                ? t('SettingsView.skillsCatalog')
                : section === 'mcps'
                  ? t('SettingsView.mcpServers')
                  : t('SettingsView.piPackagesAndExtensions')}
            </h2>
            <p>{t('SettingsView.sharedStudioCatalogEachAgentHasIts')}</p>
            <ResourceCatalog key={section} kind={section as CapabilityKind} />
          </>
        )}
      </section>
    </div>
  );
}
