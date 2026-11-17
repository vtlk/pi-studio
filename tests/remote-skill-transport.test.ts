import test from 'node:test';
import assert from 'node:assert/strict';
import { RunChannel, type SessionEnvelope } from '../src/main/pi/RunChannel.ts';
import { setupTools } from '../src/main/pi/setupTools.ts';

test(
  'skill installer MCP sends SSE immediately and propagates disconnect or exact lease removal cancellation',
  { timeout: 5000 },
  async (t) => {
    const channel = new RunChannel();
    t.after(() => channel.close());
    for (const remove of [false, true]) {
      const entered = Promise.withResolvers<void>(),
        ended = Promise.withResolvers<void>();
      const id = remove ? 'removed' : 'disconnected';
      const lease = await channel.add(
        id,
        {
          record: {},
          resources: { skills: [], plugins: [], mcpServers: [] },
          instructions: '',
        } as unknown as SessionEnvelope,
        async () => {},
        async (name, _args, signal) => {
          assert.equal(name, 'install_skill_from_url');
          entered.resolve();
          await new Promise<void>((done) =>
            signal.addEventListener(
              'abort',
              () => {
                ended.resolve();
                done();
              },
              { once: true },
            ),
          );
          return { installed: false };
        },
        setupTools.filter((tool) => tool.name === 'install_skill_from_url'),
      );
      const controller = new AbortController();
      const response = await fetch(lease.url + '/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${lease.token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'install_skill_from_url',
            arguments: { url: 'https://example.com/a.zip', agentIds: ['a'] },
          },
        }),
        signal: controller.signal,
      });
      await entered.promise;
      assert.match(response.headers.get('content-type')!, /text\/event-stream/);
      if (remove) channel.remove(id);
      else controller.abort();
      await ended.promise;
      await response.body?.cancel().catch(() => {});
      channel.remove(id);
    }
  },
);
