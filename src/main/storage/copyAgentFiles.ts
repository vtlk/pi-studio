import { open, mkdir, rm, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import type { WorkspaceProject, ProjectAgent } from '../../shared/project.ts';
import { projectAgentOutputPath, isSharedTaskPath } from '../../shared/agentPaths.ts';
import { windowsFileName } from '../../shared/windowsNames.ts';
import { safePath } from './files.ts';
import { t } from '../../shared/i18n/index.ts';

/** Copy only explicitly staged regular files. Never overwrite a deliverable or follow a link. */
export async function copyAgentFiles(
  root: string,
  project: WorkspaceProject,
  agent: ProjectAgent,
  items: { path: string; sha256: string; file: { name: string; size: number } }[],
) {
  const prefix = projectAgentOutputPath(project, agent);
  if (prefix) await mkdir(await safePath(root, prefix, true), { recursive: true });
  const owned: { path: string; ino: number }[] = [];
  const paths: string[] = [];
  try {
    for (const item of items) {
      const original = basename(item.file.name);
      if (
        !windowsFileName(original) ||
        original.startsWith('.') ||
        (!prefix && !isSharedTaskPath(original))
      )
        throw new Error(t('AgentOutputsView.invalidFilename'));
      const input = await open(item.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const before = await input.stat();
        if (!before.isFile() || before.size !== item.file.size || before.size > 256 * 1024 ** 2)
          throw Error();
        bytes = await input.readFile();
        const after = await input.stat();
        if (
          before.ino !== after.ino ||
          before.mtimeMs !== after.mtimeMs ||
          bytes.length !== before.size ||
          createHash('sha256').update(bytes).digest('hex') !== item.sha256
        )
          throw Error();
      } catch {
        throw new Error(
          t('error.referenceFiles.referenceChangedSelectItAgain', { value1: original }),
        );
      } finally {
        await input.close();
      }
      for (let suffix = 0; suffix < 10000; suffix++) {
        const extension = extname(original);
        const name = suffix
          ? `${original.slice(0, original.length - extension.length)} (${suffix + 1})${extension}`
          : original;
        const relative = [prefix, name].filter(Boolean).join('/');
        const path = await safePath(root, relative, true);
        let output;
        try {
          output = await open(path, 'wx', 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
          throw error;
        }
        try {
          owned.push({ path, ino: (await output.stat()).ino });
          await output.writeFile(bytes);
          await output.sync();
        } finally {
          await output.close();
        }
        paths.push(relative);
        break;
      }
      if (paths.length !== owned.length || paths.length === 0)
        throw new Error(t('AgentOutputsView.importFailed'));
    }
    if (paths.length !== items.length) throw new Error(t('AgentOutputsView.importFailed'));
    return paths;
  } catch (error) {
    for (const file of owned) {
      const stat = await lstat(file.path).catch(() => null);
      if (stat?.isFile() && stat.ino === file.ino) await rm(file.path).catch(() => {});
    }
    throw error;
  }
}
