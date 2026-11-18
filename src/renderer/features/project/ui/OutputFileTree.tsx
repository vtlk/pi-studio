import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import {
  ChevronRight,
  File,
  FileImage,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Music2,
} from 'lucide-react';
import type { OutputEntry } from '../model/workspace.types';
import { listOutputFiles, sortOutputEntries } from '../model/outputTree';
import { cx } from '@/shared/ui';
import { RevealFileButton } from './RevealFileButton';
import { Tooltip } from '@/shared/ui/Tooltip';

const icons = {
  unsupported: File,
  text: FileText,
  markdown: FileText,
  json: FileText,
  image: FileImage,
  audio: Music2,
  video: Film,
};
interface TreeProps {
  entries: OutputEntry[];
  selectedFileId: string;
  onSelectFile: (id: string) => void;
  projectId?: string;
}
function TreeItem({
  entry,
  selectedFileId,
  onSelectFile,
  projectId,
}: Omit<TreeProps, 'entries'> & { entry: OutputEntry }) {
  useTranslation(undefined, { i18n });
  const selectedInside =
    entry.kind === 'folder' &&
    listOutputFiles(entry.children).some(({ file }) => file.id === selectedFileId);
  const [open, setOpen] = useState(selectedInside);
  useEffect(() => {
    if (selectedInside) setOpen(true);
  }, [selectedInside, selectedFileId]);
  if (entry.kind === 'folder') {
    const Icon = open ? FolderOpen : Folder;
    return (
      <li>
        <Tooltip label={entry.name} onlyWhenTruncated overflowSelector="span">
          <button
            className="file-tree-item file-tree-folder"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRight size={14} className={cx('file-tree-chevron', open && 'open')} />
            <Icon size={17} />
            <span>{entry.name}</span>
          </button>
        </Tooltip>
        {open && (
          <ul className="file-tree-group">
            {sortOutputEntries(entry.children).map((child) => (
              <TreeItem
                key={child.id}
                entry={child}
                selectedFileId={selectedFileId}
                onSelectFile={onSelectFile}
                projectId={projectId}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const Icon = icons[entry.format];
  return (
    <li className="file-tree-file-row" data-selected={selectedFileId === entry.id || undefined}>
      <Tooltip label={entry.name} onlyWhenTruncated overflowSelector="span">
        <button
          className={cx('file-tree-item', selectedFileId === entry.id && 'active')}
          aria-current={selectedFileId === entry.id ? 'true' : undefined}
          onClick={() => onSelectFile(entry.id)}
        >
          <Icon size={17} />
          <span>{entry.name}</span>
        </button>
      </Tooltip>
      {projectId && entry.diskPath && (
        <RevealFileButton projectId={projectId} path={entry.diskPath} />
      )}
    </li>
  );
}
export function OutputFileTree({ entries, selectedFileId, onSelectFile, projectId }: TreeProps) {
  useTranslation(undefined, { i18n });
  return (
    <nav className="output-file-tree" aria-label={t('OutputFileTree.agentFilesAndFolders')}>
      <ul>
        {sortOutputEntries(entries).map((entry) => (
          <TreeItem
            key={entry.id}
            entry={entry}
            selectedFileId={selectedFileId}
            onSelectFile={onSelectFile}
            projectId={projectId}
          />
        ))}
      </ul>
    </nav>
  );
}
