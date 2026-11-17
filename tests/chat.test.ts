import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EmbeddedChat } from '../src/main/pi/EmbeddedChat.ts';
import { projectChatMessage } from '../src/main/pi/chatProjection.ts';
import { RunLifecycle } from '../src/main/pi/RunLifecycle.ts';
import { RunChats } from '../src/main/pi/RunChats.ts';
import { runKey, type LiveRun } from '../src/main/pi/RunTypes.ts';

const target = { projectId: 'project', agentId: 'agent' };
async function until(check: () => unknown) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check(), 'Owned chat fixture timed out');
}

test('chat projection exposes only inert message fields and validates inline image MIME/data', () => {
  const projected = projectChatMessage(
    {
      role: 'assistant',
      apiKey: 'SECRET',
      content: [
        { type: 'text', text: '<script>inert</script>\u2028Привет' },
        { type: 'thinking', thinking: 'Thought' },
        { type: 'toolCall', id: 'tool', name: 'read', arguments: { path: 'file.txt' } },
        { type: 'image', mimeType: 'image/svg+xml', data: '<script>' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      ],
      unknown: { credential: 'SECRET' },
    },
    'm',
  );
  assert.equal(JSON.stringify(projected).includes('SECRET'), false);
  assert.equal(projected.parts[0].text, '<script>inert</script>\u2028Привет');
  assert.equal(projected.parts[3].src, undefined);
  assert.equal(projected.parts[4].src, 'data:image/png;base64,AAAA');
  assert.equal(projected.parts[2].arguments, '{"path":"file.txt"}');
});

test('owned RPC child preserves Unicode/CRLF, authoritative messages, extension dialogs, exits and pending rejection', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-chat-protocol-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bridge = join(root, 'fixture.mjs');
  await writeFile(
    bridge,
    `
    let text='',messages=[],pending;
    const output=(value)=>process.stdout.write(JSON.stringify(value)+'\\r\\n');
    process.stdin.on('data',bytes=>{text+=bytes;let end;while((end=text.indexOf('\\n'))>=0){const line=text.slice(0,end);text=text.slice(end+1);const cmd=JSON.parse(line);
      const response=(data={})=>output({id:cmd.id,type:'response',success:true,data});
      if(cmd.type==='get_state')response();
      else if(cmd.type==='get_messages')response({messages});
      else if(cmd.type==='abort')response();
      else if(cmd.type==='extension_ui_response'){output({type:'extension_ui_request',id:'note',method:'notify',message:'ANSWER:'+cmd.value});output({id:pending,type:'response',success:true,data:{disposition:'handled'}});}
      else if(cmd.type==='prompt'){
        if(cmd.message==='dialog'){pending=cmd.id;output({type:'extension_ui_request',id:'dialog',method:'select',title:'Choice',options:['A','B']});}
        else if(cmd.message==='expire'){output({type:'extension_ui_request',id:'expired',method:'input',title:'Timed',timeout:10});response({disposition:'handled'});}
        else if(cmd.message==='crash')process.exit(7);
        else {response({disposition:'started'});output({type:'agent_start'});output({type:'message_start',message:{role:'assistant',content:[]}});
          const event=Buffer.from(JSON.stringify({type:'message_update',assistantMessageEvent:{type:'text_start',contentIndex:0}})+'\\n'+JSON.stringify({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'Привет\\u2028world'}})+'\\n');
          for(let i=0;i<event.length;i++)process.stdout.write(event.subarray(i,i+1));
          setTimeout(()=>{messages=[{role:'assistant',content:[{type:'text',text:'Final Привет\\u2028world'}]}];output({type:'message_end',message:messages[0]});output({type:'agent_settled'});},50);
        }
      }
    }});
    process.stdin.on('end',()=>process.exit(0));
  `,
  );
  const chat = await EmbeddedChat.start(
    process.execPath,
    bridge,
    'unused',
    target,
    'owned',
    'model',
    'medium',
    () => {},
  );
  t.after(() => chat.stop());
  await chat.ready();
  chat.markReady();
  await chat.send('message');
  await until(
    () =>
      !chat.state.working &&
      chat.snapshot().messages[0]?.parts[0]?.text === 'Final Привет\u2028world',
  );
  const send = chat.send('dialog');
  await until(() => chat.snapshot().dialog);
  assert.throws(() => chat.answer({ ...target, id: 'dialog', value: 'foreign' }));
  chat.answer({ ...target, id: 'dialog', value: 'B' });
  await send;
  assert.equal(chat.snapshot().notification, 'ANSWER:B');
  await chat.send('expire');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(chat.snapshot().dialog, undefined);
  await assert.rejects(chat.send('crash'), /lost|unavailable|прерван|потеряна/);
  await until(() => !chat.alive);
  assert.equal(chat.snapshot().phase, 'error');
  assert.equal(chat.snapshot().messages[0].parts[0].text, 'Final Привет\u2028world');
});

test('embedded Windows hello verifies its owned child without requiring a Terminal or touching permissions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-chat-hello-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', { value: platform }));
  const live = {
    run: { record: { cwd: root, runId: 'owned' } },
    embedded: { child: { pid: process.pid } },
    fail: () => {},
  } as unknown as LiveRun;
  const lifecycle = new RunLifecycle({ embedded: true } as never);
  await assert.rejects(lifecycle.event(live, { type: 'hello', pid: process.pid + 10000 }), /owned/);
  await lifecycle.event(live, { type: 'hello', pid: process.pid });
  assert.equal(live.pid, process.pid);
  assert.equal(live.terminalIdentity, undefined);
});

test('a dead background child is never recounted from a reused PID; closed transcript remains readable', () => {
  const state = { ...target, runId: 'owned', phase: 'closed', messages: [] } as const;
  const embedded = { alive: false, child: { pid: process.pid }, state, snapshot: () => state };
  const run = {
    project: { id: target.projectId },
    agent: { profile: { id: target.agentId, name: 'Agent' } },
    record: { runId: 'owned' },
    projectRoot: '/owned',
  };
  const live = new Map([
    [runKey(target), { run, pid: process.pid, embedded, status: 'waiting' } as unknown as LiveRun],
  ]);
  const chats = new RunChats(
    live,
    {},
    () => {},
    () => {},
  );
  chats.track(embedded as unknown as EmbeddedChat, run as never);
  assert.deepEqual(chats.processes(), []);
  live.clear();
  assert.equal(chats.chat(target)?.phase, 'closed');
  assert.equal(chats.root(target), '/owned');
  chats.forget(target);
  assert.equal(chats.chat(target), null);
  assert.equal(chats.root(target), undefined);
});
