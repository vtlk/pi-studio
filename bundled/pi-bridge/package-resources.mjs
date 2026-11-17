import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Pi's directory fallback also accepts ordinary npm CLIs. They must never execute as extensions. */
export async function assertPiResources(paths) {
  const resources = ['extensions', 'skills', 'prompts', 'themes'].flatMap((kind) =>
    paths[kind].filter((item) => item.enabled).map((item) => ({ ...item, kind })),
  );
  if (!resources.length)
    throw Object.assign(new Error('No Pi resources in this package'), {
      category: 'not-pi-package',
    });
  for (const resource of resources) {
    const root = resource.metadata.packageRoot;
    if (resource.kind !== 'extensions' || !root || resolve(resource.path) !== resolve(root))
      continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!Array.isArray(manifest.pi?.extensions) || !manifest.pi.extensions.length)
      throw Object.assign(
        new Error(
          'Ordinary npm packages are not Pi extensions; use an MCP configuration or the native CLI instead',
        ),
        { category: 'not-pi-package' },
      );
  }
}
