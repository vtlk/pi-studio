import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';
import type { OutputFile } from '../model/workspace.types';

export function CopyOutputButton({ file, projectId }: { file: OutputFile; projectId?: string }) {
  useTranslation(undefined, { i18n });
  const [busy, setBusy] = useState(false);
  const { demo } = useNotice();
  const copy = async () => {
    if (typeof file.content !== 'string') return;
    setBusy(true);
    try {
      if (window.studio) {
        if (!projectId || !file.diskPath || !file.fingerprint) throw new Error('Missing file');
        await window.studio.copyOutput({
          projectId,
          path: file.diskPath,
          fingerprint: file.fingerprint,
        });
      } else await navigator.clipboard.writeText(file.content);
      demo(uiText('CopyOutputButton.contentsOfCopied', { value1: file.name }));
    } catch {
      demo(uiText('CopyOutputButton.couldNotCopySelectTheFileAgain', { value1: file.name }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <IconButton
      title={t('CopyOutputButton.copy')}
      className="copy-output-button"
      disabled={busy || typeof file.content !== 'string'}
      onClick={() => void copy()}
    >
      <Copy size={18} aria-hidden="true" />
    </IconButton>
  );
}
