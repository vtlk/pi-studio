import { Tooltip } from '@/shared/ui/Tooltip';
import type { OutputFile } from '../model/workspace.types';
import { CopyOutputButton } from './CopyOutputButton';

export function OutputToolbar({
  file,
  filePath,
  projectId,
}: {
  file?: OutputFile;
  filePath?: string;
  projectId?: string;
}) {
  return (
    <div className="project-file-toolbar pane-toolbar">
      {file && (
        <Tooltip label={filePath ?? file.name} onlyWhenTruncated>
          <code className="project-active-file">{filePath ?? file.name}</code>
        </Tooltip>
      )}
      {file &&
        ['text', 'markdown', 'json'].includes(file.format) &&
        !file.name.endsWith('.pistudio.json') && (
          <CopyOutputButton file={file} projectId={projectId} />
        )}
    </div>
  );
}
