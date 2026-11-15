import { findPackageJSON } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Use Pi's public terminal hook; all behavior except title updates stays upstream-owned. */
export function fixedTitleTerminal(terminal, title) {
  if (typeof title !== 'string' || !title.trim() || /\p{Cc}/u.test(title))
    throw new Error('Invalid Studio terminal title');
  return new Proxy(terminal, {
    get(target, property) {
      if (property === 'setTitle') return () => target.setTitle(title);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function studioSessionTerminal(sdkPath, title) {
  const metadata = findPackageJSON('@earendil-works/pi-tui', pathToFileURL(sdkPath));
  if (!metadata) throw new Error('Pi terminal API is unavailable');
  const pkg = JSON.parse(await readFile(metadata, 'utf8'));
  if (pkg.name !== '@earendil-works/pi-tui' || pkg.version !== '1.5.2' || !pkg.main)
    throw new Error('Unsupported Pi terminal API');
  const { ProcessTerminal } = await import(new URL(pkg.main, pathToFileURL(metadata)).href);
  return fixedTitleTerminal(new ProcessTerminal(), title);
}
