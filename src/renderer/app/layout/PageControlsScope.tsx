import type { ReactNode } from 'react';
import { useNavigation } from '@/shared/model/Navigation';
import { ControlScopeContext } from '@/shared/ui/ControlScope.context';

export function PageControlsScope({ children }: { children: ReactNode }) {
  const { page } = useNavigation();
  return (
    <ControlScopeContext.Provider
      value={page === 'projects' || page === 'project' ? 'projects' : undefined}
    >
      {children}
    </ControlScopeContext.Provider>
  );
}
