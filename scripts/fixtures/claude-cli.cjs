#!/usr/bin/env node
const { readFileSync, appendFileSync } = require('node:fs');
const { createInterface } = require('node:readline');
process.on('unhandledRejection', error => { process.stderr.write('QA CLI: ' + error.message); process.exit(1); });
const state = JSON.parse(readFileSync(process.env.PI_STUDIO_QA_CLAUDE_STATE, 'utf8'));
const args = process.argv.slice(2);
const log = data => appendFileSync(process.env.PI_STUDIO_QA_CLAUDE_LOG, JSON.stringify(data) + '\n');
const send = data => process.stdout.write(JSON.stringify(data) + '\n');
if (process.env.ANTHROPIC_API_KEY) throw Error('API key reached Claude CLI');
log({ args: args[0] === '-p' ? ['-p'] : args, cwd: process.cwd() });
if (args[0] === '--version') { console.log(state.version ?? '2.1.300 (Claude Code)'); process.exit(); }
if (args[0] === '--help') { console.log('--input-format --output-format --system-prompt-file --strict-mcp-config --no-session-persistence --permission-prompts'); process.exit(); }
if (args[0] === 'auth' && args[1] === 'status') {
  send(state.auth ?? { loggedIn: true, subscriptionType: 'max', authMethod: 'claude.ai' });
  process.exit(state.auth?.loggedIn === false ? 1 : 0);
}
if (args[0] !== '-p') throw Error('Unexpected CLI action');
const discovery = !args.includes('--system-prompt-file');
const input = createInterface({ input: process.stdin });
input.on('line', async line => {
  const frame = JSON.parse(line);
  if (frame.type === 'control_request') {
    send({ type: 'control_response', response: { request_id: frame.request_id, subtype: 'success', response: {
      models: [{ value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'QA Sonnet', description: 'Fixture, no account', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] }],
    } } });
    return;
  }
  log({ frame: frame.type, query: frame.type === 'user' && frame.shouldQuery !== false, discovery });
  if (discovery) {
    if (frame.shouldQuery !== false) throw Error('Discovery attempted generation');
    return;
  }
  if (frame.type === 'assistant') return;
  if (frame.shouldQuery === false) { send({ type: 'result', subtype: 'success', num_turns: 0, is_error: false }); return; }
  if (state.error) {
    send({ type: 'assistant', error: 'rate_limit', message: { content: [{ type: 'text', text: state.error }] } });
    send({ type: 'result', subtype: 'error_during_execution', is_error: true });
    return;
  }
  let content = [{ type: 'text', text: 'CLAUDE_FIXTURE_OK' }], stop = 'end_turn';
  if (state.longTool && !frame.message.content.some(block => block.type === 'tool_result')) {
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
    const tools = JSON.parse(readFileSync(config.mcpServers.pi.args[1], 'utf8'));
    const tool = tools.find(tool => tool.description === 'QA long scoped tool');
    if (!tool || tool.name.length > 50) throw Error('Long scoped tool not mapped: ' + JSON.stringify(tools.map(tool => [tool.name,tool.description])));
    content = [{ type: 'tool_use', id: 'long-tool-call', name: 'mcp__pi__' + tool.name, input: {} }];
    stop = 'tool_use';
  }
  if (process.env.PI_STUDIO_QA_CLAUDE_UPSTREAM) {
    const url = new URL(process.env.PI_STUDIO_QA_CLAUDE_UPSTREAM);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw Error('Fixture requires loopback');
    const prompt = readFileSync(args[args.indexOf('--system-prompt-file') + 1], 'utf8');
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
    const tools = JSON.parse(readFileSync(config.mcpServers.pi.args[1], 'utf8'));
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      model: 'qa-chain', messages: [{ role: 'system', content: prompt }, frame.message],
      tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
    }) });
    if (!response.ok) throw Error('Loopback fixture failed');
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice(6)));
    const delta = events.find(event => event.choices?.[0]?.delta?.tool_calls || event.choices?.[0]?.delta?.content)?.choices[0].delta;
    if (delta.tool_calls) {
      content = delta.tool_calls.map(call => ({ type: 'tool_use', id: call.id, name: 'mcp__pi__' + call.function.name, input: JSON.parse(call.function.arguments) }));
      stop = 'tool_use';
    } else content = [{ type: 'text', text: delta.content }];
  }
  const message = { id: 'fixture-message', role: 'assistant', type: 'message', content, stop_reason: stop, usage: { input_tokens: 7, output_tokens: 3 } };
  send({ type: 'stream_event', event: { type: 'message_stop' } });
  send({ type: 'assistant', message });
  if (state.overage) send({ type: 'rate_limit_event', rate_limit_info: { isUsingOverage: true } });
  send({ type: 'result', subtype: 'success', is_error: false, usage: message.usage });
});
