/** Signed macOS apps, actual updater/UI/helper/relaunch. Ephemeral release key and HTTP fixtures. */
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  realpath,
  readdir,
  statfs,
} from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, randomUUID, randomBytes } from 'node:crypto';
import { writeInventory, verifyInventory } from '../bundled/update-helper/inventory.mjs';
import { retireLegacyFeatures } from '../src/main/storage/retireLegacyFeatures.ts';
import { parseStudio } from '../src/main/storage/validation.ts';
import { isDeepStrictEqual } from 'node:util';
import { inspectUpdateArchive } from '../src/main/updates/archive.ts';
import { browserCloneSnapshot, recordBrowserCloneAudit } from './mac-browser-clone-audit.mjs';

const [oldApp, newApp, mode = 'success'] = process.argv.slice(2);
const signingIdentity = process.env.PI_STUDIO_SIGN_IDENTITY;
if (
  process.platform !== 'darwin' ||
  !oldApp?.endsWith('/Pi Studio.app') ||
  !newApp?.endsWith('/Pi Studio.app') ||
  !signingIdentity ||
  signingIdentity === '-' ||
  !['success', 'no-health'].includes(mode)
)
  throw Error(
    'Usage: PI_STUDIO_SIGN_IDENTITY=<existing identity> node --experimental-strip-types scripts/smoke-packaged-update.ts /absolute/old/Pi Studio.app /absolute/new/Pi Studio.app [success|no-health]',
  );
const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-packaged-update-')));
const browserClonesBefore = await browserCloneSnapshot();
if ((await statfs(root).then((fs) => fs.bavail * fs.bsize)) < 2 * 1024 ** 3)
  throw Error('Not enough space for isolated packaged update QA.');
const target = join(root, 'Pi Studio.app'),
  candidate = join(root, 'candidate/Pi Studio.app'),
  userData = join(root, 'UserData'),
  studio = join(root, 'Studio'),
  videos = join(root, 'videos');
const run = (file: string, args: string[]) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
  }
};
async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(150);
  }
  throw Error('Packaged update QA condition timed out');
}
async function maybeJson(file: string) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}
async function digest(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function studioFingerprint() {
  const result: Record<string, string> = {};
  async function walk(path: string, prefix: string) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw Error('Unexpected fixture link');
      if (item.isDirectory()) await walk(join(path, item.name), prefix + item.name + '/');
      else result[prefix + item.name] = await digest(join(path, item.name));
    }
  }
  await walk(studio, '');
  return result;
}
let original: ReturnType<typeof spawn> | undefined,
  completed = false;
try {
  const from = JSON.parse(
    await readFile(join(oldApp, 'Contents/Resources/app/package.json'), 'utf8'),
  ).version;
  const to = JSON.parse(
    await readFile(join(newApp, 'Contents/Resources/app/package.json'), 'utf8'),
  ).version;
  if (from === to) throw Error('Two different source versions are required.');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const oldKey = JSON.parse(await readFile('src/main/updates/publicKey.json', 'utf8'))
    .spki.trim()
    .split('\n')[1];
  const newKey = publicKey.export({ type: 'spki', format: 'pem' }).toString().trim().split('\n')[1];
  for (const path of [userData, studio, videos]) await mkdir(path, { recursive: true });
  const externalNode = await realpath(process.execPath);
  await mkdir(join(userData, 'runtime/pi/bin'), { recursive: true });
  const { symlink } = await import('node:fs/promises');
  await symlink(externalNode, join(userData, 'runtime/pi/bin/node'));
  await writeFile(join(userData, 'workspace.json'), JSON.stringify({ folder: studio }));
  await writeFile(join(userData, 'qa-protected-credential.bin'), randomBytes(48), { mode: 0o600 });
  const teamId = randomUUID(),
    agentId = randomUUID();
  const agent = {
    id: agentId,
    name: 'QA сохранённый агент',
    enabled: true,
    mainInstruction: 'QA current prompt must survive unchanged',
    instructions: [
      {
        id: randomUUID(),
        name: 'QA instruction',
        content: 'QA current instruction remains in the constructor only.',
        enabled: true,
      },
    ],
    skills: [],
    mcps: [],
    plugins: [],
  };
  await mkdir(join(studio, '.pistudio'), { recursive: true });
  await writeFile(
    join(studio, '.pistudio/studio.json'),
    JSON.stringify({
      schemaVersion: 1,
      sections: {
        agents: [agent],
        agentTeams: [{ id: teamId, name: 'QA saved team', agentIds: [agentId] }],
        resources: [],
      },
    }),
  );
  const projectName = 'Точный проект QA';
  for (const [id, name, createdAt] of [
    ['older', projectName, 1],
    ['newer', 'Другой проект QA', 2],
  ] as const) {
    const project = join(studio, 'projects', id),
      output = join(project, 'agents/qa-agent/output'),
      sessions = join(project, 'agents/qa-agent/sessions');
    await mkdir(output, { recursive: true });
    await mkdir(sessions);
    const sessionId = randomUUID();
    await writeFile(
      join(sessions, 'session.jsonl'),
      JSON.stringify({
        type: 'session',
        version: 3,
        id: sessionId,
        timestamp: '2026-11-16T00:00:00.000Z',
        cwd: output,
      }) + '\n',
    );
    await writeFile(
      join(output, 'result.md'),
      '# Сохранённый результат\n\nДанные QA не должны измениться.\n',
    );
    const { instructions: _blocks, mainInstruction: _prompt, ...profile } = agent;
    await writeFile(
      join(project, 'project.json'),
      JSON.stringify({
        schemaVersion: 1,
        id,
        name,
        createdAt,
        sourceTeamId: teamId,
        agents: [
          {
            profile,
            outputPath: 'agents/qa-agent/output',
            session: {
              id: sessionId,
              title: 'Existing QA dialogue',
              path: 'agents/qa-agent/sessions/session.jsonl',
              createdAt: 1,
            },
          },
        ],
      }),
    );
  }
  for (const [source, destination] of [
    [oldApp, target],
    [newApp, candidate],
  ]) {
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', source]);
    await cp(source, destination, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    const application = join(destination, 'Contents/Resources/app'),
      entry = join(application, 'out/main/index.cjs');
    const code = await readFile(entry, 'utf8');
    if (code.split(oldKey).length !== 2)
      throw Error('Expected exactly one production update key pin.');
    const patched = code.replace(oldKey, newKey);
    if (patched.replace(newKey, oldKey) !== code) throw Error('Unexpected QA code patch');
    await writeFile(entry, patched);
    await cp('scripts/fixtures/update-packaged-main.cjs', join(application, 'qa-main.cjs'));
    await cp('scripts/offscreen-main.cjs', join(application, 'qa-offscreen.cjs'));
    const pkg = JSON.parse(await readFile(join(application, 'package.json'), 'utf8'));
    pkg.main = 'qa-main.cjs';
    await writeFile(join(application, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    await rm(join(application, 'installation-files.json'));
    await writeInventory(destination, 'darwin');
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', signingIdentity, destination]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', destination]);
    await verifyInventory(destination, 'darwin');
  }
  const archive = join(root, `Pi-Studio-${to}-mac-arm64.zip`);
  run('/usr/bin/ditto', [
    '-c',
    '-k',
    '--norsrc',
    '--noextattr',
    '--keepParent',
    candidate,
    archive,
  ]);
  const inspected = await inspectUpdateArchive(archive, 'darwin');
  const bytes = (await import('node:fs/promises')).stat;
  const archiveBytes = (await bytes(archive)).size;
  const archiveSha = await digest(archive),
    name = `Pi-Studio-${to}-darwin-arm64.update.json`;
  const manifest = {
    schema: 1,
    appId: 'studio.pi.desktop',
    version: to,
    platform: 'darwin',
    arch: 'arm64',
    minOs: '13.0.0',
    format: 'mac-zip',
    sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(),
    archive: {
      name: basename(archive),
      bytes: archiveBytes,
      sha256: archiveSha,
      unpackedBytes: inspected.unpackedBytes,
    },
  };
  const payload = Buffer.from(JSON.stringify(manifest));
  const metadata = join(root, name);
  await writeFile(
    metadata,
    JSON.stringify({
      payload: payload.toString('base64'),
      signature: sign(null, payload, privateKey).toString('base64'),
    }),
  );
  const metadataBytes = (await bytes(metadata)).size,
    releases = join(root, 'releases.json');
  await writeFile(
    releases,
    JSON.stringify([
      {
        tag_name: 'v' + to,
        draft: false,
        prerelease: true,
        body: 'Isolated signed native update QA',
        assets: [
          { name, size: metadataBytes },
          { name: basename(archive), size: archiveBytes, digest: 'sha256:' + archiveSha },
        ],
      },
    ]),
  );
  const config = {
    root,
    target,
    userData,
    studio,
    videos,
    from,
    to,
    mode,
    projectName,
    archive,
    archiveBytes,
    releases,
    metadata,
    archiveUrl: `https://github.com/vtlk/pi-studio/releases/download/v${to}/${basename(archive)}`,
    manifestUrl: `https://github.com/vtlk/pi-studio/releases/download/v${to}/${name}`,
  };
  const configPath = join(root, 'config.json');
  await writeFile(configPath, JSON.stringify(config));
  const env = { ...process.env, PI_STUDIO_PACKAGED_UPDATE_QA: configPath };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH']) delete env[name];
  original = spawn(join(target, 'Contents/MacOS/Pi Studio'), [], {
    env,
    cwd: root,
    stdio: 'ignore',
  });
  const originalExit = new Promise<void>((resolve) => original!.once('exit', () => resolve()));
  await waitFor(() => maybeJson(join(root, 'baseline-ready.json')), Boolean);
  const settingsFile = join(studio, '.pistudio/studio.json');
  const beforeSettings = JSON.parse(await readFile(settingsFile, 'utf8'));
  const before = await studioFingerprint(),
    preferences = await digest(join(userData, 'workspace.json')),
    credential = await digest(join(userData, 'qa-protected-credential.bin'));
  await writeFile(join(root, 'allow-consent'), 'one explicit UI action');
  const finished = await waitFor(
    async () => {
      const failure = await maybeJson(join(root, 'failure.json'));
      if (failure) throw Error(JSON.stringify(failure));
      return maybeJson(join(root, 'finished.json'));
    },
    Boolean,
    mode === 'no-health' ? 160000 : 60000,
  );
  await originalExit;
  await waitFor(
    async () => alive(finished.pid),
    (value) => !value,
    15000,
  );
  const after = await studioFingerprint();
  let settingsMetadataRetiredOnly = false;
  if (mode === 'success' && before['.pistudio/studio.json'] !== after['.pistudio/studio.json']) {
    const expected = retireLegacyFeatures(beforeSettings);
    if (
      !expected.changed ||
      !isDeepStrictEqual(
        parseStudio(expected.document),
        parseStudio(JSON.parse(await readFile(settingsFile, 'utf8'))),
      )
    )
      throw Error('Unexpected settings changes across the packaged update');
    settingsMetadataRetiredOnly = true;
    // Every other byte remains covered; this exception requires the exact validated migration.
    after['.pistudio/studio.json'] = before['.pistudio/studio.json'];
  }
  if (
    JSON.stringify(Object.entries(before).sort()) !== JSON.stringify(Object.entries(after).sort())
  )
    throw Error('Studio bytes changed across the packaged update');
  if (
    preferences !== (await digest(join(userData, 'workspace.json'))) ||
    credential !== (await digest(join(userData, 'qa-protected-credential.bin')))
  )
    throw Error('External settings/credential fixture changed');
  if (
    finished.version !== (mode === 'success' ? to : from) ||
    finished.startup !== (mode === 'success' ? 'committed' : 'restored')
  )
    throw Error('Wrong installed/recovered result');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', target]);
  await verifyInventory(target, 'darwin');
  const trace = (await readFile(join(root, 'trace.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  if (
    trace.filter((item) => item.event === 'consent').length !== 1 ||
    trace.filter((item) => item.event === 'request').length !== 1
  )
    throw Error('Update consent/request was repeated');
  if (trace.filter((item) => item.event === 'loaded').some((item) => item.visible))
    throw Error('QA stole OS focus');
  if ((await readdir(root)).some((name) => name.startsWith('.pistudio-update-')))
    throw Error('Transaction stage was retained');
  const proof = {
    checkedAt: new Date().toISOString(),
    mode,
    from,
    to,
    installedVersion: finished.version,
    sourceHead: run('git', ['rev-parse', 'HEAD']).trim(),
    signedNativeApplications: true,
    deepStrictSignatureAndInventoryAfterCycle: true,
    actualProductionCoordinatorInstallerHelperStartupAndRenderer: true,
    actualProgramDirectoryReplacement: true,
    oneUiConsent: true,
    oneUiUpdateRequest: true,
    restoredExactProject: true,
    studioFilesPreserved: Object.keys(before).length - Number(settingsMetadataRetiredOnly),
    settingsMetadataRetiredOnly,
    externalPreferencesAndDummyCredentialPreserved: true,
    allAppProcessesExited: true,
    transactionStageRemoved: true,
    processVersions: trace.filter((item) => item.event === 'starting').map((item) => item.version),
    modelOrTerminalRequests: 0,
    qaBoundaries: [
      'Ephemeral public key pin replaces exactly the compiled production pin in temporary copies',
      'Release HTTPS fetch is controlled; no real GitHub acceptance',
      'Pi startup is skipped and model/Terminal launch endpoints fail the test',
      'Temporary QA entry configures accessory/offscreen windows before loading unchanged application logic',
    ],
    productionSigningKeyUsedForQaMetadata: false,
    userStudioOrInstalledApplicationAccess: false,
    scope:
      'Real signed macOS app cycle in owned temporary installation, with controlled release transport/key. Not the final GitHub-to-installed-user-app or native Windows acceptance.',
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    `artifacts/packaged-update-${mode}-proof.json`,
    JSON.stringify(proof, null, 2) + '\n',
  );
  completed = true;
  console.log(JSON.stringify(proof));
} finally {
  if (!completed) {
    try {
      console.error((await readFile(join(root, 'trace.jsonl'), 'utf8')).slice(-6000));
    } catch {}
    // Test-only cleanup verifies the exact temporary executable before terminating a wedged QA app.
    let pids: number[] = [];
    try {
      pids = (await readFile(join(root, 'trace.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).pid);
    } catch {}
    for (const pid of new Set(pids))
      if (alive(pid)) {
        try {
          const command = run('/bin/ps', ['-p', String(pid), '-o', 'command=']);
          if (command.includes(join(root, 'Pi Studio.app/Contents/MacOS/Pi Studio')))
            process.kill(pid, 'SIGTERM');
        } catch {}
      }
    await sleep(500);
    for (const pid of new Set(pids))
      if (alive(pid)) {
        try {
          const command = run('/bin/ps', ['-p', String(pid), '-o', 'command=']);
          if (command.includes(join(root, 'Pi Studio.app/Contents/MacOS/Pi Studio')))
            process.kill(pid, 'SIGKILL');
        } catch {}
      }
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await recordBrowserCloneAudit(process.cwd(), 'update-test', browserClonesBefore);
}
