import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from '../../shared/i18n/index.ts';
import { isSharedTaskPath } from '../../shared/agentPaths.ts';
import { isMissing, readJson, safePath, withReadDeadline } from '../storage/files.ts';

const statIfPresent = (file: string) =>
  lstat(file).catch((error) => {
    if (isMissing(error)) return;
    throw error;
  });

export function isAgentResultPath(path: string) {
  return (
    path.length <= 1000 &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path
      .split('/')
      .every((part) => part && !part.startsWith('.') && part.toLowerCase() !== 'node_modules')
  );
}

export function safeSharedResults(root: string, projectId: string, agentId: string) {
  return withReadDeadline(async () => {
    const context = await safePath(root, '.pistudio/context', true);
    const dirs = await readdir(context, { withFileTypes: true }).catch((error) => {
      if (isMissing(error)) return [];
      throw error;
    });
    if (dirs.length > 10000) throw Error(t('HelperInspection.tooManyRuns'));
    let latest: { completedAt: number; outputs: { path: string; size: number }[] } | undefined;
    for (const dir of dirs) {
      if (!dir.isDirectory() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(dir.name)) continue;
      const folder = await safePath(root, `.pistudio/context/${dir.name}`);
      const saved = join(folder, 'agent-result.json');
      const savedInfo = await statIfPresent(saved);
      const result = savedInfo ? saved : join(folder, 'result.json');
      const info = savedInfo ?? (await statIfPresent(result));
      if (!info?.isFile() || info.mtimeMs <= (latest?.completedAt ?? -1)) continue;
      const run = (await readJson(join(folder, 'context.json'))) as {
        agentId?: string;
        projectId?: string;
        runId?: string;
        workspaceMode?: string;
      } | null;
      if (
        run?.agentId !== agentId ||
        run.projectId !== projectId ||
        run.runId !== dir.name ||
        run.workspaceMode !== 'shared'
      )
        continue;
      const complete = (await readJson(result)) as {
        runId?: string;
        status?: string;
        outputs?: { path: string; size: number }[];
      } | null;
      if (
        complete?.runId !== dir.name ||
        complete.status !== 'ready' ||
        !Array.isArray(complete.outputs) ||
        complete.outputs.length > 100
      )
        continue;
      const outputs = complete.outputs
        .filter(
          (item) =>
            typeof item?.path === 'string' &&
            isAgentResultPath(item.path) &&
            isSharedTaskPath(item.path) &&
            Number.isSafeInteger(item.size) &&
            item.size > 0,
        )
        .map(({ path, size }) => ({ path, size }));
      latest = { completedAt: info.mtimeMs, outputs };
    }
    return latest;
  });
}

export function matchesSharedResult(
  { size, mtimeMs, ctimeMs }: { size: number; mtimeMs: number; ctimeMs: number },
  declaredSize: number,
  completedAt: number,
) {
  return size === declaredSize && Math.max(mtimeMs, ctimeMs) <= completedAt;
}
