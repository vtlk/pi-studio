import { useState } from 'react';
import type { ProjectAgent } from '../model/workspace.types';
import { listOutputFiles } from '../model/outputTree';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
import { useElementWidth } from '@/shared/ui/useElementWidth';
import { OutputPreview } from './OutputPreview';
import { MontageCard } from '@/features/editor/ui/MontageCard';
import { useWorkspace } from '../model/Workspace';
import { OutputFileTree } from './OutputFileTree';
import { ArtifactPreview } from './ArtifactPreview';
import { OutputToolbar } from './OutputToolbar';
import { useOutputFile } from '../model/useOutputFile';
import { useStorage } from '@/shared/storage/Storage';
import { useVideoInspection } from '@/features/editor/model/useVideoInspection';
import { NativeMontageCard } from '@/features/editor/ui/NativeMontageCard';
import { DeleteAgentDataButton } from './DeleteAgentDataButton';
import { Tooltip } from '@/shared/ui/Tooltip';

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
  const { isDesktop } = useStorage();
  const { ref, width } = useElementWidth();
  const files = listOutputFiles(agent.entries);
  const [fileId, setFileId] = useState('');
  const selected = files.find(({ file }) => file.id === fileId) ?? files[0];
  const projectId = selectedProject?.id;
  const { file: loadedFile, loading, error } = useOutputFile(projectId, selected?.file);
  const selectedFile = loadedFile ?? selected?.file;
  const nativeManifestPath =
    isDesktop && selectedFile?.name.endsWith('.pistudio.json') ? selectedFile.diskPath : undefined;
  const filesVersion = files.map(({ file }) => `${file.diskPath}:${file.fingerprint}`).join('|');
  const nativeVideo = useVideoInspection(projectId, nativeManifestPath, filesVersion);
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
          <Tooltip label="Файлы агента" onlyWhenTruncated>
            <h2>Файлы агента</h2>
          </Tooltip>
          <DeleteAgentDataButton agent={agent} />
        </div>
        <OutputFileTree
          entries={agent.entries}
          selectedFileId={selected?.file.id ?? ''}
          onSelectFile={setFileId}
        />
      </aside>
      <ResizeHandle
        label="Ширина колонки файлов"
        value={actualWidth}
        min={140}
        max={max}
        onChange={onTreeWidthChange}
      />
      <div className="output-preview-pane">
        <OutputToolbar
          file={selected?.file}
          filePath={selected ? [agent.outputPath, ...selected.path].join('/') : undefined}
        />
        <div className="output-browser-content">
          {loading ? (
            <p className="output-empty" role="status">
              Читаем файл…
            </p>
          ) : error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : selected && selectedFile ? (
            <div className="output-file-preview">
              {nativeManifestPath && projectId ? (
                <NativeMontageCard
                  key={`${projectId}:${nativeManifestPath}`}
                  result={nativeVideo}
                  documentKey={`${projectId}:${nativeManifestPath}`}
                />
              ) : !isDesktop && selected.file.name.endsWith('.pistudio.json') && selectedProject ? (
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
                    <OutputPreview
                      key={`${selectedFile.id}:${selectedFile.fingerprint}`}
                      file={selectedFile}
                    />
                  )}
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
