import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import {
  openWindowsSession,
  focusWindowsSession,
  openWindowsPowerShellCommand,
} from '../src/main/pi/windowsTerminal.ts';

const id = '4de37ae6-f61b-4845-a13f-e04a3e1f58b7';
const wt = 'C:/Users/Тест/Microsoft/WindowsApps/wt.exe';
const profile = '{c933e1ec-8539-47f2-baf7-d984ea553a48}';
type Call = {
  file: string;
  args: string[];
  options: { windowsHide: boolean; detached?: boolean; stdio?: string };
};
function spawnRecorder(calls: Call[], failure = false) {
  let unreferenced = false;
  const create = ((file: string, args: string[], options: Call['options']) => {
    calls.push({ file, args, options });
    const child = Object.assign(new EventEmitter(), {
      unref: () => {
        unreferenced = true;
      },
    });
    queueMicrotask(() =>
      child.emit(
        failure ? 'error' : 'spawn',
        ...(failure ? [Error('Cannot create Terminal')] : []),
      ),
    );
    // A GUI process stays alive: no exit/close event is emitted.
    return child;
  }) as unknown as typeof spawn;
  return { create, unreferenced: () => unreferenced };
}

test('Pi session opens a visible Terminal and keeps paths as encoded literal data', async () => {
  const calls: Call[] = [];
  const child = spawnRecorder(calls);
  const node = "C:/Users/O'Brien $x/Node/node.exe";
  const bridge = 'C:/Program Files/Pi Studio/session.mjs';
  const bootstrap = `C:/Users/Тест/Bootstraps/${id}.json`;
  await openWindowsSession(node, bridge, bootstrap, 'Помощник; "Настройка"\n', {
    terminal: async () => wt,
    profile: async () => profile,
    spawn: child.create,
  });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.file, wt);
  assert.equal(call.options.windowsHide, false, 'Interactive GUI must not receive SW_HIDE');
  assert.equal(call.options.detached, true);
  assert.equal(call.options.stdio, 'ignore');
  assert.equal(
    child.unreferenced(),
    true,
    'Opening finishes on spawn without waiting for GUI exit',
  );
  assert.deepEqual(call.args.slice(0, 5), [
    '-w',
    `pi-studio-${id}`,
    'new-tab',
    '--profile',
    profile,
  ]);
  assert.equal(call.args[call.args.indexOf('--title') + 1], 'Помощник   Настройка  ');
  assert.ok(call.args.includes('--suppressApplicationTitle'));
  const decoded = Buffer.from(call.args.at(-1)!, 'base64').toString('utf16le');
  assert.ok(decoded.includes(`& 'C:/Users/O''Brien $x/Node/node.exe' '${bridge}' '${bootstrap}'`));
  assert.ok(decoded.includes("$env:PI_TELEMETRY = '0'"));
  assert.ok(decoded.includes('exit $LASTEXITCODE'));
});

test('focusing an exact dialogue keeps the probe hidden and the selected Terminal visible', async () => {
  const calls: Call[] = [];
  const child = spawnRecorder(calls);
  await focusWindowsSession(1234, {
    terminal: async () => wt,
    spawn: child.create,
    execute: async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: `node.exe C:/Studio/session.mjs C:/Bootstraps/${id}.json` };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.windowsHide, true);
  assert.match(
    Buffer.from(calls[0].args.at(-1)!, 'base64').toString('utf16le'),
    /ProcessId = 1234/,
  );
  assert.equal(calls[1].file, wt);
  assert.equal(calls[1].options.windowsHide, false);
  assert.deepEqual(calls[1].args, ['-w', `pi-studio-${id}`, 'focus-tab', '-t', '0']);
});

test('explicit interactive CLI commands also open a visible Terminal', async () => {
  const calls: Call[] = [];
  const child = spawnRecorder(calls);
  await openWindowsPowerShellCommand("Write-Output 'explicit CLI'", 'Pi CLI', {
    terminal: async () => wt,
    spawn: child.create,
  });
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.file, wt);
  assert.equal(call.options.windowsHide, false);
  assert.ok(Buffer.from(call.args.at(-1)!, 'base64').toString('utf16le').includes('explicit CLI'));
});

test('a missing Terminal remains an explicit launch error, without a substitute shell', async () => {
  let invoked = false;
  await assert.rejects(
    openWindowsSession('node', 'session.mjs', `${id}.json`, 'Pi', {
      profile: async () => profile,
      terminal: async () => {
        throw Error('Windows Terminal not found');
      },
      spawn: (() => {
        invoked = true;
        throw Error('No substitute');
      }) as unknown as typeof spawn,
    }),
    /Windows Terminal not found/,
  );
  assert.equal(invoked, false);
});

test('a Terminal spawn failure is propagated rather than reported as a successful opening', async () => {
  const calls: Call[] = [];
  const child = spawnRecorder(calls, true);
  await assert.rejects(
    openWindowsSession('node', 'session.mjs', `${id}.json`, 'Pi', {
      terminal: async () => wt,
      profile: async () => profile,
      spawn: child.create,
    }),
    /Cannot create Terminal/,
  );
  assert.equal(child.unreferenced(), false);
});
