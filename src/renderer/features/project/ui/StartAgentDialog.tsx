import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Textarea } from '@/shared/ui/Textarea';
import { useRef, useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { useNotice } from '@/shared/model/Notice';
import { useWorkspace } from '../model/Workspace';
import type { ProjectAgent } from '../model/workspace.types';
import { useStorage } from '@/shared/storage/Storage';
import { ReferenceAttachments, type ReferenceAttachment } from '@/shared/ui/ReferenceAttachments';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { validateAgentModel } from '../../../../shared/modelConfiguration';
import { AgentConfigurationDialog } from './AgentConfigurationDialog';

export function StartAgentDialog({
  agent,
  autoContinue,
  onOpeningChange,
  onOpenSettings,
  onClose,
}: {
  agent: ProjectAgent;
  autoContinue: boolean;
  onOpeningChange: (opening: boolean) => void;
  onOpenSettings: (agentId: string, tab?: string) => void;
  onClose: () => void;
}) {
  useTranslation(undefined, { i18n });
  const [message, setMessage] = useState('');
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [references, setReferences] = useState<ReferenceAttachment[]>([]);
  const { isDesktop } = useStorage();
  const { addSession } = useWorkspace();
  const { demo } = useNotice();
  const { agents } = useAgentProfiles();
  const { connections } = useConnections();

  const start = async () => {
    if (openingRef.current) return;
    const current = agents.find((profile) => profile.id === agent.profile.id);
    if (!validateAgentModel(current?.model, connections).ok) {
      setConfigurationOpen(true);
      return;
    }
    openingRef.current = true;
    setOpening(true);
    onOpeningChange(true);
    try {
      const session = await addSession(
        agent.profile.id,
        message,
        autoContinue,
        references.map((item) => item.id),
      );
      if (!session) return;
      onClose();
      if (!isDesktop) demo(t('StartAgentDialog.firstMessageAndDialogueBindingSavedIn'));
    } finally {
      openingRef.current = false;
      setOpening(false);
      onOpeningChange(false);
    }
  };

  return (
    <>
      <Modal
        inert={configurationOpen}
        title={t('StartAgentDialog.launch', {
          value1: agent.profile.name || t('AgentList.untitled'),
        })}
        onClose={() => {
          if (!opening) onClose();
        }}
        footer={
          <>
            <Button disabled={opening} onClick={onClose}>
              {t('TeamNameDialog.cancel')}
            </Button>
            <Button
              kind="primary"
              disabled={opening || !agent.profile.enabled || !message.trim()}
              onClick={() => void start()}
            >
              {opening
                ? t('AgentActions.openingPi')
                : autoContinue
                  ? t('AgentActions.launchAndContinue')
                  : t('AgentActions.launch')}
            </Button>
          </>
        }
      >
        <Textarea
          label={t('StartAgentDialog.firstMessage')}
          autoFocus
          className="agent-first-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t('StartAgentDialog.describeWhatTheAgentShouldDo')}
          aria-describedby="agent-first-message-help"
        />
        <ReferenceAttachments value={references} onChange={setReferences} disabled={opening} />
        <p id="agent-first-message-help" className="subtle">
          {t('StartAgentDialog.sentAsTheFirstMessageOfA')}
        </p>
      </Modal>
      {configurationOpen && (
        <AgentConfigurationDialog
          agentId={agent.profile.id}
          onConfigure={(id, tab) => {
            onClose();
            onOpenSettings(id, tab);
          }}
          onClose={() => setConfigurationOpen(false)}
        />
      )}
    </>
  );
}
