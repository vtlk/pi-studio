import assert from 'node:assert/strict';
import test from 'node:test';
import { CuaRuntime } from '../src/main/computer/CuaRuntime.ts';

test(
  'Cua adapter exposes bounded native schemas and only a promptless status operation before GUI use',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const runtime = new CuaRuntime();
    t.after(() => runtime.close());
    const tools = await runtime.tools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of [
      'list_apps',
      'list_windows',
      'get_window_state',
      'click',
      'type_text',
      'check_permissions',
    ])
      assert.ok(byName.has(name));
    for (const name of [
      'set_config',
      'run_script',
      'run_steps',
      'kill_app',
      'start_session',
      'list_sessions',
      'clipboard_read',
      'browser_prepare',
      'install_ffmpeg',
    ])
      assert.equal(byName.has(name), false);
    for (const tool of tools) {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      for (const key of ['session', 'screenshot_out_file', 'debug_image_out'])
        assert.equal(key in properties, false);
    }
    assert.deepEqual(
      Object.keys(byName.get('launch_app')!.inputSchema.properties as object).sort(),
      ['bundle_id', 'name'],
    );
    assert.ok((byName.get('click')!.inputSchema.required as string[]).includes('window_id'));
    assert.equal('target' in (byName.get('click')!.inputSchema.properties as object), false);
    const signal = new AbortController().signal;
    const rejected = await runtime.call(
      'qa-computer',
      'check_permissions',
      { prompt: true },
      signal,
    );
    assert.equal(rejected.isError, true, 'An agent cannot request OS permission UI.');
    assert.equal(
      (
        await runtime.call(
          'qa-computer',
          'check_permissions',
          { constructor: 'not-a-native-argument' },
          signal,
        )
      ).isError,
      true,
    );
    assert.equal((await runtime.call('qa-computer', 'get_config', {}, signal)).isError, true);
    const status = await runtime.call('qa-computer', 'check_permissions', {}, signal);
    assert.equal(status.isError, undefined);
    assert.equal(status.content.length, 1);
    const content = status.content[0];
    assert.equal(content.type, 'text');
    if (content.type === 'text') {
      const values = JSON.parse(content.text);
      assert.deepEqual(Object.keys(values).sort(), ['accessibility', 'screenRecording']);
      assert.ok(Object.values(values).every((value) => typeof value === 'boolean'));
    }
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(runtime.call('qa-computer', 'list_apps', {}, aborted.signal));
  },
);
