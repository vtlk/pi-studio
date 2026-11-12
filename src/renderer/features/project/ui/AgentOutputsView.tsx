import { useMemo, useState } from 'react';
import type { ProjectAgent } from '../model/workspace.types';
import { listOutputFiles } from '../model/outputTree';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
import { useElementWidth } from '@/shared/ui/useElementWidth';
import { OutputPreview } from './OutputPreview';
import { MontageCard } from '@/features/editor/ui/MontageCard';
import { useWorkspace } from '../model/Workspace';
import { OutputFileTree } from './OutputFileTree';
import { ArtifactPreview } from './ArtifactPreview';
import { OutputReview } from './OutputReview';
import { AgentToolbar } from './AgentToolbar';
import { inspectManifest } from '@/features/editor/model/manifest';

export function AgentOutputsView({
  agent,
  treeWidth,
  onTreeWidthChange,
}: {
  agent: ProjectAgent;
  treeWidth: number;
  onTreeWidthChange: (value: number) => void;
}) {
  const { selectedProject } = useWorkspace();
  const { ref, width } = useElementWidth();
  const files = listOutputFiles(agent.entries);
  const [fileId, setFileId] = useState('');
  const selected = files.find(({ file }) => file.id === fileId) ?? files[0];
  const selectedFile = selected?.file;
  const projectId = selectedProject?.id;
  const previewKind = useMemo(
    () =>
      projectId &&
      selectedFile?.name.endsWith('.pistudio.json') &&
      inspectManifest(selectedFile, agent.entries).ok
        ? 'montage'
        : undefined,
    [projectId, selectedFile, agent.entries],
  );
  const max = Math.max(140, (width || 600) - 240);
  const actualWidth = Math.min(treeWidth, max);
  return (
    <div
      className="output-browser"
      ref={ref}
      style={{ gridTemplateColumns: `${actualWidth}px 8px minmax(0, 1fr)` }}
    >
      <OutputFileTree
        entries={agent.entries}
        selectedFileId={selected?.file.id ?? ''}
        onSelectFile={setFileId}
      />
      <ResizeHandle
        label="Ширина колонки файлов"
        value={actualWidth}
        min={140}
        max={max}
        onChange={onTreeWidthChange}
      />
      <div className="output-preview-pane">
        <AgentToolbar
          agent={agent}
          file={selected?.file}
          previewKind={previewKind}
          filePath={selected ? [agent.outputPath, ...selected.path].join('/') : undefined}
        />
        <div className="output-browser-content">
          {selected ? (
            <div className="output-file-preview">
              {selected.file.name.endsWith('.pistudio.json') && selectedProject ? (
                <MontageCard
                  key={selected.file.id}
                  file={selected.file}
                  path={selected.path}
                  agent={agent}
                  projectId={selectedProject.id}
                />
              ) : (
                <>
                  {selected.file.artifact ? (
                    <ArtifactPreview file={selected.file} agent={agent} />
                  ) : (
                    <OutputPreview key={selected.file.id} file={selected.file} />
                  )}
                  <OutputReview file={selected.file} agent={agent} />
                </>
              )}
            </div>
          ) : (
            <p className="output-empty">Выходных файлов пока нет.</p>
          )}
        </div>
      </div>
    </div>
  );
}
