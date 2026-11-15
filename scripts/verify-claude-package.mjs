import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export async function verifyClaudePackage(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'UPSTREAM.json'), 'utf8'));
  if (
    manifest.commit !== 'd5b5e04c314d3452d357174d16d10dda34daa2d2' ||
    manifest.version !== '0.1.0' ||
    manifest.license !== 'MIT'
  )
    throw Error('Unreviewed Claude Code provider version');
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (file.startsWith('/') || file.split('/').includes('..'))
      throw Error('Invalid provider source path');
    const actual = createHash('sha256')
      .update(await readFile(join(directory, file)))
      .digest('hex');
    if (actual !== expected) throw Error(`Claude Code provider integrity mismatch: ${file}`);
  }
  return manifest;
}
