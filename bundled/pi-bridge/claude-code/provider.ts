import { createClaudeCodeProvider, claudeCodeEnv } from '../../pi-claude-code/src/provider.ts';
import { discoverClaudeModels } from '../../pi-claude-code/src/claude-cli.ts';
import { modelFromDiscovery } from '../../pi-claude-code/src/model-catalog.ts';
import { claudeEnvironment } from './environment.mjs';
import { claudeStatus } from './status.mjs';
import { scopedToolStream } from './tool-names.ts';

// Studio policy wraps the pinned, unmodified upstream provider. Pi remains the
// tool executor and transcript owner; Claude CLI is solely the model transport.
export function studioClaudeProvider() {
  const upstream = createClaudeCodeProvider();
  let models = [];
  // Supply only the common CLI environment, never Pi provider-scoped credentials.
  const check = async (signal) => {
    const status = await claudeStatus(signal);
    if (status.status !== 'ready') throw Error(status.detail);
    return status;
  };
  const resolve = async (input) => {
    const state = await check(input.signal);
    const env = claudeEnvironment();
    const context = {
      env: async (name) => (name === 'PI_CLAUDE_CODE_COMMAND' ? state.command : env[name]),
    };
    const result = await upstream.auth.apiKey.resolve({
      ...input,
      credential: undefined,
      ctx: context,
    });
    return { ...result, env: { ...result.env, PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS: '0' } };
  };
  return {
    ...upstream,
    name: 'Claude Code — подписка',
    stream: (model, context, options) => scopedToolStream(upstream.stream, model, context, options),
    streamSimple: (model, context, options) =>
      scopedToolStream(upstream.streamSimple, model, context, options),
    auth: {
      apiKey: {
        name: 'Общий вход Claude Code',
        check: async ({ signal }) => {
          if ((await claudeStatus(signal)).status !== 'ready') return undefined;
          return { type: 'oauth', source: 'Claude Code subscription' };
        },
        resolve,
      },
      oauth: {
        ...upstream.auth.oauth,
        login: async () => {
          throw Error('Используйте штатный вход Claude Code в настройках Studio.');
        },
        refresh: async (credential, signal) => {
          await check(signal);
          return upstream.auth.oauth.refresh(credential, signal);
        },
        toAuth: async () => {
          await check();
          return { apiKey: 'external-process' };
        },
      },
    },
    getModels: () => models,
    getAllModels: () => models,
    refreshModels: async (input) => {
      if ((await claudeStatus(input.signal)).status !== 'ready') {
        await input.publish({
          update: () => {
            models = [];
          },
        });
        return;
      }
      await resolve(input);
      // CLI initialize + shouldQuery:false discovers the account's models without
      // a model request. Never expose upstream's static fallback model list.
      const discovered = await discoverClaudeModels(claudeCodeEnv(), input.signal);
      const next = discovered.map((info) => {
        const model = modelFromDiscovery(info);
        if (info.supportedEffortLevels?.length) {
          const levels = new Set(info.supportedEffortLevels);
          return {
            ...model,
            reasoning: true,
            thinkingLevelMap: Object.fromEntries(
              ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => [
                level,
                levels.has(level) ? level : null,
              ]),
            ),
          };
        }
        return model;
      });
      await input.publish({
        update: () => {
          models = next;
        },
      });
    },
  };
}

export default function extension(pi) {
  pi.registerProvider(studioClaudeProvider());
}
