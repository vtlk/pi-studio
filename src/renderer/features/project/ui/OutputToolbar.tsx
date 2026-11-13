import { Tooltip } from '@/shared/ui/Tooltip';
import type { OutputFile } from '../model/workspace.types';

export function OutputToolbar({ file, filePath }: { file?: OutputFile; filePath?: string }) {
  return (
    <div className="project-file-toolbar">
      {file && (
        <Tooltip label={filePath ?? file.name} onlyWhenTruncated>
          <code className="project-active-file">{filePath ?? file.name}</code>
        </Tooltip>
      )}
    </div>
  );
}
