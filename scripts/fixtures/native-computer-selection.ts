// Read only the current explicit model selection. Native Pi alone reads credentials.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { checkPi } from '../../src/main/pi/checkPi.ts';
import { resolveAgentLaunchConfig } from '../../src/main/pi/resolveAgentLaunchConfig.ts';
import type { Agent } from '../../src/shared/studio.ts';
import type { Connection } from '../../src/shared/connections.ts';

const output = process.argv[2];
assert.ok(output?.includes('/pistudio-native-computer-'));
const userData = join(homedir(), 'Library/Application Support/Pi Studio');
const workspace = JSON.parse(await readFile(join(userData, 'workspace.json'), 'utf8'));
const { sections } = JSON.parse(
  await readFile(join(workspace.folder, '.pistudio/studio.json'), 'utf8'),
);
const helper = (sections.systemAgents as Agent[]).find(
  (agent) => (agent as Agent & { systemRole?: string }).systemRole === 'assistant',
);
assert.ok(helper, 'Current setup assistant selection is required; no fallback model.');
const pi = await checkPi(String(sections.piPath ?? ''));
assert.equal(pi.supported, true);
const bridge = join(
  homedir(),
  'Applications/Pi Studio.app/Contents/Resources/app/bundled/pi-bridge/session.mjs',
);
const resolved = await resolveAgentLaunchConfig(
  helper.model,
  sections.connections as Connection[],
  {
    folder: workspace.folder,
    piPath: pi.path,
    bootstraps: join(userData, 'bootstraps'),
    catalog: join(bridge, '../catalog.mjs'),
  },
);
assert.equal(
  resolved.selectedModel.imageInput,
  true,
  'Selected model must natively accept images.',
);
await writeFile(
  output,
  JSON.stringify({ piPath: pi.path, piVersion: pi.version, bridge, ...resolved }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    model: resolved.model.provider + '/' + resolved.model.id,
    effort: resolved.thinkingLevel,
    scoped: !!resolved.modelAuth,
    imageInput: true,
  }),
);
