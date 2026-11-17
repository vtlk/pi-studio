import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { TeamTransfersContext } from './TeamTransfers.context';
import { useStorage } from '@/shared/storage/Storage';
import { useNotice } from '@/shared/model/Notice';
import { useAgentProfiles } from './AgentProfiles';
import { AgentConfigurationDialog } from '@/features/project/ui/AgentConfigurationDialog';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { TeamTransferFeedback } from '../ui/TeamTransferFeedback';
import type { TeamImportReport, TeamSetupResult } from '../../../../shared/teamPackage';

export interface TeamTransfersValue {
  busy: boolean;
  refreshReports(): Promise<void>;
  available: boolean;
  message: string;
  reports: TeamImportReport[];
  exportTeam(id: string, notify?: boolean): Promise<void>;
  importTeam(notify?: boolean): Promise<void>;
  continueImport(id: string): Promise<void>;
}
export function TeamTransfersProvider({ children }: { children: ReactNode }) {
  useTranslation(undefined, { i18n });
  const { bootstrap, saveNow } = useStorage();
  const { teams } = useAgentProfiles();
  const { demo } = useNotice();
  const folder = bootstrap?.folder;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reports, setReports] = useState<TeamImportReport[]>([]);
  const [configure, setConfigure] = useState('');
  const [details, setDetails] = useState(false);
  const active = useRef(false),
    mounted = useRef(false),
    epoch = useRef(0);
  const refreshReports = useCallback(async () => {
    if (!window.studio || !folder) return;
    const readEpoch = epoch.current;
    try {
      const value = await window.studio.listTeamImports(folder);
      if (mounted.current && !active.current && epoch.current === readEpoch) setReports(value);
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
  const receive = (result: TeamSetupResult) => {
    setReports((previous) => [
      result.report,
      ...previous.filter((report) => report.id !== result.report.id),
    ]);
    if (result.outcome === 'needs_configuration') {
      setDetails(false);
      setConfigure(result.assistantId);
    }
    return (
      result.message ??
      (result.outcome === 'opened'
        ? t('TeamTransfers.packageSavedTheAssistantIsOpenTo')
        : result.outcome === 'needs_configuration'
          ? t('TeamTransfers.packageSavedConfigureTheAssistantSModel')
          : t('TeamTransfers.packageSavedTaskDeliveryIsUnconfirmedIt'))
    );
  };
  const action = async (
    task: () => Promise<string | undefined>,
    notify = false,
    offerImportReport = true,
  ) => {
    if (active.current || !window.studio || !folder) return;
    active.current = true;
    epoch.current++;
    setBusy(true);
    setMessage('');
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
        return result && mounted.current ? receive(result) : undefined;
      }, notify),
    continueImport: (id) =>
      action(async () => {
        const result = await window.studio!.continueTeamImport({ folder: folder!, id });
        return mounted.current ? receive(result) : undefined;
      }),
  };
  return (
    <TeamTransfersContext.Provider value={value}>
      {children}
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
