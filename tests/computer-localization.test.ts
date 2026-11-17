import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CuaDriverLike } from '@trycua/cua-driver';
import { CuaRuntime } from '../src/main/computer/CuaRuntime.ts';
import { ComputerSupport } from '../src/main/computer/ComputerSupport.ts';
import { computerActionLabel, computerAgentLabel } from '../src/main/computer/ComputerFeedback.ts';
import { changeLanguage } from '../src/shared/i18n/index.ts';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import type { Agent } from '../src/shared/studio.ts';

const text = (result: { content: { type: string; text?: string }[] }) =>
  result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');

for (const language of ['ru', 'en'] as const) {
  test(`Computer Use rejects invalid or denied actions in ${language} without desktop calls`, async (context) => {
    await changeLanguage(language);
    context.after(() => changeLanguage('ru'));
    for (const platform of ['win32', 'darwin'] as const) {
      let permissionCalls = 0;
      const runtime = new CuaRuntime({
        platform,
        driver: async () =>
          ({
            listToolsJson: async () =>
              JSON.stringify([
                { name: 'list_apps', inputSchema: { type: 'object', properties: {} } },
              ]),
            callTool: async (name: string, args: string) => {
              assert.equal(name, 'check_permissions', 'Denied actions must never reach the driver');
              assert.deepEqual(
                JSON.parse(args),
                platform === 'win32'
                  ? { prompt: false }
                  : { prompt: false, probe_direct_capture: false },
              );
              permissionCalls++;
              return {
                structuredJson: JSON.stringify(
                  platform === 'win32'
                    ? { uia: false, post_message: true }
                    : { accessibility: false, screen_recording: true },
                ),
              };
            },
            shutdown: async () => {},
          }) as unknown as CuaDriverLike,
      });
      try {
        const signal = new AbortController().signal;
        const missing = await runtime.call('qa', 'not-exposed', {}, signal);
        const parameter = await runtime.call('qa', 'list_apps', { private: true }, signal);
        const denied = await runtime.call('qa', 'list_apps', {}, signal);
        assert.equal(missing.isError, true);
        assert.equal(parameter.isError, true);
        assert.equal(denied.isError, true);
        assert.equal(permissionCalls, 1, 'No implicit retry or permission request');
        assert.match(text(missing), language === 'ru' ? /недоступен/ : /unavailable/);
        assert.match(text(parameter), language === 'ru' ? /параметр/ : /parameter/);
        assert.match(text(denied), platform === 'win32' ? /Windows/ : /macOS/);
        if (platform === 'win32') assert.doesNotMatch(text(denied), /macOS|reinstall|переустанов/i);
        if (language === 'en')
          assert.doesNotMatch(text(missing) + text(parameter) + text(denied), /[А-Яа-яЁё]/u);
      } finally {
        await runtime.close();
      }
    }
  });

  test(`Computer MCP lease failures use ${language} and preserve single-attempt delivery`, async (context) => {
    await changeLanguage(language);
    context.after(() => changeLanguage('ru'));
    const root = await mkdtemp(join(tmpdir(), 'pistudio-computer-locale-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const store = await StudioStore.open(root);
    const agent: Agent = {
      id: 'locale-agent',
      name: 'User-provided Сцены',
      enabled: true,
      instructions: [],
      skills: [],
      mcps: ['pistudio-project', 'pistudio-computer'],
      plugins: [],
      model: { connectionId: 'qa', provider: 'qa', id: 'qa', reasoning: 'off', temperature: '' },
    };
    const project = (
      await store.command({ kind: 'create', name: 'Computer locale QA', agents: [agent] })
    ).projects[0];
    const directory = await store.projects.directory(project.id);
    const a = await buildRunContext(directory, project, agent.id, [agent], []);
    const b = await buildRunContext(directory, project, agent.id, [agent], []);
    let calls = 0;
    const support = new ComputerSupport({
      tools: async () => [{ name: 'list_apps', inputSchema: { type: 'object', properties: {} } }],
      permissions: async () => ({ accessibility: false, screenRecording: false }),
      call: async () => {
        calls++;
        throw Error('uncertain delivery');
      },
      release: async () => {},
      close: async () => {},
    });
    context.after(() => support.drain());
    await support.bind(a, false);
    await support.bind(b, true);
    const nonvisual = support.groups(a)[0],
      visual = support.groups(b)[0];
    const signal = new AbortController().signal;
    const parameter = await nonvisual.call('check_permissions', { prompt: true }, signal);
    const model = await nonvisual.call('list_apps', {}, signal);
    const uncertain = await visual.call('list_apps', {}, signal);
    await support.drain();
    const closed = await visual.call('list_apps', {}, signal);
    assert.equal(
      calls,
      1,
      'Rejected/status/closed calls cannot deliver an action; uncertain calls never retry',
    );
    for (const result of [parameter, model, uncertain, closed]) assert.equal(result.isError, true);
    assert.match(text(model), language === 'ru' ? /изображений/ : /images/);
    assert.match(text(uncertain), language === 'ru' ? /повтора/ : /retry/);
    assert.match(text(closed), language === 'ru' ? /закрыт/ : /closed/);
    if (language === 'en')
      for (const result of [parameter, model, uncertain, closed])
        assert.doesNotMatch(text(result), /[А-Яа-яЁё]/u);
  });
}

test('Computer feedback follows language changes while preserving user agent names', async () => {
  try {
    await changeLanguage('ru');
    assert.equal(computerActionLabel('click'), 'Нажимает');
    assert.equal(computerAgentLabel(''), 'Агент');
    await changeLanguage('en');
    assert.equal(computerActionLabel('click'), 'Clicking');
    assert.equal(computerActionLabel('unknown'), 'Using the computer');
    assert.equal(computerAgentLabel(''), 'Agent');
    assert.equal(computerAgentLabel('  Сцены\n'), 'Сцены');
  } finally {
    await changeLanguage('ru');
  }
});
