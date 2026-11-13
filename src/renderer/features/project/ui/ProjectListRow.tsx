import { ChevronRight, Copy, Folder, Pencil } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { Tooltip } from '@/shared/ui/Tooltip';
import type { WorkspaceProject } from '../model/workspace.types';

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function ProjectListRow({
  project,
  busy,
  fileCount,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: WorkspaceProject;
  busy: boolean;
  fileCount?: number | null;
  onOpen: () => void;
  onEdit: (mode: 'clone' | 'rename') => void;
  onDelete: () => void;
}) {
  const folder = project.folderName ?? project.id;
  const created = new Date(project.createdAt);
  return (
    <tr
      className="project-list-item"
      onClick={() => {
        if (!busy) onOpen();
      }}
    >
      <td>
        <button
          type="button"
          className="project-list-row"
          aria-label={`Открыть проект «${project.name}»`}
          aria-describedby={`project-folder-${project.id}`}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <span className="project-folder-icon">
            <Folder size={25} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <span className="project-identity">
            <Tooltip label={project.name} onlyWhenTruncated>
              <strong className="project-list-name">{project.name}</strong>
            </Tooltip>
            <Tooltip label={folder} onlyWhenTruncated>
              <span className="project-list-folder" id={`project-folder-${project.id}`}>
                {folder}
              </span>
            </Tooltip>
          </span>
        </button>
      </td>
      <td className="project-created">
        <time dateTime={created.toISOString()}>
          {dateFormat.format(created).replace(/\s*г\.$/, '')}
        </time>
      </td>
      <td className="project-number">{project.agents.length}</td>
      <td className="project-number">
        {fileCount === null ? (
          <Tooltip label="Не удалось прочитать файлы проекта.">
            <span>—</span>
          </Tooltip>
        ) : (
          (fileCount ?? '…')
        )}
      </td>
      <td className="project-actions-cell">
        <div
          className="project-row-actions"
          data-removable
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button')) event.stopPropagation();
          }}
        >
          <IconButton
            title={`Переименовать ${project.name}`}
            disabled={busy}
            onClick={() => onEdit('rename')}
          >
            <Pencil size={19} />
          </IconButton>
          <IconButton
            title={`Клонировать ${project.name}`}
            disabled={busy}
            onClick={() => onEdit('clone')}
          >
            <Copy size={19} />
          </IconButton>
          <HoverDeleteButton
            label={`Удалить проект «${project.name}»`}
            disabled={busy}
            description="Проект и все его файлы будут перемещены в корзину студии. Его можно восстановить."
            onDelete={onDelete}
          />
        </div>
      </td>
      <td className="project-arrow-cell">
        <ChevronRight size={20} aria-hidden="true" />
      </td>
    </tr>
  );
}
