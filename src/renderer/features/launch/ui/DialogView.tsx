import { useLaunch } from '../model/Launch';
import { NewProjectDialog } from './dialogs/NewProjectDialog';
import { AgentActionDialog } from './dialogs/AgentActionDialog';
import { PickerDialog } from './dialogs/PickerDialog';
import { PromptDialog } from './dialogs/PromptDialog';
export function DialogView() {
  const { dialog } = useLaunch();
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'new-project':
      return <NewProjectDialog />;
    case 'new-asset':
    case 'run':
      return (
        <AgentActionDialog
          key={`${dialog.kind}:${dialog.agentId}:${dialog.title}`}
          request={dialog}
        />
      );
    case 'picker':
      return <PickerDialog request={dialog} />;
    case 'prompt':
      return <PromptDialog />;
  }
}
