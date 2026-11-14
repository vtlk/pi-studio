import { stat, realpath } from 'node:fs/promises';

/** Use native discovery/filters/trust, but never install packages or attach their other assets. */
export async function nativeExtensionPaths(sdk, cwd) {
  const agentDir = sdk.getAgentDir();
  const decision = new sdk.ProjectTrustStore(agentDir).get(cwd);
  const projectTrusted = decision ?? !sdk.hasTrustRequiringProjectResources(cwd);
  const settings = sdk.SettingsManager.create(cwd, agentDir, { projectTrusted });
  if (settings.drainErrors().length) throw Error('Native Pi settings could not load');
  const manager = new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager: settings });
  const discovered = await manager.resolve(async () => 'skip');
  const pending = discovered.extensions.filter(item => item.enabled && !item.path.startsWith('builtin:')).map(item => item.path);
  const visited = new Set(), files = new Set();
  // Native manifests may point to a directory. Resolve it with Pi before passing file-only
  // extension paths to the scoped loader, so sibling skills/prompts cannot attach implicitly.
  while (pending.length) {
    if (visited.size > 10000) throw Error('Too many native Pi extension paths');
    const path = await realpath(pending.shift());
    if (visited.has(path)) continue;
    visited.add(path);
    const info = await stat(path);
    if (info.isFile()) { files.add(path); continue; }
    if (!info.isDirectory()) throw Error('Invalid native Pi extension');
    const resolved = await manager.resolveExtensionSources([path], { temporary: true });
    const children = resolved.extensions.filter(item => item.enabled && !item.path.startsWith('builtin:')).map(item => item.path);
    if (!children.length || children.every(child => child === path)) throw Error('Native Pi extension directory has no entry');
    pending.push(...children);
  }
  return [...files];
}
