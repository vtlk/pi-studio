import { createHash } from 'node:crypto';

export interface BundledNoticeManifest {
  schema: 2;
  packages: { name: string; version: string; license: unknown; noticeHashes: string[] }[];
  notices: {
    sha256: string;
    byteOffset: number;
    byteLength: number;
    packages: string[];
    files: string[];
  }[];
}

/** Verify actual UTF-8 notice bytes and their package bindings, not just nonempty hash arrays. */
export function verifyBundledNotices(bytes: Buffer, value: unknown): BundledNoticeManifest {
  const fail = (): never => {
    throw Error('Invalid or incomplete bundled third-party notices.');
  };
  if (!value || typeof value !== 'object') fail();
  const manifest = value as BundledNoticeManifest;
  if (
    manifest.schema !== 2 ||
    !Array.isArray(manifest.packages) ||
    !manifest.packages.length ||
    !Array.isArray(manifest.notices) ||
    !manifest.notices.length
  )
    fail();
  const labels = new Map<string, Set<string>>();
  for (const pkg of manifest.packages) {
    if (
      !pkg ||
      typeof pkg.name !== 'string' ||
      !pkg.name ||
      typeof pkg.version !== 'string' ||
      !pkg.version ||
      !Array.isArray(pkg.noticeHashes) ||
      !pkg.noticeHashes.length ||
      pkg.noticeHashes.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
    )
      fail();
    const key = `${pkg.name}@${pkg.version}`;
    if (labels.has(key) || new Set(pkg.noticeHashes).size !== pkg.noticeHashes.length) fail();
    labels.set(key, new Set(pkg.noticeHashes));
  }
  const indexed = new Map<string, Set<string>>();
  let end = 0;
  for (const notice of manifest.notices) {
    if (
      !notice ||
      typeof notice.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(notice.sha256) ||
      indexed.has(notice.sha256) ||
      !Number.isSafeInteger(notice.byteOffset) ||
      !Number.isSafeInteger(notice.byteLength) ||
      notice.byteLength <= 0 ||
      notice.byteOffset < end ||
      notice.byteOffset > bytes.length - notice.byteLength ||
      !Array.isArray(notice.packages) ||
      !notice.packages.length ||
      !Array.isArray(notice.files) ||
      !notice.files.length ||
      [...notice.packages, ...notice.files].some(
        (label) => typeof label !== 'string' || !label || /[\r\n]/.test(label),
      )
    )
      fail();
    const owners = new Set(notice.packages);
    if (
      owners.size !== notice.packages.length ||
      new Set(notice.files).size !== notice.files.length ||
      notice.packages.some((key) => !labels.get(key)?.has(notice.sha256))
    )
      fail();
    const text = bytes.subarray(notice.byteOffset, notice.byteOffset + notice.byteLength);
    if (
      !text.toString('utf8').trim() ||
      !Buffer.from(text.toString('utf8')).equals(text) ||
      createHash('sha256').update(text).digest('hex') !== notice.sha256
    )
      fail();
    const header = Buffer.from(`${notice.packages.join(', ')}\n${notice.files.join(', ')}\n\n`);
    if (
      notice.byteOffset - header.length < end ||
      !bytes.subarray(notice.byteOffset - header.length, notice.byteOffset).equals(header)
    )
      fail();
    indexed.set(notice.sha256, owners);
    end = notice.byteOffset + notice.byteLength;
  }
  for (const [key, hashes] of labels)
    for (const hash of hashes) if (!indexed.get(hash)?.has(key)) fail();
  return manifest;
}
