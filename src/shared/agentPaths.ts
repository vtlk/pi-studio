import { t } from './i18n/index.ts';
import { folderSlug } from './folderSlug.ts';

/** Identity stays in profile.id; this directory is the stable, readable project-local location. */
export function agentDirectory(outputPath: string) {
  if (!/^agents\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\/output$/.test(outputPath))
    throw new Error(t('error.agentPaths.invalidAgentOutputPath'));
  return outputPath.slice(0, -'/output'.length);
}

export function agentFolderSlug(name: string) {
  return folderSlug(name, 'agent');
}
