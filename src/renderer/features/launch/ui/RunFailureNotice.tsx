import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { useStorage } from '@/shared/storage/Storage';
import {
  terminalCloseDetail,
  type RunFailureNotice as Failure,
} from '../../../../shared/runFailure';

import { failureMessage, terminalMessage } from '@/shared/model/localizedFailures';

export function RunFailureNotice() {
  useTranslation(undefined, { i18n });
  const { bootstrap } = useStorage();
  const [notice, setNotice] = useState<Failure>();
  const folder = bootstrap?.folder;
  useEffect(
    () =>
      window.studio?.onRunFailure((value) => {
        if (!folder || !value.projectRoot.startsWith(`${folder}/`)) return;
        if (value.failure) setNotice(value);
        else
          setNotice((previous) =>
            previous?.agentId === value.agentId && previous.projectId === value.projectId
              ? undefined
              : previous,
          );
      }),
    [folder],
  );
  if (!notice?.failure || !folder || !notice.projectRoot.startsWith(`${folder}/`)) return null;
  return (
    <div className="run-failure-notice error-message" role="alert">
      <span>
        «{notice.agentName}»: {failureMessage(notice.failure)}
        {notice.failure === 'terminal_close' &&
          terminalCloseDetail(notice.terminalDetail) &&
          ' ' + terminalMessage(notice.terminalDetail!)}
      </span>
      <IconButton
        title={t('RunFailureNotice.dismissAgentError')}
        onClick={() => setNotice(undefined)}
      >
        <X size={16} />
      </IconButton>
    </div>
  );
}
