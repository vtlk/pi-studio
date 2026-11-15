import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, realpath, cp } from 'node:fs/promises';
import { join, resolve, basename, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { Resource } from '../src/shared/resources.ts';

/** Temporary QA-only package. Runtime auth remains in native Pi; model bash gets no env secrets. */
export async function qaToolScope(root: string, output: string) {
  root = await realpath(root);
  output = await realpath(output);
  assert.equal(
    dirname(root),
    await realpath(tmpdir()),
    'QA scope requires an owned temporary workspace.',
  );
  assert.match(basename(root), /^pistudio-[a-z-]+-[A-Za-z0-9]+$/);
  const nested = relative(root, output);
  assert.ok(
    nested && nested !== '..' && !nested.startsWith('..' + sep),
    'QA output must stay within its temporary workspace.',
  );
  const source = join(root, 'qa-tool-scope'),
    temp = join(output, '.qa-tmp'),
    home = join(output, '.qa-home');
  for (const path of [source, temp, home]) await mkdir(path, { recursive: true });
  const profile = join(source, 'scope.sb'),
    audit = join(source, 'audit.jsonl');
  await writeFile(
    profile,
    [
      '(version 1)',
      '(allow default)',
      '(deny file-write*)',
      '(deny network*)',
      '(deny process-info*)',
      '(allow process-info* (target self))',
      '(deny file-read* (subpath (param "QA_HOME")))',
      '(allow file-write* (subpath (param "QA_OUTPUT")))',
      '(allow file-write* (literal "/dev/null"))',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(source, 'scope.json'),
    JSON.stringify({
      root,
      output,
      temp,
      home,
      realHome: await realpath(homedir()),
      profile,
      audit,
    }),
  );
  await cp(resolve('scripts/qa-tool-scope-extension.mjs'), join(source, 'extension.mjs'));
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({
      name: 'pi-studio-owned-qa-scope',
      version: '1.0.0',
      type: 'module',
      pi: { extensions: ['./extension.mjs'] },
    }),
  );
  // Actual sandbox preflight touches only owned canaries, not any user data/home file.
  const blockedHome = join(source, 'blocked-home');
  await mkdir(blockedHome, { recursive: true });
  const canary = join(source, 'write-canary.txt'),
    readCanary = join(blockedHome, 'read-canary.txt'),
    allowed = join(temp, 'allowed.txt');
  await writeFile(canary, 'PRESERVE_QA_CANARY');
  await writeFile(readCanary, 'PRIVATE_QA_READ_CANARY');
  const probe = execFileSync(
    '/usr/bin/sandbox-exec',
    [
      '-D',
      'QA_OUTPUT=' + output,
      '-D',
      'QA_HOME=' + blockedHome,
      '-f',
      profile,
      '/opt/homebrew/bin/python3',
      '-c',
      'import os,sys\nopen(sys.argv[1],"w").write("allowed")\nfor op in [lambda:open(sys.argv[2],"w"),lambda:open(sys.argv[3]).read()]:\n try:op()\n except PermissionError:continue\n raise RuntimeError("QA sandbox boundary failed")\nprint("qa-sandbox-ok")',
      allowed,
      canary,
      readCanary,
    ],
    { encoding: 'utf8' },
  );
  assert.ok(probe.includes('qa-sandbox-ok'));
  assert.equal(await readFile(canary, 'utf8'), 'PRESERVE_QA_CANARY');
  // Check the exact hook's quoting/env wrapper before giving it to native Pi.
  let hook: any;
  await (
    await import(pathToFileURL(join(source, 'extension.mjs')).href + '?preflight=' + Date.now())
  ).default({
    on: (name: string, action: unknown) => {
      assert.equal(name, 'tool_call');
      hook = action;
    },
  });
  const quote = (text: string) => "'" + text.replaceAll("'", "'\"'\"'") + "'";
  const code =
    'import os,socket\nassert "QA_SECRET_CANARY" not in os.environ\nassert os.environ["HOME"]==' +
    JSON.stringify(home) +
    '\ntry:open(' +
    JSON.stringify(canary) +
    ',"w")\nexcept PermissionError:pass\nelse:raise RuntimeError("write escaped")\ntry:open(' +
    JSON.stringify(resolve('package.json')) +
    ').read()\nexcept PermissionError:pass\nelse:raise RuntimeError("home read escaped")\ntry:socket.socket().connect(("127.0.0.1",9))\nexcept PermissionError:pass\nelse:raise RuntimeError("network escaped")\nprint("qa-hook-ok")';
  const event = { toolName: 'bash', input: { command: 'python3 -c ' + quote(code) } };
  assert.equal(await hook(event, { cwd: output }), undefined);
  const hookProbe = execFileSync('/bin/bash', ['-c', event.input.command], {
    cwd: output,
    encoding: 'utf8',
    env: { ...process.env, QA_SECRET_CANARY: 'SYNTHETIC_NOT_A_CREDENTIAL' },
  });
  assert.ok(hookProbe.includes('qa-hook-ok'));
  assert.equal(
    (await hook({ toolName: 'write', input: { path: canary } }, { cwd: output })).block,
    true,
  );
  assert.equal(
    await hook({ toolName: 'write', input: { path: join(temp, 'new-file.txt') } }, { cwd: output }),
    undefined,
  );
  await writeFile(audit, '');
  return {
    resource: {
      id: 'qa-tool-scope',
      kind: 'plugins',
      name: 'Owned QA tool scope',
      source,
      version: '',
      description: 'Temporary QA-only bash/files guard; not a product resource.',
      transport: '',
      args: '',
      credential: '',
      contents: '',
      createdAt: 1,
    } as Resource,
    audit,
    preflight: {
      ownedOutputWriteAllowed: true,
      outsideOutputWriteDenied: true,
      protectedReadDenied: true,
      canaryUnchanged: true,
      exactHookWrapperChecked: true,
      secretEnvNotInheritedByBash: true,
      bashNetworkDenied: true,
      fileToolPathGuardChecked: true,
    },
  };
}
