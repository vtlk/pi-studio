import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAssignedPackages } from '../bundled/pi-bridge/packages.mjs';

test('selected packages cannot silently disappear after an install failure or empty resolution', async () => {
  const assigned = [{ source: 'npm:one@1.0.0' }, { source: 'npm:two@1.0.0' }];
  const paths = {
    extensions: [
      { enabled: true, path: '/one/extension.ts', metadata: { source: assigned[0].source } },
    ],
    skills: [],
    prompts: [],
    themes: [],
  };
  const sdk = (result: unknown) => ({
    getAgentDir: () => '/agent',
    DefaultPackageManager: class {
      async resolveExtensionSources() {
        return result;
      }
    },
  });
  await assert.rejects(
    resolveAssignedPackages(
      sdk({ ...paths, installFailures: [{ source: assigned[1].source }] }),
      '/cwd',
      {},
      assigned,
    ),
    /could not be installed/,
  );
  await assert.rejects(
    resolveAssignedPackages(sdk(paths), '/cwd', {}, assigned),
    /no available resources/,
  );
  const valid = {
    ...paths,
    skills: [
      { enabled: true, path: '/two/SKILL.md', metadata: { source: assigned[1].source } },
      { enabled: false, path: '/two/disabled.md', metadata: { source: assigned[1].source } },
    ],
  };
  assert.deepEqual(await resolveAssignedPackages(sdk(valid), '/cwd', {}, assigned), {
    extensions: ['/one/extension.ts'],
    skills: ['/two/SKILL.md'],
    prompts: [],
    themes: [],
  });
});
