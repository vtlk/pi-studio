import type { ReactNode } from 'react';
import { useUpdates } from './Updates';
import { UpdateDialog } from './UpdateAction';
export function UpdateWorkspace({ children }: { children: ReactNode }) {
  const { frozen } = useUpdates();
  return (
    <>
      <div className="update-workspace" inert={frozen || undefined}>
        {children}
      </div>
      <UpdateDialog />
    </>
  );
}
