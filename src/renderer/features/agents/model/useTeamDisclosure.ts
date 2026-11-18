import { useState } from 'react';
import { useStorage } from '@/shared/storage/Storage';

/** Local presentation preference, scoped to the studio and stable team IDs, never exported. */
export function useTeamDisclosure() {
  const { bootstrap } = useStorage();
  const key = `pistudio:collapsed-teams:v1:${bootstrap?.folder ?? 'preview'}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      return new Set(
        Array.isArray(saved) ? saved.filter((id) => typeof id === 'string').slice(0, 1000) : [],
      );
    } catch {
      return new Set();
    }
  });
  const setOpen = (id: string, open: boolean) => {
    const next = new Set(collapsed);
    if (open) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      // Presentation stays usable when browser storage is unavailable.
    }
  };
  return { isOpen: (id: string) => !collapsed.has(id), setOpen };
}
