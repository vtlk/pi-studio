import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { useStorage } from '@/shared/storage/Storage';
import {
  runFailureMessages,
  type RunFailureNotice as Failure,
} from '../../../../shared/runFailure';

export function RunFailureNotice() {
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
        «{notice.agentName}»: {runFailureMessages[notice.failure]}
      </span>
      <IconButton title="Скрыть ошибку агента" onClick={() => setNotice(undefined)}>
        <X size={16} />
      </IconButton>
    </div>
  );
}
