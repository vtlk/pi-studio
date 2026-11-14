import { ChevronRight, Copy, Folder, LoaderCircle, Pencil } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { Tooltip } from '@/shared/ui/Tooltip';
import type { WorkspaceProject } from '../model/workspace.types';
import { UsageMetrics } from './UsageMetrics';
import { durationText, usageText } from '../model/usageFormat';

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function ProjectListRow({
  project,
  busy,
  fileCount,
  runningAgents = 0,
  activityUnavailable = false,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: WorkspaceProject;
  busy: boolean;
  fileCount?: number | null;
  runningAgents?: number;
  activityUnavailable?: boolean;
  onOpen: () => void;
  onEdit: (mode: 'clone' | 'rename') => void;
  onDelete: () => void;
}) {
  const folder = project.folderName ?? project.id;
  const folderLabel = `${usageText(project.usage?.duration, durationText)} · ${folder}`;
  const created = new Date(project.createdAt);
  const activityLabel = activityUnavailable
    ? 'Статус работы недоступен'
    : runningAgents > 1
      ? 'Агенты работают'
      : runningAgents === 1
        ? 'Агент работает'
        : '';
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
          aria-label={`Открыть проект «${project.name}»${activityLabel ? `. ${activityLabel}` : ''}`}
          aria-describedby={`project-folder-${project.id}`}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <span className="project-folder-icon">
            {runningAgents > 0 ? (
              <LoaderCircle
                className="project-active-spinner"
                size={25}
                strokeWidth={1.7}
                aria-hidden="true"
              />
            ) : (
              <Folder size={25} strokeWidth={1.7} aria-hidden="true" />
            )}
          </span>
          <span className="project-identity">
            <Tooltip label={project.name} onlyWhenTruncated>
              <strong className="project-list-name">{project.name}</strong>
            </Tooltip>
            <Tooltip label={folderLabel} onlyWhenTruncated>
              <span
                className="project-list-folder"
                id={`project-folder-${project.id}`}
                aria-label={`Время работы: ${project.usage?.duration.value == null ? 'неизвестно' : `${Math.floor(project.usage.duration.value / 1000)} секунд${project.usage.duration.partial ? ', частичные данные' : ''}`}. Папка: ${folder}`}
              >
                {folderLabel}
              </span>
            </Tooltip>
          </span>
        </button>
      </td>
      <td className="project-spent">
        <UsageMetrics usage={project.usage} includeTime={false} />
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
