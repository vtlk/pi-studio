import './deny-external.mjs';

const loopbackFetch = globalThis.fetch;
globalThis.WebSocket = undefined;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.href !== 'https://chatgpt.com/backend-api/codex/responses')
    return loopbackFetch(input, options);
  const origin = new URL(process.env.PI_STUDIO_QA_CODEX_ORIGIN);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1')
    throw new Error('Expected isolated Codex fixture');
  const response = await loopbackFetch(new URL('/codex', origin), options);
  const failure = response.headers.get('x-qa-codex-failure');
  if (!failure) return response;
  await response.body?.cancel();
  throw new TypeError('fetch failed', {
    cause:
      failure === 'EPIPE'
        ? Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' })
        : Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
  });
};

export function codexResponse(response, key, tool, args, text, model) {
  const item = tool
    ? {
        id: 'fc_' + key,
        call_id: 'call_' + key,
        type: 'function_call',
        name: tool.name,
        arguments: JSON.stringify(args),
      }
    : {
        id: 'msg_' + key,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      };
  const send = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  send({
    type: 'response.output_item.added',
    output_index: 0,
    item: { ...item, status: 'in_progress' },
  });
  send({
    type: 'response.output_item.done',
    output_index: 0,
    item: { ...item, status: 'completed' },
  });
  send({
    type: 'response.completed',
    response: {
      id: 'resp_' + key,
      status: 'completed',
      output: [item],
      model,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  response.end();
}
