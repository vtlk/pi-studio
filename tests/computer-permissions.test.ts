import test from 'node:test';
import assert from 'node:assert/strict';
import type { CuaDriverLike } from '@trycua/cua-driver';
import { CuaRuntime } from '../src/main/computer/CuaRuntime.ts';
import { ComputerSupport } from '../src/main/computer/ComputerSupport.ts';
import {
  computerPermissions,
  ComputerPermissionCheckError,
} from '../src/main/computer/computerPermissions.ts';

// Exact SDK 0.49.11 contract: platform-windows/src/tools/check_permissions.rs at
// trycua/cua b3dafe7f47ab40a5d00c5023855317a2e901c062. No desktop/native driver is invoked.
const windows = { uia: true, post_message: true, elevated: false, integrity_level: 'Medium' };
function fixture(platform: NodeJS.Platform, payload: unknown = windows) {
  const calls: { name: string; args: unknown }[] = [];
  const driver = {
    callTool: async (name: string, args: string) => {
      calls.push({ name, args: JSON.parse(args) });
      return { structuredJson: JSON.stringify(payload) };
    },
    listToolsJson: async () =>
      JSON.stringify([
        {
          name: 'check_permissions',
          inputSchema: { properties: { prompt: {}, probe_direct_capture: {} } },
        },
      ]),
    shutdown: async () => {},
  } as unknown as CuaDriverLike;
  const runtime = new CuaRuntime({ platform, driver: async () => driver });
  return { runtime, calls, driver, support: new ComputerSupport(runtime) };
}

test('Windows checks accept only Windows arguments and interpret UIA/PostMessage without macOS TCC or elevation requirements', async () => {
  const f = fixture('win32');
  try {
    const state = await f.support.state();
    assert.equal(state.phase, 'ready');
    assert.deepEqual(state.permissions, {
      windows: { uia: true, postMessage: true, elevated: false, integrityLevel: 'Medium' },
    });
    assert.deepEqual(f.calls, [{ name: 'check_permissions', args: { prompt: false } }]);
    assert.equal(
      state.permissions?.screenRecording,
      undefined,
      'No live capture or macOS grant is invented',
    );
    const agentStatus = await f.runtime.call(
      'fixture',
      'check_permissions',
      {},
      new AbortController().signal,
    );
    assert.equal(agentStatus.isError, undefined);
    assert.equal(
      f.calls.every((call) => !Object.hasOwn(call.args as object, 'probe_direct_capture')),
      true,
    );
  } finally {
    await f.runtime.close();
  }
});

test('macOS retains promptless TCC checks, and Windows errors are reported as check failures rather than reinstallation advice', async () => {
  const mac = fixture('darwin', { accessibility: false, screen_recording: true });
  const unavailable = fixture('win32', { accessibility: true, screen_recording: true });
  const denied = fixture('win32', { ...windows, uia: false });
  try {
    assert.equal((await mac.support.state()).phase, 'permissions_required');
    assert.deepEqual(mac.calls[0].args, { prompt: false, probe_direct_capture: false });
    assert.equal((await denied.support.state()).phase, 'permissions_required');
    const error = await unavailable.support.state();
    assert.equal(error.phase, 'unavailable');
    assert.equal(error.reason, 'check');
    assert.doesNotMatch(error.message!, /reinstall|переустанов/i);
    for (const value of [
      '',
      'null',
      '[]',
      '{}',
      '{"uia":true}',
      '{"uia":"true","post_message":true}',
    ])
      assert.throws(() => computerPermissions(value, 'win32'), ComputerPermissionCheckError);
  } finally {
    await Promise.all([mac.runtime.close(), unavailable.runtime.close(), denied.runtime.close()]);
  }
});

test('a failed driver load or schema read can be retried without restarting or reinstalling Studio', async () => {
  const f = fixture('win32');
  let loads = 0,
    schemas = 0;
  const driver = {
    ...f.driver,
    listToolsJson: async () => {
      if (++schemas === 1) throw Error('temporary schema failure');
      return '[]';
    },
  } as CuaDriverLike;
  const runtime = new CuaRuntime({
    platform: 'win32',
    driver: async () => {
      if (++loads === 1) throw Error('temporary module failure');
      return driver;
    },
  });
  try {
    const support = new ComputerSupport(runtime);
    assert.equal((await support.state()).reason, 'component');
    assert.equal((await support.state()).phase, 'ready');
    await assert.rejects(runtime.tools());
    assert.deepEqual(await runtime.tools(), []);
    assert.equal(loads, 2);
  } finally {
    await runtime.close();
  }
});
