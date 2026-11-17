import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
  atomicJson,
  readJson,
  exists,
  type UpdateJob,
} from '../../../bundled/update-helper/protocol.mjs';
import type { UpdateView } from '../../shared/updates.ts';

export function parseUpdateView(value: unknown): UpdateView | undefined {
  if (!value || typeof value !== 'object' || !('page' in value) || typeof value.page !== 'string')
    return;
  if (!['projects', 'project', 'agents', 'settings', 'onboarding'].includes(value.page))
    return { page: 'projects' };
  const projectId = 'projectId' in value ? value.projectId : undefined;
  if (projectId !== undefined && (typeof projectId !== 'string' || projectId.length > 200)) return;
  return { page: value.page as UpdateView['page'], projectId: projectId as string | undefined };
}
export async function saveUpdateView(
  userData: string,
  from: string,
  to: string,
  folder: string,
  view?: UpdateView,
) {
  await mkdir(join(userData, 'updates'), { recursive: true, mode: 0o700 });
  await atomicJson(join(userData, 'updates/view.json'), {
    schema: 1,
    from,
    to,
    folder,
    view: parseUpdateView(view),
  });
}
export async function restoreUpdateView(job: UpdateJob, folder: string) {
  const file = join(job.userData, 'updates/view.json');
  if (!(await exists(file))) return;
  const record = await readJson(file);
  if (
    record.schema !== 1 ||
    record.folder !== folder ||
    record.from !== job.oldVersion ||
    record.to !== job.version
  )
    return;
  return parseUpdateView(record.view);
}
