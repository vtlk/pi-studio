import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, Play } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { useOpenSetupAssistant } from '@/features/setup-assistant/model/useOpenSetupAssistant';
import { SetupAssistantError } from '@/features/setup-assistant/ui/SetupAssistantError';

export function SetupAssistantAction({ enabled }: { enabled: boolean }) {
  useTranslation(undefined, { i18n });
  const { open, opening, error, clearError } = useOpenSetupAssistant();
  return (
    <>
      <IconButton
        className="agent-helper-launch"
        title={opening ? t('AgentActions.openingPi') : t('SetupAssistantAction.openAssistantInPi')}
        disabled={!enabled}
        busy={opening}
        onClick={() => void open()}
      >
        {opening ? (
          <LoaderCircle size={17} className="project-launch-spinner" aria-hidden="true" />
        ) : (
          <Play size={17} aria-hidden="true" />
        )}
      </IconButton>
      <SetupAssistantError error={error} onClose={clearError} />
    </>
  );
}
