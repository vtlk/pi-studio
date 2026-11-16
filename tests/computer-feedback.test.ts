import assert from 'node:assert/strict';
import test from 'node:test';
import type { CuaDriverLike, ToolResult } from '@trycua/cua-driver';
import { CursorGeometry } from '../src/main/computer/CursorGeometry.ts';
import { CuaRuntime } from '../src/main/computer/CuaRuntime.ts';
import {
  computerAgentLabel,
  type ComputerFeedback,
} from '../src/main/computer/ComputerFeedback.ts';
import type { ComputerPoint } from '../src/shared/computerFeedback.ts';

const snapshot = {
  pid: 42,
  window_id: 7,
  snapshot_id: 's00000001',
  capture_id: 'capture-1',
  screenshot_frame_valid: true,
  window_bounds: { x: -1200, y: 80, width: 800, height: 600 },
  screenshot_width: 1600,
  screenshot_height: 1200,
  elements: [{ element_token: 's00000001:2', frame: { x: 200, y: 100, w: 100, h: 40 } }],
};
const live = {
  pid: 42,
  window_id: 7,
  is_on_screen: true,
  on_current_space: true,
  bounds: snapshot.window_bounds,
};
const target = { pid: 42, window_id: 7 };

test('cursor follows exact Retina capture, AX token, moved window and negative-origin display', () => {
  const geometry = new CursorGeometry();
  geometry.observe('a', snapshot);
  assert.deepEqual(geometry.point('a', { ...target, x: 400, y: 200 }, live), { x: -1000, y: 180 });
  assert.deepEqual(geometry.point('a', { ...target, element_token: 's00000001:2' }, live), {
    x: -1075,
    y: 140,
  });
  assert.deepEqual(
    geometry.point(
      'a',
      { ...target, x: 400, y: 200 },
      {
        ...live,
        bounds: { ...live.bounds, x: 100 },
      },
    ),
    { x: 300, y: 180 },
  );
  assert.deepEqual(
    geometry.point('a', { ...target, from_x: 200, from_y: 100, to_x: 600, to_y: 400 }, live, true),
    { x: -900, y: 280 },
  );
  // A downsized post-action capture retains token frames only if its geometry agrees.
  geometry.observe('a', {
    ...snapshot,
    elements: undefined,
    screenshot_width: 1280,
    screenshot_height: 960,
  });
  assert.deepEqual(geometry.point('a', { ...target, element_token: 's00000001:2' }, live), {
    x: -1075,
    y: 140,
  });
});

test('stale, resized, hidden, mismatched and ungrounded cursor coordinates are never guessed', () => {
  const geometry = new CursorGeometry();
  geometry.observe('a', snapshot);
  const args = { ...target, x: 400, y: 200 };
  for (const [session, input, window] of [
    ['b', args, live],
    ['a', { ...args, window_id: 8 }, live],
    ['a', { ...args, capture_id: 'wrong' }, live],
    ['a', { ...args, element_token: 's00000002:2' }, live],
    ['a', { ...args, from_zoom: true }, live],
    ['a', { ...args, x: NaN }, live],
    ['a', { ...args, y: -1 }, live],
    ['a', { ...args, x: 1600 }, live],
    ['a', args, { ...live, pid: 43 }],
    ['a', args, { ...live, is_on_screen: false }],
    ['a', args, { ...live, on_current_space: false }],
    ['a', args, { ...live, minimized: true }],
    ['a', args, { ...live, bounds: { ...live.bounds, width: 900 } }],
  ] as const)
    assert.equal(geometry.point(session, input, window), undefined);
  geometry.observe('a', { ...snapshot, screenshot_frame_valid: false });
  assert.equal(geometry.point('a', args, live), undefined);
  geometry.observe('a', snapshot);
  geometry.release('a');
  assert.equal(geometry.point('a', args, live), undefined);
  assert.equal(computerAgentLabel('  Сцены\n\u202e <script>  '), 'Сцены <script>');
});

function fixture() {
  let visible = false,
    active = '',
    allowed = true,
    failClick = false;
  let clickWait: (() => Promise<void>) | undefined;
  const events: unknown[][] = [],
    calls: { name: string; args: Record<string, unknown> }[] = [];
  const feedback: ComputerFeedback = {
    begin(session, label) {
      active = session;
      visible = true;
      events.push(['begin', session, label]);
    },
    pointer(session, point?: ComputerPoint, click = false) {
      if (active === session) events.push(['pointer', session, point, click]);
    },
    suspend() {
      visible = false;
      events.push(['suspend']);
    },
    resume() {
      if (active) visible = true;
      events.push(['resume']);
    },
    finish(session) {
      events.push(['finish', session]);
    },
    release(session) {
      if (active === session) {
        active = '';
        visible = false;
      }
      events.push(['release', session]);
    },
    close() {
      visible = false;
      active = '';
    },
  };
  const result = (data: object, isError = false) =>
    ({
      text: JSON.stringify(data),
      rawJson: JSON.stringify(data),
      structuredJson: JSON.stringify(data),
      images: [],
      isError,
    }) as ToolResult;
  const driver = {
    listToolsJson: async () =>
      JSON.stringify(
        ['check_permissions', 'get_window_state', 'get_desktop_state', 'click'].map((name) => ({
          name,
          description: name,
          inputSchema: {
            type: 'object',
            properties: Object.fromEntries(
              [
                'pid',
                'window_id',
                'x',
                'y',
                'element_token',
                'delivery_mode',
                'tree_format',
                'include_accessibility_tree',
              ].map((key) => [key, {}]),
            ),
          },
        })),
      ),
    startSession: async () => ({}),
    endSession: async () => ({}),
    shutdown: async () => {},
    callTool: async (name: string, json: string) => {
      const args = JSON.parse(json);
      calls.push({ name, args });
      if (name === 'check_permissions')
        return result({ accessibility: allowed, screen_recording: allowed });
      assert.equal(visible, false, `native ${name} must not see feedback windows`);
      if (name === 'list_windows') return result({ windows: [live] });
      if (name === 'get_window_state') return result(snapshot);
      if (name === 'click') {
        await clickWait?.();
        if (failClick) throw Error('delivery failed');
        return result({ effect: 'unverifiable', route: 'synthetic_events' });
      }
      return result({});
    },
  } as unknown as CuaDriverLike;
  const runtime = new CuaRuntime({ feedback, driver: async () => driver });
  return {
    runtime,
    events,
    calls,
    get visible() {
      return visible;
    },
    deny() {
      allowed = false;
    },
    fail() {
      failClick = true;
    },
    wait(callback: () => Promise<void>) {
      clickWait = callback;
    },
  };
}

test('feedback uses bound names, hides for native reads/actions, pulses delivered clicks and preserves background delivery', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.close());
  f.runtime.identify('a', 'Сцены');
  const signal = new AbortController().signal;
  await f.runtime.call('a', 'get_window_state', target, signal);
  await f.runtime.call('a', 'click', { ...target, element_token: 's00000001:2' }, signal);
  assert.ok(f.events.some((e) => e[0] === 'begin' && e[2] === 'Сцены'));
  assert.deepEqual(f.events.find((e) => e[0] === 'pointer' && e[3] === true)?.[2], {
    x: -1075,
    y: 140,
  });
  assert.equal(f.calls.filter((call) => call.name === 'click').length, 1);
  assert.equal(f.calls.find((call) => call.name === 'click')?.args.delivery_mode, 'background');
  assert.equal(f.calls.find((call) => call.name === 'get_window_state')?.args.tree_format, 'both');
  assert.equal(f.visible, true);
  await f.runtime.release('a');
  assert.equal(f.visible, false);
  f.deny();
  const beginCount = f.events.filter((e) => e[0] === 'begin').length;
  assert.equal(
    (await f.runtime.call('b', 'click', { ...target, x: 4, y: 4 }, signal)).isError,
    true,
  );
  assert.equal(f.events.filter((e) => e[0] === 'begin').length, beginCount);
});

test('abort, delivery error and late replies cannot leave a cursor or click pulse alive', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.close());
  await f.runtime.call('a', 'get_window_state', target, new AbortController().signal);
  f.fail();
  await assert.rejects(
    f.runtime.call('a', 'click', { ...target, x: 400, y: 200 }, new AbortController().signal),
  );
  assert.equal(f.visible, false);
  assert.equal(
    f.events.some((e) => e[0] === 'pointer' && e[3] === true),
    false,
  );
  const g = fixture();
  t.after(() => g.runtime.close());
  const entered = Promise.withResolvers<void>(),
    settle = Promise.withResolvers<void>();
  g.wait(async () => {
    entered.resolve();
    await settle.promise;
  });
  await g.runtime.call('a', 'get_window_state', target, new AbortController().signal);
  const abort = new AbortController();
  const pending = g.runtime.call('a', 'click', { ...target, x: 400, y: 200 }, abort.signal);
  await entered.promise;
  abort.abort();
  assert.equal(g.visible, false);
  settle.resolve();
  await pending;
  assert.equal(g.visible, false);
  assert.equal(
    g.events.some((e) => e[0] === 'pointer' && e[3] === true),
    false,
  );
});
