import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { EmbeddedChat } from '../src/main/pi/EmbeddedChat.ts';
import { stopOwnedChat } from '../src/main/pi/stopOwnedChat.ts';

for (const label of ['project agent', 'setup assistant']) {
  test(`${label}: exit waits for owned RPC shutdown; unrelated processes survive`, async (t) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        "process.stdin.resume(); process.stdin.on('end',()=>setTimeout(()=>process.exit(0),80)); console.log('ready')",
      ],
      { detached: true, stdio: 'pipe' },
    );
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      stdio: 'ignore',
    });
    t.after(() => {
      child.kill('SIGKILL');
      unrelated.kill();
    });
    await once(child.stdout, 'data');
    let finished = false;
    const closing = stopOwnedChat(child).then(() => {
      finished = true;
    });
    assert.equal(finished, false);
    await closing;
    assert.equal(child.exitCode, 0);
    process.kill(unrelated.pid!, 0);
  });
}
test('unresponsive owned RPC is escalated and awaited, without a fire-and-forget timer', async (t) => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.stdin.resume(); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); console.log('ready')",
    ],
    { detached: true, stdio: 'pipe' },
  );
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  await stopOwnedChat(child, { graceMs: 30, forceMs: 40 });
  assert.equal(child.signalCode, 'SIGKILL');
});
test('Windows fallback kills only the owned PID tree, hidden, and waits for confirmed close', async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    stdin: { end() {} },
  });
  let call: unknown[] = [];
  const pending = stopOwnedChat(child as unknown as ChildProcessWithoutNullStreams, {
    platform: 'win32',
    graceMs: 1,
    exec: ((...args: unknown[]) => {
      call = args.slice(0, 3);
      setImmediate(() => {
        (child as { exitCode: number | null }).exitCode = 1;
        child.emit('close');
      });
      (args[3] as (error: null) => void)(null);
    }) as never,
  });
  await pending;
  assert.match(String(call[0]), /taskkill.exe$/);
  assert.deepEqual(call[1], ['/PID', '12345', '/T', '/F']);
  assert.equal((call[2] as { windowsHide: boolean }).windowsHide, true);
});

test('quit admission is checked immediately before spawn, after asynchronous platform dependency discovery', async () => {
  let checked = false;
  await assert.rejects(
    EmbeddedChat.start(
      process.execPath,
      'unused-bridge',
      'unused-bootstrap',
      { projectId: 'project', agentId: 'assistant' },
      'run',
      'model',
      'off',
      () => {},
      () => {
        checked = true;
        throw new Error('Studio is closing');
      },
    ),
    /Studio is closing/,
  );
  assert.equal(checked, true);
});
