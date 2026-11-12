import { useState } from 'react';
import { StartAgentDialog } from './StartAgentDialog';
import { FolderOpen, MessageSquare, Play } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { SplitButton } from '@/shared/ui/SplitButton';
import { useWorkspace } from '../model/Workspace';
import { Tooltip } from '@/shared/ui/Tooltip';
import { useNotice } from '@/shared/model/Notice';
import type { OutputFile, ProjectAgent } from '../model/workspace.types';
import { getAgentLaunchAction } from '../model/session';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { getCurrentAgentInstructions } from '../model/snapshot';
import {
  getPreviewCapabilities,
  getPreviewKind,
  type PreviewKind,
} from '../model/previewCapabilities';

export function AgentToolbar({
  agent,
  file,
  filePath,
  previewKind,
}: {
  agent: ProjectAgent;
  file?: OutputFile;
  filePath?: string;
  previewKind?: PreviewKind;
}) {
  const { demo } = useNotice();
  const { setAutoContinue } = useWorkspace();
  const { agents } = useAgentProfiles();
  const [startOpen, setStartOpen] = useState(false);
  const [continueAfterRun, setContinueAfterRun] = useState(false);
  const hasSession = !!agent.session;
  const kind = previewKind ?? (file ? getPreviewKind(file) : undefined);
  const revealInFinder = file && kind && getPreviewCapabilities(kind).revealInFinder;
  const launch = (autoContinue: boolean) => {
    if (!getCurrentAgentInstructions(agent.profile.id, agents)) {
      demo('Профиль агента удалён. Текущие инструкции недоступны; другой агент не подставляется.');
      return;
    }
    const action = getAgentLaunchAction(agent);
    if (action.kind === 'blocked') {
      demo(action.reason);
      return;
    }
    setContinueAfterRun(autoContinue);
    if (action.kind === 'start') {
      setStartOpen(true);
      return;
    }
    setAutoContinue(autoContinue);
    demo(
      `Pi не подключён. Будет открыт диалог ${action.session.path} без отправки сообщения${action.session.needsFork ? '; перед открытием требуется штатное ветвление в текущую папку проекта' : ''}.${autoContinue ? ' Цепочка ожидает нового запроса в Pi и подтверждённого завершения этапа.' : ''}`,
    );
  };
  return (
    <div
      className="project-agent-toolbar"
      role="toolbar"
      aria-label="Инструменты выбранного агента"
    >
      {file && (
        <Tooltip label={filePath ?? file.name}>
          <code className="project-active-file">{filePath ?? file.name}</code>
        </Tooltip>
      )}
      <div className="project-agent-toolbar-actions">
        {revealInFinder && (
          <IconButton
            title="Показать в Finder"
            onClick={() =>
              demo(
                `Файл «${file.name}» будет выделен в Finder. Доступ к проектным файлам пока не подключён.`,
              )
            }
          >
            <FolderOpen size={19} />
          </IconButton>
        )}

        <SplitButton
          menuLabel="Другие варианты запуска"
          label={hasSession ? 'Продолжить диалог' : 'Запустить'}
          icon={hasSession ? <MessageSquare size={17} /> : <Play size={17} />}
          disabled={!agent.profile.enabled}
          onClick={() => launch(false)}
          actions={[{ label: 'Запустить и продолжить', onSelect: () => launch(true) }]}
        />
      </div>
      {startOpen && (
        <StartAgentDialog
          agent={agent}
          autoContinue={continueAfterRun}
          onClose={() => setStartOpen(false)}
        />
      )}
    </div>
  );
}
