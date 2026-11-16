import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { digest, classifyFinding, privacyLines } from '../scripts/audit/findings.mjs';
import { readZipText } from '../scripts/audit/zipText.mjs';

function zip(entries: { name: string; text: string; method?: number }[]) {
  const local: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  const crc32 = (data: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      text = Buffer.from(entry.text);
    const method = entry.method ?? 8,
      data = method === 8 ? deflateRawSync(text) : text;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc32(text), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(text.length, 22);
    header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(text), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(text.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const end = Buffer.alloc(22),
    centralBytes = Buffer.concat(directory);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

test('audit reports never retain raw secret/match fields and prove SHA values against their referenced source', async () => {
  const value = Buffer.from('actual source contents'),
    hash = digest(value);
  const raw = {
    RuleID: 'generic-api-key',
    File: 'proof.json',
    StartLine: 1,
    Secret: ['private', 'test', 'value'].join('-'),
    Match: 'private matching context',
  };
  const files: Record<string, Buffer> = {
    'proof.json': Buffer.from(`{"src/key.ts":"${hash}"}`),
    'src/key.ts': value,
  };
  const result = await classifyFinding(raw, async (path: string) => files[path], new Set());
  assert.equal(result.disposition, 'verified-source-file-sha256');
  assert.equal(JSON.stringify(result).includes(raw.Secret), false);
  assert.equal('Match' in result, false);
  files['src/key.ts'] = Buffer.from('different version');
  assert.equal(
    (await classifyFinding(raw, async (path: string) => files[path], new Set())).disposition,
    'needs-review',
  );
  files['proof.json'] = Buffer.from(`{"api_key":"${hash}"}`);
  assert.equal(
    (await classifyFinding(raw, async (path: string) => files[path], new Set())).disposition,
    'needs-review',
  );
});

test('a known digest elsewhere on a line cannot hide another possible secret', async () => {
  const hash = 'a'.repeat(64),
    secret = ['private', 'test', 'value'].join('-');
  const raw = { RuleID: 'generic-api-key', File: 'index.js', StartLine: 1 };
  const data = Buffer.from(`{"images-api":"${hash}","api_key":"${secret}"}`);
  const result = await classifyFinding(raw, async () => data, new Set([hash]));
  assert.equal(result.disposition, 'needs-review');
});

test('historical source digests stay distinct from current source and substring matches cannot bypass review', async () => {
  const data = Buffer.from('historical source'),
    hash = digest(data);
  const line = `    "src/credentials.ts": "${hash}"`;
  const raw = {
    RuleID: 'generic-api-key',
    File: 'proof.json',
    StartLine: 1,
    StartColumn: 10,
    EndColumn: Buffer.byteLength(line),
  };
  const read = async (path: string) =>
    path === 'proof.json' ? Buffer.from(line) : Buffer.from('current source');
  assert.equal((await classifyFinding(raw, read, new Set())).disposition, 'needs-review');
  const verified = await classifyFinding(
    raw,
    read,
    new Set(),
    async (path: string, expected: string) => path === 'src/credentials.ts' && expected === hash,
  );
  assert.equal(verified.disposition, 'verified-historical-source-file-sha256');
  assert.equal(
    (
      await classifyFinding(
        { ...raw, StartColumn: 200, EndColumn: 250 },
        read,
        new Set(),
        async () => true,
      )
    ).disposition,
    'needs-review',
  );
  assert.equal(
    (
      await classifyFinding(
        { ...raw, RuleID: 'github-pat' },
        read,
        new Set([hash]),
        async () => true,
      )
    ).disposition,
    'needs-review',
  );
});

test('ZIP text reads stored/deflated Unicode entries without extracting paths, and bounds output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-audit-zip-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'package.zip'),
    outside = join(root, 'keep.txt');
  await writeFile(outside, 'keep');
  await writeFile(
    file,
    zip([
      { name: 'app/Сценарий.md', text: 'Привет' },
      { name: '../keep.txt', text: 'read-only', method: 0 },
    ]),
  );
  assert.equal((await readZipText(file, 'app/Сценарий.md'))?.toString(), 'Привет');
  assert.equal((await readZipText(file, '../keep.txt'))?.toString(), 'read-only');
  assert.equal(await readFile(outside, 'utf8'), 'keep');
  assert.equal(await readZipText(file, 'absent'), undefined);
  await assert.rejects(readZipText(file, 'app/Сценарий.md', 2), /oversized/);
  await writeFile(file, Buffer.from('truncated'));
  await assert.rejects(readZipText(file, 'x'), /ZIP/);
});

test('ambiguous ZIP duplicate names and inconsistent local headers fail closed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-audit-ambiguous-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'package.zip');
  await writeFile(
    file,
    zip([
      { name: 'same.js', text: 'first' },
      { name: 'same.js', text: 'second' },
    ]),
  );
  await assert.rejects(readZipText(file, 'same.js'), /duplicate|ambiguous/i);
  const mismatch = zip([{ name: 'same.js', text: 'content' }]);
  mismatch.write('fake.js', 30);
  await writeFile(file, mismatch);
  await assert.rejects(readZipText(file, 'same.js'), /header|name/i);
});

test('privacy inventory stores line numbers rather than personal paths', () => {
  assert.deepEqual(
    privacyLines('first\n/Users/person/private\nC:\\Users\\Person\\private'),
    [2, 3],
  );
});

test('manual renderer review is bound to the exact immutable proof and independently recorded release check', async () => {
  const hash = digest('fixture compiled CSS'),
    asset = 'index-testHash.css',
    commit = 'b'.repeat(40),
    file = 'artifacts/constructor-proof.json',
    evidenceFile = 'artifacts/historical-renderer-digest-review.json';
  const bytes = Buffer.from(JSON.stringify({ rendererSha256: { [asset]: hash } }, null, 2));
  const raw = { RuleID: 'generic-api-key', File: file, Commit: commit, StartLine: 3 };
  const approved = {
    rule: raw.RuleID,
    file,
    commit,
    line: 3,
    artifactSha256: digest(bytes),
    asset,
    digest: hash,
    archiveSha256: 'c'.repeat(64),
    entry: 'Pi Studio.app/Contents/Resources/app/out/renderer/assets/' + asset,
    evidence: evidenceFile,
  };
  const evidence = {
    finding: { file, commit, line: 3, jsonPointer: '/rendererSha256/' + asset },
    artifactSha256: digest(bytes),
    expectedDigest: hash,
    archive: { sha256: approved.archiveSha256 },
    entry: approved.entry,
    assetPresent: true,
    rendererDigestMatched: true,
    archiveProductionEd25519AndSha256Verified: true,
  };
  const check = async (finding = raw, data = bytes, review = approved, confirmation = evidence) =>
    classifyFinding(
      finding,
      async (path: string) =>
        path === file
          ? data
          : path === evidenceFile
            ? Buffer.from(JSON.stringify(confirmation))
            : undefined,
      new Set(),
      undefined,
      [review],
    );
  assert.equal((await check()).disposition, 'reviewed-published-renderer-digest');
  assert.equal(
    (await classifyFinding(raw, async () => bytes, new Set())).disposition,
    'needs-review',
  );
  for (const finding of [
    { ...raw, File: 'other.json' },
    { ...raw, Commit: 'a'.repeat(40) },
    { ...raw, StartLine: 1 },
    { ...raw, RuleID: 'github-pat' },
  ])
    assert.equal((await check(finding)).disposition, 'needs-review');
  assert.equal(
    (await check(raw, Buffer.from(JSON.stringify({ api_key: hash }, null, 2)))).disposition,
    'needs-review',
  );
  assert.equal(
    (await check(raw, Buffer.concat([bytes, Buffer.from('\n')]))).disposition,
    'needs-review',
  );
  assert.equal(
    (await check(raw, bytes, { ...approved, digest: 'd'.repeat(64) })).disposition,
    'needs-review',
  );
  assert.equal(
    (await check(raw, bytes, approved, { ...evidence, rendererDigestMatched: false })).disposition,
    'needs-review',
  );
  assert.equal(
    (await check(raw, bytes, approved, { ...evidence, archive: { sha256: 'd'.repeat(64) } }))
      .disposition,
    'needs-review',
  );
});
