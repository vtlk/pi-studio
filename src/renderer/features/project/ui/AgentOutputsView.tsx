import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { projectAgentOutputPath } from '../../../../shared/agentPaths';
import { useState } from 'react';
import type { ProjectAgent } from '../model/workspace.types';
import { listOutputFiles } from '../model/outputTree';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
import { useElementWidth } from '@/shared/ui/useElementWidth';
import { OutputPreview } from './OutputPreview';
import { useWorkspace } from '../model/Workspace';
import { OutputFileTree } from './OutputFileTree';
import { ArtifactPreview } from './ArtifactPreview';
import { OutputToolbar } from './OutputToolbar';
import { useOutputFile } from '../model/useOutputFile';
import { DeleteAgentDataButton } from './DeleteAgentDataButton';
import { Tooltip } from '@/shared/ui/Tooltip';
import { SearchablePreview } from './SearchablePreview';
import { getPreviewKind } from '../model/previewCapabilities';
import { AgentProfileEditor } from '@/features/agents/ui/AgentProfileEditor';

export function AgentOutputsView({
  agent,
  treeWidth,
  onTreeWidthChange,
  settingsAgentId,
  onCloseSettings,
}: {
  agent: ProjectAgent;
  treeWidth: number;
  onTreeWidthChange: (value: number) => void;
  settingsAgentId: string | null;
  onCloseSettings: () => void;
}) {
  useTranslation(undefined, { i18n });
  const { selectedProject } = useWorkspace();
  const { ref, width } = useElementWidth();
  const files = listOutputFiles(agent.entries);
  const [fileId, setFileId] = useState('');
  const selectFile = (id: string) => {
    onCloseSettings();
    setFileId(id);
  };
  const selected = files.find(({ file }) => file.id === fileId) ?? files[0];
  const projectId = selectedProject?.id;
  const shared = selectedProject?.workspaceMode === 'shared';
  const filesLabel = shared
    ? t('AgentOutputsView.sharedTeamFiles')
    : t('AgentOutputsView.agentFiles');
  const { file: loadedFile, loading, error } = useOutputFile(projectId, selected?.file);
  const selectedFile = loadedFile ?? selected?.file;
  const max = Math.max(140, (width || 600) - 240);
  const actualWidth = Math.min(treeWidth, max);
  return (
    <div
      className="output-browser"
      ref={ref}
      style={{ gridTemplateColumns: `${actualWidth}px 8px minmax(0, 1fr)` }}
    >
      <aside className="output-files-pane">
        <div className="project-column-heading output-files-heading">
          <Tooltip label={filesLabel} onlyWhenTruncated>
            <h2>{filesLabel}</h2>
          </Tooltip>
          <DeleteAgentDataButton agent={agent} />
        </div>
        <OutputFileTree
          entries={agent.entries}
          selectedFileId={settingsAgentId ? '' : (selected?.file.id ?? '')}
          onSelectFile={selectFile}
        />
      </aside>
      <ResizeHandle
        label={t('AgentOutputsView.fileColumnWidth')}
        value={actualWidth}
        min={140}
        max={max}
        onChange={onTreeWidthChange}
      />
      <div className="output-preview-pane">
        <div
          className="output-preview-content"
          inert={!!settingsAgentId}
          aria-hidden={settingsAgentId ? true : undefined}
        >
          <OutputToolbar
            file={selectedFile}
            projectId={projectId}
            filePath={
              selected
                ? [projectAgentOutputPath(selectedProject ?? {}, agent), ...selected.path]
                    .filter(Boolean)
                    .join('/')
                : undefined
            }
          />
          <SearchablePreview
            enabled={
              !settingsAgentId &&
              !!selectedFile &&
              ['text', 'markdown', 'json'].includes(getPreviewKind(selectedFile))
            }
            ready={!loading && !error}
            empty={!selectedFile?.content}
            documentKey={`${projectId}:${agent.profile.id}:${selectedFile?.id}:${selectedFile?.fingerprint}`}
          >
            {loading ? (
              <p className="output-empty" role="status">
                {t('AgentOutputsView.readingFile')}
              </p>
            ) : error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : selected && selectedFile ? (
              <div className="output-file-preview">
                {selected.file.artifact ? (
                  <ArtifactPreview file={selected.file} agent={agent} />
                ) : (
                  <OutputPreview
                    key={`${selectedFile.id}:${selectedFile.fingerprint}`}
                    file={selectedFile}
                    markdownFiles={
                      projectId && selectedFile.diskPath
                        ? {
                            projectId,
                            path: selectedFile.diskPath,
                            files: files.map(({ file }) => file),
                            onSelect: selectFile,
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            ) : (
              <p className="output-empty">{t('AgentOutputsView.noOutputFilesYet')}</p>
            )}
          </SearchablePreview>
        </div>
        {settingsAgentId && (
          <AgentProfileEditor key={settingsAgentId} agentId={settingsAgentId} inline />
        )}
      </div>
    </div>
  );
}
