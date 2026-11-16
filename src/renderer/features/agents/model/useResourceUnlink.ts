import { useRef, useState } from 'react';
import { useAgentProfiles } from './AgentProfiles';
import { useStorage } from '@/shared/storage/Storage';
import { useNotice } from '@/shared/model/Notice';

export function useResourceUnlink() {
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
          if (!saved) demo('Назначение не сохранено. Проверьте ошибку сохранения студии.');
        });
    };
    try {
      updateAgent((current) => ({ [field]: current[field].filter((item) => item !== id) }));
      if (isDesktop && !(await saveNow())) {
        demo(
          'Открепление не сохранено. Доступ к MCP может сохраняться; исправьте ошибку сохранения.',
          {
            label: 'Вернуть назначение',
            onClick: restore,
          },
        );
        return;
      }
      demo('Связь с ресурсом убрана.', { label: 'Вернуть', onClick: restore });
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return { busy, unlink };
}
