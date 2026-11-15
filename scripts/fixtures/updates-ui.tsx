/** UI-only fixture providers. Never imported by either application entry or packaged. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UpdatesProvider, useUpdates } from '../../src/renderer/features/updates/Updates';
import { UpdateAction, UpdateDialog } from '../../src/renderer/features/updates/UpdateAction';
import { StorageContext } from '../../src/renderer/shared/storage/Storage.context';
import { NavigationContext } from '../../src/renderer/shared/model/Navigation.context';
import { WorkspaceContext } from '../../src/renderer/features/project/model/Workspace.context';
import { TooltipProvider } from '../../src/renderer/shared/ui/Tooltip';
import { Modal } from '../../src/renderer/shared/ui/Modal';
import '../../src/renderer/styles/index.css';

function Workbench() {
  const { frozen } = useUpdates();
  const [draftDialog, setDraftDialog] = useState(false);
  return (
    <>
      <main inert={frozen || undefined} style={{ padding: 30 }}>
        <input aria-label="Рабочее поле" defaultValue="SAVED FIXTURE" />
        <button onClick={() => setDraftDialog(true)}>Открыть черновик</button>
        <UpdateAction />
        {draftDialog && (
          <Modal title="Черновик QA" onClose={() => setDraftDialog(false)}>
            <textarea aria-label="Черновик" defaultValue="Не потерять" />
          </Modal>
        )}
      </main>
      <UpdateDialog />
    </>
  );
}
function Fixture() {
  const [page, setPage] = useState('projects');
  return (
    <TooltipProvider>
      <StorageContext.Provider
        value={{
          bootstrap: null,
          isDesktop: true,
          saving: false,
          error: '',
          chooseStudio: async () => {},
          openStudio: async () => {},
          save: () => {},
          retry: () => {},
          isPending: () => false,
          saveNow: async () => true,
        }}
      >
        <NavigationContext.Provider value={{ page, setPage, navigate: setPage }}>
          <WorkspaceContext.Provider value={{ selectedProject: { id: 'qa-project' } } as never}>
            <UpdatesProvider>
              <Workbench />
            </UpdatesProvider>
          </WorkspaceContext.Provider>
        </NavigationContext.Provider>
      </StorageContext.Provider>
    </TooltipProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
