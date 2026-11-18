import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import * as files from '../src/main/storage/files.ts';
import { stableId } from '../src/main/storage/validation.ts';
import { outputScope } from '../src/main/storage/outputScope.ts';
import { readProjectScope } from '../src/main/storage/projectReadScope.ts';
import { desktopChannels } from '../src/shared/contracts.ts';
import { t } from '../src/shared/i18n/index.ts';
import { projectAgentOutputPath } from '../src/shared/agentPaths.ts';

test('reveal validates the exact output path without reading file contents or blocking behind Pi writes', async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'pistudio-reveal-output-'));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const service = new StudioService(join(temporary, 'prefs.json'), join(temporary, 'Studio'));
  const store = await service.load();
  const project = (
    await store.command({
      kind: 'create',
      name: 'Reveal',
      agents: [
        { id: 'a', name: 'A', enabled: true, skills: [], mcps: [], plugins: [], instructions: [] },
      ],
    })
  ).projects[0];
  const root = await store.projects.directory(project.id),
    path = project.agents[0].outputPath + '/large.txt';
  await writeFile(join(root, path), 'x'.repeat(3 * 1024 * 1024));
  const handlers = new Map<string, Function>(),
    revealed: string[] = [];
  const exported: any = {};
  const source = ts.transpileModule(
    await readFile('src/main/storage/registerProjectActions.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  // Inject a real stat-only implementation; no shell or native Finder/Explorer is opened.
  const { lstat } = await import('node:fs/promises');
  const statSource = source.replace('require("node:fs/promises")', 'require("qa:stat")');
  runInNewContext(statSource, {
    exports: exported,
    require: (name: string) => {
      if (name === 'qa:stat') return { lstat };
      if (name === 'electron')
        return { shell: { showItemInFolder: (path: string) => revealed.push(path) } };
      if (name.includes('desktopInvoke'))
        return {
          handleDesktopInvoke: (name: string, handler: Function) => handlers.set(name, handler),
        };
      if (name.includes('i18n')) return { t };
      if (name.includes('agentPaths')) return { projectAgentOutputPath };
      if (name.includes('contracts')) return { desktopChannels };
      if (name.includes('validation')) return { stableId };
      if (name === './files') return files;
      if (name.includes('outputs'))
        return {
          loadOutput: () => {
            throw Error('Reveal must not read text contents');
          },
        };
      if (name.includes('outputScope')) return { outputScope };
      if (name.includes('projectReadScope')) return { readProjectScope };
      if (name.includes('deleteAgentData')) return {};
      throw Error('Unexpected module: ' + name);
    },
  });
  exported.registerProjectActions(service, () => {}, {});
  let release!: () => void;
  const pending = service.serialize(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await new Promise((done) => setImmediate(done));
  try {
    const handler = handlers.get(desktopChannels.revealOutput)!;
    await handler({}, { projectId: project.id, path });
    assert.deepEqual(revealed, [join(root, path)]);
    await assert.rejects(handler({}, { projectId: project.id, path: '../prefs.json' }));
    await assert.rejects(
      handler({}, { projectId: project.id, path: '.pistudio/sessions/a/private.jsonl' }),
    );
    if (process.platform !== 'win32') {
      const link = project.agents[0].outputPath + '/link.txt';
      await symlink(join(temporary, 'prefs.json'), join(root, link));
      await assert.rejects(handler({}, { projectId: project.id, path: link }));
    }
    assert.equal(revealed.length, 1, 'Rejected paths never reach the OS opener');
  } finally {
    release();
    await pending;
  }
});
