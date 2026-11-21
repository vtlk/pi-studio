import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { TeamTransfersContext } from './TeamTransfers.context';
import { useStorage } from '@/shared/storage/Storage';
import { useNotice } from '@/shared/model/Notice';
import { useAgentProfiles } from './AgentProfiles';
import { useNavigation } from '@/shared/model/Navigation';
import { AgentConfigurationDialog } from '@/features/project/ui/AgentConfigurationDialog';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { TeamTransferFeedback } from '../ui/TeamTransferFeedback';
import type { TeamImportReport, TeamSetupResult } from '../../../../shared/teamPackage';

export interface TeamTransfersValue {
  busy: boolean;
  loaded: boolean;
  refreshReports(): Promise<void>;
  available: boolean;
  message: string;
  error: string;
  clearError(): void;
  reports: TeamImportReport[];
  exportTeam(id: string, notify?: boolean): Promise<void>;
  importTeam(notify?: boolean): Promise<void>;
  continueImport(id: string): Promise<void>;
}
export function TeamTransfersProvider({ children }: { children: ReactNode }) {
  useTranslation(undefined, { i18n });
  const { bootstrap, saveNow } = useStorage();
  const { teams } = useAgentProfiles();
  const { navigate } = useNavigation();
  const { demo } = useNotice();
  const folder = bootstrap?.folder;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reports, setReports] = useState<TeamImportReport[]>([]);
  const [loaded, setLoaded] = useState(!window.studio);
  const [configure, setConfigure] = useState('');
  const [onboardingTeam, setOnboardingTeam] = useState('');
  const [setupOffer, setSetupOffer] = useState<TeamImportReport>();
  const [details, setDetails] = useState(false);
  const active = useRef(false),
    mounted = useRef(false),
    epoch = useRef(0);
  const refreshReports = useCallback(async () => {
    if (!window.studio || !folder) return;
    const readEpoch = epoch.current;
    try {
      const value = await window.studio.listTeamImports(folder);
      if (mounted.current && !active.current && epoch.current === readEpoch) {
        setReports(value);
        setLoaded(true);
      }
    } catch (error) {
      if (mounted.current && epoch.current === readEpoch)
        setMessage(error instanceof Error ? error.message : t('TeamTransfers.couldNotReadImports'));
    }
  }, [folder]);
  useEffect(() => {
    mounted.current = true;
    void refreshReports();
    return () => {
      mounted.current = false;
    };
  }, [refreshReports]);
  useEffect(() => {
    // Imported profiles arrive through the shared storage refresh. Do not open an empty page
    // before those profiles have reached the providers that calculate setup tasks.
    if (onboardingTeam && teams.some((team) => team.id === onboardingTeam)) {
      navigate('onboarding');
      setOnboardingTeam('');
    }
  }, [onboardingTeam, teams, navigate]);
  const receive = (result: TeamSetupResult) => {
    setReports((previous) => [
      result.report,
      ...previous.filter((report) => report.id !== result.report.id),
    ]);
    if (result.outcome === 'needs_configuration') {
      setDetails(false);
      setConfigure(result.assistantId);
    }
    const message =
      result.message ??
      (result.outcome === 'pending' && result.report.handoff === 'pending'
        ? t('Onboarding.imported')
        : result.outcome === 'opened'
          ? t('TeamTransfers.packageSavedTheAssistantIsOpenTo')
          : result.outcome === 'needs_configuration'
            ? t('TeamTransfers.packageSavedConfigureTheAssistantSModel')
            : t('TeamTransfers.packageSavedTaskDeliveryIsUnconfirmedIt'));
    if (
      result.outcome === 'busy' ||
      result.outcome === 'uncertain' ||
      (result.outcome === 'pending' && result.message)
    )
      setError(message);
    return message;
  };
  const action = async (
    task: () => Promise<string | undefined>,
    notify = false,
    offerImportReport = true,
    reportError?: (message: string) => void,
  ) => {
    if (active.current || !window.studio || !folder) return;
    active.current = true;
    epoch.current++;
    setBusy(true);
    setMessage('');
    reportError?.('');
    let text: string | undefined;
    try {
      if (!(await saveNow())) throw new Error(t('TeamTransfers.waitForSettingsToFinishSaving'));
      if (!mounted.current) return;
      text = await task();
    } catch (error) {
      text =
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : t('TeamTransfers.theOperationDidNotComplete');
      reportError?.(text);
    } finally {
      active.current = false;
      if (mounted.current) {
        setBusy(false);
        void refreshReports();
      }
    }
    if (!mounted.current || !text) return;
    setMessage(text);
    if (notify)
      demo(
        text,
        offerImportReport
          ? {
              label: uiText('TeamTransfers.report'),
              onClick: () => {
                setDetails(true);
                void refreshReports();
              },
            }
          : undefined,
      );
  };
  const value: TeamTransfersValue = {
    busy,
    loaded,
    error,
    clearError: () => setError(''),
    refreshReports,
    available: !!window.studio && !!folder,
    message,
    reports,
    exportTeam: (id, notify) =>
      action(
        async () => {
          // The stable ID is captured by the row, not inferred from a label or selected profile.
          if (!teams.some((team) => team.id === id))
            throw new Error(t('TeamTransfers.theTeamIsUnavailable'));
          const result = await window.studio!.exportAgentTeam({ folder: folder!, teamId: id });
          return result ? t('TeamTransfers.teamSaved') : undefined;
        },
        notify,
        false,
      ),
    importTeam: (notify) =>
      action(async () => {
        const result = await window.studio!.importAgentTeam(folder!);
        if (result && mounted.current) {
          setOnboardingTeam(result.report.teamId);
          setSetupOffer(result.report);
        }
        return result && mounted.current ? receive(result) : undefined;
      }, notify),
    continueImport: (id) =>
      action(
        async () => {
          const result = await window.studio!.continueTeamImport({ folder: folder!, id });
          return mounted.current ? receive(result) : undefined;
        },
        false,
        true,
        setError,
      ),
  };
  return (
    <TeamTransfersContext.Provider value={value}>
      {children}
      {setupOffer && (
        <Modal
          title={t('TeamTransfers.setUpImportedTeam', { name: setupOffer.teamName })}
          onClose={() => setSetupOffer(undefined)}
          footer={
            <>
              <Button onClick={() => setSetupOffer(undefined)}>{t('UpdateAction.later')}</Button>
              <Button
                kind="primary"
                disabled={busy}
                onClick={() => {
                  setSetupOffer(undefined);
                  void value.continueImport(setupOffer.id);
                }}
              >
                {t('Onboarding.withAssistant')}
              </Button>
            </>
          }
        >
          <p>{t('TeamTransfers.importSetupDescription')}</p>
        </Modal>
      )}
      {details && !configure && (
        <Modal
          title={t('TeamTransfers.transferTeams')}
          onClose={() => setDetails(false)}
          footer={<Button onClick={() => setDetails(false)}>{t('TeamTransfers.close')}</Button>}
        >
          <TeamTransferFeedback {...value} />
        </Modal>
      )}
      {configure && (
        <AgentConfigurationDialog agentId={configure} onClose={() => setConfigure('')} />
      )}
    </TeamTransfersContext.Provider>
  );
}
export function useTeamTransfers() {
  useTranslation(undefined, { i18n });
  const value = useContext(TeamTransfersContext);
  if (!value) throw new Error('TeamTransfersProvider is missing');
  return value;
}
