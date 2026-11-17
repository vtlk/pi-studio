import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { skillSource, skillPath } from '../src/main/skills/skillSource.ts';
import { downloadSkill, skillDownloadLimit } from '../src/main/skills/skillTransfer.ts';
import { extractSkillArchive } from '../src/main/skills/skillArchive.ts';
import { updateZip, type ZipFixtureEntry } from './helpers/updateZip.ts';

const signal = () => new AbortController().signal;
const sha = 'a'.repeat(40);
test('GitHub default, blob/tree and slash-branch links resolve to immutable commits and preserve the requested folder', async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (input, options) => {
    const url = String(input);
    calls.push(url);
    assert.equal(options?.credentials, 'omit');
    assert.equal(new Headers(options?.headers).has('authorization'), false);
    return new Response(
      url.endsWith('/commits/HEAD') ||
        url.endsWith('/commits/main') ||
        url.endsWith('/commits/feature%2Fbranch')
        ? sha
        : '',
      {
        status:
          url.endsWith('/commits/HEAD') ||
          url.endsWith('/commits/main') ||
          url.endsWith('/commits/feature%2Fbranch')
            ? 200
            : 404,
      },
    );
  };
  for (const [url, path] of [
    ['https://github.com/owner/repo', ''],
    ['https://github.com/owner/repo/tree/main', ''],
    ['https://github.com/owner/repo/tree/main/skills/pdf', 'skills/pdf'],
    ['https://github.com/owner/repo/blob/main/skills/pdf/SKILL.md', 'skills/pdf'],
    ['https://github.com/owner/repo/tree/feature/branch/skills/pdf', 'skills/pdf'],
  ]) {
    const result = await skillSource({ url }, signal(), request);
    assert.equal(result.url.href, `https://api.github.com/repos/owner/repo/zipball/${sha}`);
    assert.equal(result.path ?? '', path);
    assert.equal(result.commit, sha);
  }
  const result = await skillSource(
    { url: 'https://github.com/owner/repo', ref: 'feature/branch', skillPath: 'skills/pdf' },
    signal(),
    request,
  );
  assert.equal(result.path, 'skills/pdf');
  await assert.rejects(
    skillSource(
      { url: 'https://github.com/owner/repo/tree/main/one', skillPath: 'other' },
      signal(),
      request,
    ),
  );
  assert.ok(calls.some((url) => url.includes('feature%2Fbranch')));
});

test('ZIP transfer bounds bytes and validates every redirect; it never opens file URLs, sends auth or runs a shell', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-skill-transfer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const url of [
    'file:///tmp/a.zip',
    'http://example.com/a.zip',
    'https://token@example.com/a.zip',
  ])
    await assert.rejects(
      skillSource({ url }, signal(), async () => {
        throw Error('Must not request');
      }),
    );
  for (const path of ['../x', 'C:/x', 'x\\y', '/root', 'a/CON', 'a.', 'a/./b'])
    assert.throws(() => skillPath(path));
  const zip = updateZip([{ name: 'SKILL.md', text: 'inert' }]);
  const seen: string[] = [];
  await downloadSkill(
    new URL('https://example.com/start'),
    join(root, 'safe.zip'),
    signal(),
    async (input) => {
      seen.push(String(input));
      return seen.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://cdn.example.com/file.zip' },
          })
        : new Response(zip);
    },
  );
  assert.equal(seen.length, 2);
  await assert.rejects(
    downloadSkill(
      new URL('https://example.com/start'),
      join(root, 'bad.zip'),
      signal(),
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://example.com/no' } }),
    ),
  );
  await assert.rejects(
    downloadSkill(
      new URL('https://example.com/large'),
      join(root, 'large.zip'),
      signal(),
      async () =>
        new Response(zip, { headers: { 'content-length': String(skillDownloadLimit + 1) } }),
    ),
    /лимит/,
  );
});

test('ZIP extraction rejects traversal, symlinks, Windows aliases/collisions, broken CRC and conflicting local headers', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-skill-zip-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'fixture.zip');
  const invalid: ZipFixtureEntry[][] = [
    [{ name: '../outside' }],
    [{ name: '/outside' }],
    [{ name: 'C:/outside' }],
    [{ name: 'a\\b' }],
    [{ name: 'a/CON.txt' }],
    [{ name: 'a/b.' }],
    [{ name: 'a/link', mode: 0o120777, text: '../../outside' }],
    [{ name: 'a/suid', mode: 0o104755 }],
    [{ name: 'a/device', mode: 0o020666 }],
    [{ name: 'a/SKILL.md' }, { name: 'a/skill.md' }],
    [{ name: 'a/b/one' }, { name: 'a/B/two' }],
    [{ name: 'a/parent', text: 'file' }, { name: 'a/parent/child' }],
    [{ name: 'a/SKILL.md', localName: 'a/escape' }],
    [{ name: 'a/encrypted', flags: 0x801 }],
  ];
  for (const [index, entries] of invalid.entries()) {
    await writeFile(file, updateZip(entries));
    await assert.rejects(
      extractSkillArchive(file, join(root, `bad-${index}`), signal()),
      undefined,
      entries[0].name,
    );
  }
  const corrupted = updateZip([{ name: 'SKILL.md', text: 'CRC fixture' }]);
  const central = corrupted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupted.writeUInt32LE(0, central + 16);
  await writeFile(file, corrupted);
  await assert.rejects(extractSkillArchive(file, join(root, 'crc'), signal()));
  await writeFile(file, Buffer.from('not a zip'));
  await assert.rejects(extractSkillArchive(file, join(root, 'not-zip'), signal()));
  assert.equal((await readdir(root)).includes('outside'), false);
});
