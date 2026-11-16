import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { useAgentProfiles } from './AgentProfiles';
import { useStorage } from '@/shared/storage/Storage';
import { useNotice } from '@/shared/model/Notice';

export function useResourceUnlink() {
  useTranslation(undefined, { i18n });
  const { selectedAgent, updateAgent } = useAgentProfiles();
  const { saveNow, isDesktop } = useStorage();
  const { demo } = useNotice();
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const unlink = async (field: 'mcps' | 'skills' | 'plugins', id: string) => {
    if (!selectedAgent || active.current) return;
    const position = selectedAgent[field].indexOf(id);
    if (position < 0) return;
    active.current = true;
    setBusy(true);
    // updateAgent captures the stable selected profile ID; Undo must not follow later selection.
    const restore = () => {
      updateAgent((current) => {
        if (current[field].includes(id)) return {};
        const links = [...current[field]];
        links.splice(Math.min(position, links.length), 0, id);
        return { [field]: links };
      });
      if (isDesktop)
        void saveNow().then((saved) => {
          if (!saved) demo(t('useResourceUnlink.theAssignmentWasNotSavedCheckThe'));
        });
    };
    try {
      updateAgent((current) => ({ [field]: current[field].filter((item) => item !== id) }));
      if (isDesktop && !(await saveNow())) {
        demo(t('useResourceUnlink.unlinkingWasNotSavedMcpAccessMay'), {
          label: t('useResourceUnlink.restoreAssignment'),
          onClick: restore,
        });
        return;
      }
      demo(t('useResourceUnlink.resourceUnlinked'), {
        label: t('useResourceUnlink.undo'),
        onClick: restore,
      });
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return { busy, unlink };
}
