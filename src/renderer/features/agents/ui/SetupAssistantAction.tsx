import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';
import { useOpenSetupAssistant } from '@/features/setup-assistant/model/useOpenSetupAssistant';

export function SetupAssistantAction({ enabled }: { enabled: boolean }) {
  useTranslation(undefined, { i18n });
  const { open, opening } = useOpenSetupAssistant();
  const { demo } = useNotice();
  return (
    <IconButton
      className="agent-helper-launch"
      title={t('SetupAssistantAction.openAssistantInPi')}
      disabled={!enabled || opening}
      onClick={() =>
        void open().then((error) => {
          if (error) demo(error);
        })
      }
    >
      <Play size={17} aria-hidden="true" />
    </IconButton>
  );
}
