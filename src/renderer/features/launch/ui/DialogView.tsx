import { useLaunch } from '../model/Launch';
import { NewProjectDialog } from './dialogs/NewProjectDialog';
import { PromptDialog } from './dialogs/PromptDialog';
export function DialogView() {
  const { dialog } = useLaunch();
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'new-project':
      return <NewProjectDialog />;
    case 'prompt':
      return <PromptDialog />;
  }
}
