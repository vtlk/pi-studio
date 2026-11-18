import { useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { IconButton } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';

export function RevealFileButton({ projectId, path }: { projectId: string; path: string }) {
  useTranslation(undefined, { i18n });
  const { demo } = useNotice();
  const [busy, setBusy] = useState(false);
  return (
    <IconButton
      title={
        navigator.platform.startsWith('Win')
          ? t('AgentActions.showInExplorer')
          : t('AgentActions.showInFinder')
      }
      className="file-tree-reveal"
      disabled={busy}
      onClick={() => {
        if (busy || !window.studio) return;
        setBusy(true);
        void window.studio
          .revealOutput({ projectId, path })
          .catch(() => demo(t('OutputFileTree.couldNotRevealFile')))
          .finally(() => setBusy(false));
      }}
    >
      <LocateFixed size={16} aria-hidden="true" />
    </IconButton>
  );
}
