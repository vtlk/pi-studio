import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, readdir, lstat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, classifyFinding, privacyLines } from './audit/findings.mjs';
import { readZipText } from './audit/zipText.mjs';

const execute = promisify(execFile),
  root = resolve(import.meta.dirname, '..');
const scanner = process.env.PI_STUDIO_GITLEAKS || 'gitleaks';
const reviewedRendererDigests = JSON.parse(
  await readFile(join(root, 'scripts/audit/reviewed-renderer-digests.json'), 'utf8'),
);
if (!Array.isArray(reviewedRendererDigests)) throw Error('Invalid exact renderer-digest reviews.');

const temporary = await mkdtemp(join(tmpdir(), 'pistudio-repository-audit-'));
const reportName = process.env.PI_STUDIO_AUDIT_REPORT || 'repository-security-audit-proof.json';
if (!/^[a-zA-Z0-9._-]+\.json$/.test(reportName))
  throw Error('Audit report must be a JSON basename.');
const output = resolve(root, 'artifacts', reportName);
const releaseAssets = process.argv.includes('--releases');
const fetchRefs = process.argv.includes('--fetch-refs');
const archives = new Map(),
  coverage = [],
  failures = [];
const repository = 'vtlk/pi-studio';
async function command(file, args, options = {}) {
  return execute(file, args, {
    cwd: root,
    timeout: 240000,
    maxBuffer: 32 * 1024 ** 2,
    windowsHide: true,
    ...options,
  });
}
const git = async (args) => (await command('git', args)).stdout;
const jsonGh = async (args) => JSON.parse((await command('gh', args)).stdout);
async function read(file, commit) {
  if (archives.has(file.split('!')[0])) {
    const [archive, entry, nested] = file.split('!');
    if (nested || !entry) return undefined;
    return readZipText(archives.get(archive), entry);
  }
  const path = relative(root, resolve(root, file));
  if (!path || path === '..' || path.startsWith('../') || isAbsolute(path)) return undefined;
  if (commit) {
    if (!/^[a-f0-9]{40}$/.test(commit)) return undefined;
    try {
      return (await command('git', ['show', `${commit}:${path}`], { encoding: 'buffer' })).stdout;
    } catch {
      return undefined;
    }
  }
  try {
    const info = await lstat(resolve(root, path));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 ** 2) return undefined;
    return await readFile(resolve(root, path));
  } catch {
    return undefined;
  }
}
const hashes = JSON.parse(
  await readFile(
    join(root, 'src/renderer/features/settings/model/legacyTemplateHashes.json'),
    'utf8',
  ),
);
const canonical = new Set(Object.values(hashes.connections));
const historicalFiles = new Map();
async function verifyHistorical(path, expected) {
  if (!historicalFiles.has(path)) {
    const known = new Set();
    const commits = (await git(['log', '--all', '--full-history', '--format=%H', '--', path]))
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const commit of commits) {
      const data = await read(path, commit);
      if (data) known.add(digest(data));
    }
    historicalFiles.set(path, known);
  }
  return historicalFiles.get(path).has(expected);
}
async function scan(scope, args, config) {
  const report = join(temporary, `${coverage.length}.json`);
  let status = 0,
    diagnostic = '';
  try {
    const result = await command(
      scanner,
      [
        ...args,
        '--config',
        config,
        '--gitleaks-ignore-path',
        join(temporary, 'ignore'),
        '--ignore-gitleaks-allow',
        '--redact=100',
        '--no-banner',
        '--log-level=error',
        '--report-format=json',
        '--report-path',
        report,
        '--timeout=180',
      ],
      { env: { ...process.env, GOMAXPROCS: '2' } },
    );
    diagnostic = result.stderr;
  } catch (error) {
    status = error.code;
    diagnostic = error.stderr || '';
  }
  if (![0, 1].includes(status) || diagnostic.trim())
    throw Error(
      `Secret scan incomplete: ${scope} (status ${status}; diagnostic=${!!diagnostic.trim()}).`,
    );
  const raw = JSON.parse(await readFile(report, 'utf8'));
  const findings = [];
  for (const finding of raw)
    findings.push(
      await classifyFinding(finding, read, canonical, verifyHistorical, reviewedRendererDigests),
    );
  const result = {
    scope,
    findings,
    unresolved: findings.filter((finding) => finding.disposition === 'needs-review').length,
  };
  coverage.push(result);
  await rm(report, { force: true });
  console.log(`${scope}: ${findings.length} findings, ${result.unresolved} require review.`);
  return result;
}
try {
  const version = (await command(scanner, ['version'])).stdout.trim();
  if (version !== '8.30.1') throw Error('Use reviewed Gitleaks 8.30.1 via PI_STUDIO_GITLEAKS.');
  await writeFile(join(temporary, 'ignore'), '', { mode: 0o600 });
  const defaults = join(temporary, 'default.toml'),
    tree = join(temporary, 'tree.toml');
  await writeFile(defaults, '[extend]\nuseDefault = true\n', { mode: 0o600 });
  await writeFile(
    tree,
    "[extend]\nuseDefault = true\n[[allowlists]]\ndescription = \"Root generated dependencies/builds and Git database scanned separately\"\npaths = ['''^(\\./)?(node_modules|out|dist|\\.git)(/|$)''']\n",
    { mode: 0o600 },
  );
  if (fetchRefs)
    await command('git', [
      'fetch',
      '--no-write-fetch-head',
      'origin',
      'refs/heads/*:refs/remotes/origin/*',
      'refs/tags/*:refs/tags/*',
    ]);
  const refs = (await git(['for-each-ref', '--format=%(refname) %(objectname)']))
    .trim()
    .split('\n');
  const revision = (await git(['rev-parse', 'HEAD'])).trim();
  await scan(
    'reachable-history-all-refs',
    ['git', '.', '--log-opts=--all --full-history'],
    defaults,
  );
  await scan('working-tree-including-untracked', ['dir', '.'], tree);
  const files = [
    ...new Set(
      (await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']))
        .split('\0')
        .filter(Boolean),
    ),
  ];
  const privacy = [],
    sensitiveFileNames = [],
    symlinks = [],
    lfsPointers = [];
  for (const file of files) {
    if (
      /(^|\/)(\.env(?:\..*)?|auth\.json|credentials(?:\..*)?)$|\.(pem|p12|pfx|key|jsonl)$/i.test(
        file,
      )
    )
      sensitiveFileNames.push(file);
    try {
      if ((await lstat(join(root, file))).isSymbolicLink()) symlinks.push(file);
    } catch {
      continue;
    }
    const data = await read(file);
    if (!data) continue;
    const lines = privacyLines(data.toString('utf8'));
    if (lines.length) privacy.push({ file, lines });
    if (data.subarray(0, 200).toString().startsWith('version https://git-lfs.github.com/spec/v1'))
      lfsPointers.push(file);
  }
  for (const file of await readdir(join(root, 'dist'))) {
    if (!/^Pi-Studio-.*\.zip$/.test(file)) continue;
    const name = `dist/${file}`;
    archives.set(name, join(root, name));
    await scan(
      `local-archive:${file}`,
      ['dir', name, '--max-archive-depth=2', '--max-target-megabytes=1024'],
      defaults,
    );
  }
  const pages = await jsonGh(['api', `repos/${repository}/releases`, '--paginate', '--slurp']);
  const releases = pages.flat(),
    assets = releases.flatMap((release) =>
      release.assets.map((asset) => ({
        tag: release.tag_name,
        id: asset.id,
        name: asset.name,
        bytes: asset.size,
        digest: asset.digest,
      })),
    );
  const metadata = join(temporary, 'release-metadata.json');
  await writeFile(metadata, JSON.stringify(releases), { mode: 0o600 });
  const metaScope = await scan('github-release-metadata-all-pages', ['dir', metadata], defaults);
  for (const finding of metaScope.findings) finding.file = 'GitHub Releases metadata';
  if (releaseAssets)
    for (const asset of assets) {
      if (
        !/^v[0-9][a-zA-Z0-9.+-]*$/.test(asset.tag) ||
        !/^Pi-Studio-[a-zA-Z0-9.+-]+(?:\.zip(?:\.sha256)?|\.update\.json)$/.test(asset.name) ||
        basename(asset.name) !== asset.name ||
        asset.bytes > (asset.name.endsWith('.zip') ? 512 * 1024 ** 2 : 1024 ** 2)
      ) {
        failures.push({ asset: asset.id, reason: 'Unsupported asset name/format; not inspected.' });
        continue;
      }
      const directory = join(temporary, `asset-${asset.id}`);
      try {
        await command('gh', [
          'release',
          'download',
          asset.tag,
          '--repo',
          repository,
          '--dir',
          directory,
          '--pattern',
          asset.name,
        ]);
        const file = join(directory, asset.name),
          bytes = await readFile(file),
          sha256 = digest(bytes);
        if (bytes.length !== asset.bytes || (asset.digest && asset.digest !== `sha256:${sha256}`))
          throw Error('Asset bytes/digest mismatch.');
        const alias = relative(root, file);
        if (asset.name.endsWith('.zip')) archives.set(alias, file);
        const result = await scan(
          `github-asset:${asset.id}:${asset.tag}`,
          ['dir', alias, '--max-archive-depth=2', '--max-target-megabytes=1024'],
          defaults,
        );
        for (const finding of result.findings)
          finding.file = finding.file.replace(alias, asset.name);
        asset.sha256 = sha256;
        asset.scanned = true;
        archives.delete(alias);
      } catch {
        failures.push({
          asset: asset.id,
          reason: 'Download/integrity/scan incomplete; no raw tool diagnostics retained.',
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  const configHashes = {
    default: digest(await readFile(defaults)),
    tree: digest(await readFile(tree)),
  };
  const report = {
    checkedAt: new Date().toISOString(),
    revision,
    scanner: {
      name: 'Gitleaks',
      version,
      configHashes,
      redacted: true,
      allowCommentsIgnored: true,
      ignoreFileEmpty: true,
      exactManualRendererDigestReviews: reviewedRendererDigests.length,
    },
    source: {
      refs,
      trackedAndUntrackedFiles: files.length,
      sensitiveFileNames,
      symlinks,
      lfsPointers,
      privacyReferences: privacy,
    },
    coverage,
    github: { repository, releases: releases.length, assets, allAssetsRequested: releaseAssets },
    failures,
    exclusions: [
      'Root node_modules is a local dependency install, not published source. Bundled dependency payloads are scanned inside archives.',
      'out is scanned through distributables; .git through all fetched reachable refs. Unreachable/dangling Git objects and external user studio/credentials are not scanned.',
      'Personal paths flagged by location only; images need separate visual/provenance review before public release.',
    ],
    unreviewedFindings: coverage.reduce((sum, item) => sum + item.unresolved, 0),
    allRequestedScansPassed:
      !failures.length && !lfsPointers.length && coverage.every((item) => !item.unresolved),
    cleanupPerformed: false,
    historyRewritten: false,
    releasesDeleted: false,
    repositoryVisibilityChanged: false,
    cleanupRequiresExplicitAgreement: true,
    fullRel02Accepted: false,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    `Audit saved. Unreviewed findings: ${report.unreviewedFindings}; incomplete assets: ${failures.length}; privacy-reference files: ${privacy.length}. No cleanup/publication performed.`,
  );
  if (!report.allRequestedScansPassed) process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
