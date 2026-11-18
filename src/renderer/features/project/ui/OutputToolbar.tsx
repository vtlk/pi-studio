import { WrapText } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { t } from '../../../../shared/i18n';
import { useCodePreviewOptions } from '../model/CodePreviewOptions';
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
  const code = useCodePreviewOptions();
  return (
    <div className="project-file-toolbar pane-toolbar">
      {file && (
        <Tooltip label={filePath ?? file.name} onlyWhenTruncated>
          <code className="project-active-file">{filePath ?? file.name}</code>
        </Tooltip>
      )}
      {code?.active && (
        <IconButton
          className="preview-wrap-button"
          title={code.wrap ? t('CodePreview.disableWrap') : t('CodePreview.enableWrap')}
          pressed={code.wrap}
          onClick={code.toggle}
        >
          <WrapText size={18} />
        </IconButton>
      )}
      {file && ['text', 'markdown', 'json'].includes(file.format) && (
        <CopyOutputButton file={file} projectId={projectId} />
      )}
    </div>
  );
}
