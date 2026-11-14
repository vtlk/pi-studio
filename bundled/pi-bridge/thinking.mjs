import { findPackageJSON } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Resolve the public pi-ai API from the exact pinned SDK, including hoisted installations.
export async function loadThinkingApi(sdkPath) {
  const metadata = findPackageJSON('@earendil-works/pi-ai/compat', pathToFileURL(sdkPath));
  if (!metadata) throw new Error('Pi thinking capabilities are unavailable');
  const pkg = JSON.parse(await readFile(metadata, 'utf8'));
  if (pkg.version !== '1.5.2') throw new Error('Unsupported Pi thinking API');
  return import(new URL(pkg.exports['./compat'].import, pathToFileURL(metadata)).href);
}
