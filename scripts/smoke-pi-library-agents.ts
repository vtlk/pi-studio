import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { crc32, deflateSync } from 'node:zlib';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import { createLibraryRunHost } from '../src/main/pi/createLibraryRunHost.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';

// A real subscription request, isolated from the user's studio. No external paid generator.
const root = await mkdtemp(join(tmpdir(), 'pistudio-live-library-agents-'));
const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
const store = await service.load();
const references = new ReferenceFiles();
const pi = await checkPi('');
await store.saveSection('connections', [
  {
    id: 'qa',
    name: 'QA subscription',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
]);
const proof = 'QA_EDITED_LIBRARY_ROLE';
await store.saveSection(
  'systemAgents',
  (store.bootstrap().sections.systemAgents as SystemAgent[]).map((agent) =>
    agent.systemRole === 'assistant'
      ? agent
      : {
          ...agent,
          mainInstruction:
            agent.mainInstruction + `\nInclude roleProof ${proof} in observation.json.`,
          model: {
            connectionId: 'qa',
            provider: 'openai-codex',
            id: 'gpt-6.1-sol',
            reasoning: 'Низкий',
            temperature: '',
          },
        },
  ),
);
function image() {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name),
      head = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([head, type, data, crc]);
  };
  const width = 256,
    height = 256,
    header = Buffer.alloc(13),
    rows = Buffer.alloc(height * (1 + width * 3));
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = y >= 40 && y <= 215 && Math.abs(x - 128) < (y - 40) * 0.52;
      rows.set(inside ? [235, 25, 35] : [255, 255, 255], y * (1 + width * 3) + 1 + x * 3);
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
await mkdir(join(root, 'inputs'));
const imagePath = join(root, 'inputs/reference.png');
await writeFile(imagePath, image());
const children: Promise<number | null>[] = [];
const host = createLibraryRunHost(service, {
  bootstraps: join(root, 'boots'),
  bridge: new URL('../bundled/pi-bridge/session.mjs', import.meta.url).pathname,
  catalog: new URL('../bundled/pi-bridge/catalog.mjs', import.meta.url).pathname,
  piPath: () => pi.path,
  references,
  headless: true,
  openTerminal: async (node, bridge, bootstrap) => {
    const child = spawn(node, [bridge, bootstrap], {
      stdio: 'ignore',
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
    });
    children.push(
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      }),
    );
  },
});
try {
  for (const kind of ['characters', 'locations'] as const) {
    const files = await references.select([imagePath], store.folder);
    const launched = await host.create({
      kind,
      attachments: files.map((file) => file.id),
      description: `This is an isolated publication test. Inspect the image already attached to this message. Write output/observation.json with English keys shape and color identifying the dominant geometric shape and its color from the visual input, plus roleProof required by your current role. Do not infer its content from the filename. Call library_get_contract and library_prepare_asset for kind ${kind} and title "QA ${kind}". For this test only, copy the saved input image to reference.png and preview.png in the returned staging directory using native bash. Then call library_validate_asset and library_publish_asset, save their returned asset ID/version to output/publication.json, and call complete_stage with observation.json and publication.json. No external generation, no network lookup, no changes outside this isolated service workspace. Do not ask questions.`,
    });
    assert.equal(await children.at(-1), 0);
    const project = launched.project;
    const directory = join(store.folder, '.pistudio/library-runs', project.id);
    const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
    const agent = state.project.agents[0];
    assert.equal(agent.runStatus, 'ready');
    const observation = JSON.parse(
      await readFile(join(directory, agent.outputPath, 'observation.json'), 'utf8'),
    );
    assert.match(observation.shape.toLowerCase(), /triangle/);
    assert.match(observation.color.toLowerCase(), /red/);
    assert.equal(observation.roleProof, proof);
    const transcript = (await readFile(join(directory, agent.session.path), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const messages = transcript
      .filter((item) => item.type === 'message')
      .map((item) => item.message);
    assert.ok(
      messages.some(
        (message) =>
          message.role === 'user' &&
          message.content.some((part: { type: string }) => part.type === 'image'),
      ),
      'The actual first Pi message must contain image content.',
    );
    for (const tool of ['library_prepare_asset', 'library_validate_asset', 'library_publish_asset'])
      assert.ok(
        messages.some(
          (message) =>
            message.role === 'toolResult' &&
            message.toolName === `mcp__pi_studio__${tool}` &&
            !message.isError,
        ),
        `Successful real ${tool} required`,
      );
    assert.ok(
      messages.some(
        (message) =>
          message.role === 'toolResult' && message.toolName === 'bash' && !message.isError,
      ),
    );
    assert.ok(
      !messages.some(
        (message) =>
          message.role === 'toolResult' && message.toolName === 'mcp__pi_studio__configure_agent',
      ),
    );
  }
  const listing = await store.library.list();
  assert.deepEqual(listing.assets.map((asset) => asset.library.kind).sort(), [
    'characters',
    'locations',
  ]);
  assert.deepEqual(store.bootstrap().projects, []);
  assert.deepEqual(store.bootstrap().sections.agents, []);
  assert.equal((await readdir(join(store.folder, '.pistudio/library-runs'))).length, 2);
  console.log(
    'Real library system agents passed: matching edited profiles, visual image content recognized without textual clues, native bash and successful library validation/publication for both kinds, canonical sessions outside project list, no administrative tools.',
  );
} finally {
  host.close();
  await Promise.allSettled(children);
  await rm(root, { recursive: true, force: true });
}
