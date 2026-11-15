import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { closeSuccessfulRun, AutomaticCloseError } from '../src/main/pi/automaticClose.ts';
import {
  captureMacTab,
  captureMacTabScript,
  closeMacTabScript,
} from '../src/main/pi/terminal-close/macTerminal.ts';
import {
  ensureWindowsProfile,
  verifyWindowsProfile,
  checkWindowsProfileSettings,
  studioTerminalProfile,
} from '../src/main/pi/terminal-close/windowsProfile.ts';
import { captureWindowsTab } from '../src/main/pi/terminal-close/windowsTerminal.ts';
import { validateCompletedOutputs } from '../src/main/pi/completeStage.ts';
import {
  ContinuationCancelled,
  type LiveRun,
  type RunDependencies,
} from '../src/main/pi/RunTypes.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
async function fixture(t: { after: (action: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-auto-close-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'agents/agent'),
    output = join(cwd, 'output'),
    sessions = join(cwd, 'sessions');
  await mkdir(output, { recursive: true });
  await mkdir(sessions);
  await writeFile(join(output, 'result.txt'), 'KEEP_RESULT');
  await writeFile(join(sessions, 'exact.jsonl'), '{"type":"session","id":"exact"}\n');
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  t.after(async () => {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    await exited;
  });
  const run = {
    projectRoot: root,
    project: { id: 'project', name: 'Project' },
    agent: { profile: { id: 'agent', name: 'Agent' } },
    record: {
      runId: 'owned-run',
      projectId: 'project',
      agentId: 'agent',
      cwd,
      output,
      sessionDirectory: sessions,
    },
  } as PreparedRun;
  let stops = 0,
    closes = 0,
    removes = 0;
  const bound = {
    id: 'exact',
    path: 'agents/agent/sessions/exact.jsonl',
    title: 'Agent',
    createdAt: 1,
  };
  const live = {
    run,
    bound,
    sequence: 1,
    status: 'ready',
    blocked: false,
    pid: child.pid,
    request: { autoContinue: true },
    completion: await validateCompletedOutputs(output, ['result.txt']),
    stop: () => {
      stops++;
      child.kill('SIGTERM');
    },
  } as LiveRun;
  await writeFile(
    join(cwd, '.pistudio-session-lock.json'),
    JSON.stringify({ pid: child.pid, runId: 'owned-run' }),
  );
  let permitted = true;
  const check = () => {
    if (!permitted || live.sequence !== 1 || live.status !== 'ready')
      throw new ContinuationCancelled();
  };
  const state = {
    live: new Map([['project/agent', live]]),
    retiring: new Map<string, Promise<void>>(),
    dependencies: {
      bridge: '/bridge/session.mjs',
      captureTerminal: async () => ({
        verify: async () => {},
        close: async () => {
          closes++;
        },
      }),
    } as RunDependencies,
    removeChannel: () => {
      removes++;
    },
  };
  return {
    root,
    cwd,
    sessions,
    output,
    run,
    live,
    state,
    check,
    cancel: () => {
      permitted = false;
    },
    counts: () => ({ stops, closes, removes }),
    child,
  };
}

test('successful auto close preserves exact transcript/output, shuts down owned process before tab and releases only its lease (host fixture)', async (t) => {
  const f = await fixture(t);
  const before = await readFile(join(f.sessions, 'exact.jsonl'));
  await closeSuccessfulRun(f.run, 1, f.check, f.state);
  assert.deepEqual(f.counts(), { stops: 1, closes: 1, removes: 1 });
  assert.equal(f.live.status, 'ready');
  assert.equal(f.live.bound!.id, 'exact');
  assert.deepEqual(await readFile(join(f.sessions, 'exact.jsonl')), before);
  assert.equal(await readFile(join(f.output, 'result.txt'), 'utf8'), 'KEEP_RESULT');
  await assert.rejects(readFile(join(f.cwd, '.pistudio-session-lock.json')), { code: 'ENOENT' });
  assert.equal(f.state.retiring.size, 0);
  assert.throws(() => closeSuccessfulRun(f.run, 1, f.check, f.state), ContinuationCancelled);
});

test('new admitted input or cancellation during tab capture prevents shutdown and close (host fixture)', async (t) => {
  for (const mode of ['input', 'cancel']) {
    const f = await fixture(t),
      entered = deferred(),
      release = deferred();
    f.state.dependencies.captureTerminal = async () => {
      entered.resolve();
      await release.promise;
      return {
        verify: async () => {},
        close: async () => {
          throw new Error('Must not close');
        },
      };
    };
    const pending = closeSuccessfulRun(f.run, 1, f.check, f.state);
    await entered.promise;
    assert.equal(f.state.retiring.size, 1, 'Reopen/moves wait for owned cleanup');
    if (mode === 'input') {
      f.live.sequence++;
      f.live.status = 'running';
    } else f.cancel();
    release.resolve();
    await assert.rejects(pending, ContinuationCancelled);
    assert.deepEqual(f.counts(), { stops: 0, closes: 0, removes: 0 });
    assert.equal(f.child.exitCode, null);
  }
});

test('changed outputs, missing transcript, and denied terminal capture retain the process/result and pause honestly', async (t) => {
  for (const mode of ['outputs', 'transcript', 'permission']) {
    const f = await fixture(t);
    if (mode === 'outputs') await writeFile(join(f.output, 'result.txt'), 'CHANGED_RESULT');
    if (mode === 'transcript') await rm(join(f.sessions, 'exact.jsonl'));
    if (mode === 'permission')
      f.state.dependencies.captureTerminal = async () => {
        throw new Error('Automation denied');
      };
    await assert.rejects(
      closeSuccessfulRun(f.run, 1, f.check, f.state),
      (error: Error) =>
        error instanceof AutomaticCloseError &&
        error.failure === (mode === 'outputs' ? 'outputs' : 'terminal_close'),
    );
    assert.deepEqual(f.counts(), { stops: 0, closes: 0, removes: 0 });
    assert.equal(f.child.exitCode, null);
  }
});

test('foreign replacement lease is preserved after successful owned shutdown (host fixture)', async (t) => {
  const f = await fixture(t);
  f.state.dependencies.captureTerminal = async () => ({
    verify: async () => {},
    close: async () => {
      await writeFile(
        join(f.cwd, '.pistudio-session-lock.json'),
        JSON.stringify({ pid: 98765, runId: 'foreign-run' }),
      );
    },
  });
  await closeSuccessfulRun(f.run, 1, f.check, f.state);
  assert.deepEqual(JSON.parse(await readFile(join(f.cwd, '.pistudio-session-lock.json'), 'utf8')), {
    pid: 98765,
    runId: 'foreign-run',
  });
});

test('macOS capture verifies exact PID start/command and closes only original empty TTY/window/title; scripts compile without running Terminal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-close-scripts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls: string[][] = [];
  let reused = false,
    terminalRestarted = false;
  const executor = async (file: string, args: string[]) => {
    calls.push([file, ...args]);
    if (file === '/usr/bin/pgrep') return { stdout: terminalRestarted ? '100' : '99' };
    if (file === '/bin/ps' && args.includes('comm='))
      return {
        stdout:
          'Sun Nov 15 01:00:00 2026 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
      };
    if (file === '/bin/ps')
      return {
        stdout: `ttys042 Sun Nov 15 ${reused ? '02' : '01'}:00:00 2026 /node/session.mjs /boot/owned-run.json`,
      };
    assert.equal(file, '/usr/bin/osascript');
    assert.doesNotMatch(args[1], /activate|do script|keystroke|launch|close window/);
    if (process.platform === 'darwin')
      await promisify(execFile)('/usr/bin/osacompile', [
        '-o',
        join(root, 'close.scpt'),
        '-e',
        args[1],
      ]);
    return { stdout: args[1] === captureMacTabScript ? '55\t/dev/ttys042' : 'closed' };
  };
  const handle = await captureMacTab(
    123,
    'owned-run',
    '/bridge/session.mjs',
    'Agent · Project',
    executor,
  );
  await handle.verify();
  reused = true;
  await assert.rejects(handle.verify(), /безопасно/);
  reused = false;
  await handle.close();
  const closeCalls = calls.filter((call) => call[2] === closeMacTabScript).length;
  terminalRestarted = true;
  await assert.rejects(handle.close(), /безопасно/);
  assert.equal(
    calls.filter((call) => call[2] === closeMacTabScript).length,
    closeCalls,
    'Restarted Terminal with reused window IDs is never targeted',
  );
  terminalRestarted = false;
  const close = calls.find((call) => call[2] === closeMacTabScript)!;
  assert.deepEqual(close.slice(-3), ['55', '/dev/ttys042', 'Agent · Project']);
  assert.match(closeMacTabScript, /count of processes of terminalTab/);
  assert.match(closeMacTabScript, /count of tabs of terminalWindow/);
  assert.match(closeMacTabScript, /close terminalWindow/);
  assert.doesNotMatch(closeMacTabScript, /close terminalTab/);
  assert.match(closeMacTabScript, /id of terminalWindow is not targetWindow/);
  assert.match(closeMacTabScript, /custom title of terminalTab is not item 3/);
  await assert.rejects(
    captureMacTab(123, 'owned-run', '/bridge/session.mjs', 'Title', async () => ({
      stdout: 'ttys042 wrong-other.json',
    })),
    /безопасно/,
  );
});

test('Windows owned fragment and JSONC settings honor user overrides without modifying global profiles', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-wt-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await ensureWindowsProfile(root), studioTerminalProfile);
  const path = await verifyWindowsProfile(root),
    before = await readFile(path, 'utf8');
  await ensureWindowsProfile(root);
  assert.equal(await readFile(path, 'utf8'), before);
  checkWindowsProfileSettings('{ // Comment\n "profiles": {"list": [],}, }');
  assert.throws(
    () =>
      checkWindowsProfileSettings(
        `{"profiles":{"list":[{"guid":"${studioTerminalProfile}","closeOnExit":"never"}]}}`,
      ),
    /оставлять вкладку/,
  );
  assert.throws(
    () => checkWindowsProfileSettings('{ "profiles": { "defaults": { "closeOnExit": "never" } } }'),
    /оставлять вкладку/,
  );
  assert.throws(
    () => checkWindowsProfileSettings('{"disabledProfileSources":["PiStudio"]}'),
    /отключён/,
  );
  assert.throws(() => checkWindowsProfileSettings('{"profiles": '), /прочитать/);
  const identity = {
    kind: 'windows-terminal' as const,
    profileId: studioTerminalProfile,
    sessionId: '1076cb1c-0735-4e39-933f-88c890460ed1',
  };
  let reused = false;
  const handle = await captureWindowsTab(
    123,
    'owned-run',
    '/bridge/session.mjs',
    identity,
    async (_file, args) => {
      const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
      assert.match(script, /Get-CimInstance/);
      assert.doesNotMatch(script, /Stop-Process|SendKeys|WM_CLOSE/);
      return {
        stdout: JSON.stringify({
          ProcessId: 123,
          CreationDate: reused ? 'new' : 'original',
          CommandLine: 'node session.mjs /boot/owned-run.json',
        }),
      };
    },
    root,
  );
  await handle.verify();
  reused = true;
  await assert.rejects(handle.verify(), /переиспользован/);
  await assert.rejects(
    captureWindowsTab(
      123,
      'owned-run',
      '/bridge/session.mjs',
      { ...identity, profileId: 'foreign' },
      async () => {
        throw new Error('Must not run');
      },
      root,
    ),
  );
  assert.equal(await readFile(path, 'utf8'), before);
});

test('manual mode, blocked state, stale sequence and unfinished own operations never admit auto close', async (t) => {
  for (const mode of ['manual', 'blocked', 'stale', 'operation']) {
    const f = await fixture(t);
    if (mode === 'manual') f.live.request.autoContinue = false;
    if (mode === 'blocked') f.live.blocked = true;
    if (mode === 'operation')
      f.state.dependencies.beforeAutomaticClose = () => {
        throw new Error('Own image operation still active');
      };
    const invoke = () => closeSuccessfulRun(f.run, mode === 'stale' ? 2 : 1, f.check, f.state);
    if (mode === 'operation') await assert.rejects(invoke(), AutomaticCloseError);
    else assert.throws(invoke, ContinuationCancelled);
    assert.deepEqual(f.counts(), { stops: 0, closes: 0, removes: 0 });
  }
});
