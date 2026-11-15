import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const bundledClaudeExtension = fileURLToPath(new URL('./provider.ts', import.meta.url));

/** Keep all other installed native extensions; the bundled provider owns this ID. */
export async function withClaudeExtension(paths) {
  const kept = [];
  for (const path of new Set(paths)) {
    const resolved = await realpath(path);
    if (resolved === bundledClaudeExtension) continue;
    let directory = dirname(resolved),
      duplicate = false;
    for (let i = 0; i < 8; i++) {
      try {
        const data = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        duplicate = data.name === '@earendil-works/pi-claude-code';
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (!duplicate) kept.push(path);
  }
  return [...kept, bundledClaudeExtension];
}
