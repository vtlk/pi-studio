import { t } from '../../shared/i18n/index.ts';
import { isSharedTaskPath } from '../../shared/agentPaths.ts';
import { readJson, safePath } from './files.ts';

/** A shared project exposes task files at its root; service state is never previewable output. */
export async function outputScope(root: string, path: string) {
  const legacy = /^(agents\/[a-zA-Z0-9_-]+\/output)\/(.+)$/.exec(path);
  if (legacy) return { prefix: legacy[1], relative: legacy[2] };
  if (isSharedTaskPath(path)) {
    const project = (await readJson(await safePath(root, 'project.json'))) as {
      workspaceMode?: string;
    };
    if (project.workspaceMode === 'shared') return { prefix: '', relative: path };
  }
  throw new Error(t('error.outputScope.theFileIsOutsideThe'));
}
