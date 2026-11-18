import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { verifyBundledNotices, type BundledNoticeManifest } from './audit/bundledNotices.ts';

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
      const manifest: BundledNoticeManifest['packages'] = [];
      const missing: string[] = [];
      for (const directory of [...packages].sort()) {
        const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        const files: { name: string; path: string; sha256?: string }[] = (await readdir(directory))
          .filter((name) =>
            /^(?:licen[cs]e|copying|notice|authors)(?:$|[._-])|^third[-_ ]?party[-_ ]?notices?(?:$|[._-])/i.test(
              name,
            ),
          )
          .sort()
          .map((name) => ({ name, path: join(directory, name) }));
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
          if (!hashes.includes(hash)) hashes.push(hash);
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
      let text = [
        'Pi Studio — bundled JavaScript third-party notices',
        '',
        'Each notice below is unmodified upstream text. Package/version labels identify its bundled users.',
        '',
      ].join('\n');
      const index: BundledNoticeManifest['notices'] = [];
      for (const [sha256, notice] of notices) {
        const packages = [...new Set(notice.packages)].sort();
        const files = [...new Set(notice.files)].sort();
        text += `${packages.join(', ')}\n${files.join(', ')}\n\n`;
        index.push({
          sha256,
          byteOffset: Buffer.byteLength(text),
          byteLength: Buffer.byteLength(notice.text),
          packages,
          files,
        });
        text += notice.text + '\n\n';
      }
      const payload: BundledNoticeManifest = { schema: 2, packages: manifest, notices: index };
      verifyBundledNotices(Buffer.from(text), payload);
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: text });
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-license-sources.md',
        source: await readFile(resolve(root, 'third-party-licenses/SOURCES.md'), 'utf8'),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-packages.json',
        source: JSON.stringify(payload, null, 2) + '\n',
      });
    },
  };
}
