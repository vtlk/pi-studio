import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/** Keep full upstream notices for the packages that supplied bundled renderer code. */
export function bundledNotices(root: string): Plugin {
  return {
    name: 'studio-bundled-notices',
    async generateBundle() {
      const packages = new Set<string>();
      for (const id of this.getModuleIds()) {
        const clean = id.replace(/^\0/, '').replaceAll('\\', '/'),
          marker = clean.lastIndexOf('/node_modules/');
        if (marker < 0) continue;
        const prefix = clean.slice(0, marker + '/node_modules/'.length),
          segments = clean.slice(prefix.length).split('/');
        const name = segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
        packages.add(prefix + name);
      }
      // Vite's generated preload/runtime helpers use virtual module IDs.
      packages.add(resolve(root, 'node_modules/vite'));
      const notices = new Map<string, { packages: string[]; files: string[]; text: string }>();
      const manifest: {
        name: string;
        version: string;
        license: unknown;
        noticeHashes: string[];
      }[] = [];
      const missing: string[] = [];
      for (const directory of [...packages].sort()) {
        const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        const files: { name: string; path: string; sha256?: string }[] = (await readdir(directory))
          .filter((name) => /^(?:licen[cs]e|copying|notice|authors)(?:$|[._-])/i.test(name))
          .sort()
          .map((name) => ({ name, path: join(directory, name) }));
        // This exact media tarball omits the repository-wide license. The matching
        // player tarball contains byte-identical v4.0.543 root LICENSE.md.
        if (pkg.name === '@remotion/media' && pkg.version === '4.0.543')
          files.push({
            name: 'Remotion v4.0.543 root LICENSE.md (from @remotion/player)',
            path: resolve(root, 'node_modules/@remotion/player/LICENSE.md'),
            sha256: '53e92b6560f26f9d913a8ac97e4861e013c99ee9164fa0b11c25d8a02672fc09',
          });
        if (pkg.name === 'react-remove-scroll-bar' && pkg.version === '2.3.8')
          files.push({
            name: 'react-remove-scroll-bar upstream LICENSE (see third-party-license-sources.md)',
            path: resolve(root, 'third-party-licenses/React-remove-scroll-bar-LICENSE.txt'),
            sha256: 'a79aae0c0f21990d9d963bb3c5a79cdcea9a46f8523ba55c58d7fe776b6ebc84',
          });
        const hashes: string[] = [];
        let licenseFound = false;
        for (const file of files) {
          const info = await lstat(file.path);
          if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 ** 2) continue;
          const text = await readFile(file.path, 'utf8');
          if (!text.trim()) continue;
          if (/\b(?:licen[cs]e|copying)(?:$|[\s._-])/i.test(file.name)) licenseFound = true;
          const hash = createHash('sha256').update(text).digest('hex');
          if (file.sha256 && file.sha256 !== hash)
            throw new Error(`Supplemental license changed for ${pkg.name}@${pkg.version}.`);
          hashes.push(hash);
          const existing = notices.get(hash) ?? { packages: [], files: [], text };
          existing.packages.push(`${pkg.name}@${pkg.version}`);
          existing.files.push(file.name);
          notices.set(hash, existing);
        }
        if (!licenseFound) missing.push(`${pkg.name}@${pkg.version}`);
        manifest.push({
          name: pkg.name,
          version: pkg.version,
          license: pkg.license ?? null,
          noticeHashes: hashes,
        });
      }
      if (missing.length)
        throw new Error(`No full license text for bundled packages: ${missing.join(', ')}.`);
      const text = [
        'Pi Studio — bundled JavaScript third-party notices',
        '',
        'Each notice below is unmodified upstream text. Package/version labels identify its bundled users.',
        '',
        ...[...notices.values()].map(
          (notice) =>
            `${[...new Set(notice.packages)].sort().join(', ')}\n${[...new Set(notice.files)].sort().join(', ')}\n\n${notice.text}\n`,
        ),
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: text });
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-license-sources.md',
        source: await readFile(resolve(root, 'third-party-licenses/SOURCES.md'), 'utf8'),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-packages.json',
        source: JSON.stringify({ schema: 1, packages: manifest }, null, 2) + '\n',
      });
    },
  };
}
