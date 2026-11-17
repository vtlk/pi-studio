import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ChatAnswer, ChatDialog, ChatState, ChatTarget } from '../../shared/chat.ts';
import { t } from '../../shared/i18n/index.ts';
import { piEnvironment } from './platform.ts';
import { findWindowsBash } from './windowsBash.ts';
import { chatText, projectChatMessage, projectChatQueue } from './chatProjection.ts';

import type { RpcData, RpcEvent } from './ChatRpc.ts';

/** Official Pi SDK RPC mode, hosted in an owned background Node process, never a terminal. */
export class EmbeddedChat {
  readonly child: ChildProcessWithoutNullStreams;
  readonly state: ChatState;
  private readonly pending = new Map<
    string,
    {
      resolve: (data: RpcData) => void;
      reject: (error: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly dialogs: ChatDialog[] = [];
  private text = '';
  private decoder = new StringDecoder('utf8');
  private notifyTimer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private exitTimer?: ReturnType<typeof setTimeout>;
  private refreshing?: Promise<void>;
  private readonly changed: () => void;

  static async start(
    node: string,
    bridge: string,
    bootstrap: string,
    target: ChatTarget,
    runId: string,
    model: string,
    thinkingLevel: string,
    changed: () => void,
  ) {
    const bash = process.platform === 'win32' ? await findWindowsBash() : undefined;
    const env = piEnvironment(
      dirname(node),
      process.env,
      process.platform,
      bash ? [dirname(bash)] : [],
    );
    return new EmbeddedChat(
      node,
      bridge,
      bootstrap,
      target,
      runId,
      model,
      thinkingLevel,
      changed,
      env,
    );
  }
  private constructor(
    node: string,
    bridge: string,
    bootstrap: string,
    target: ChatTarget,
    runId: string,
    model: string,
    thinkingLevel: string,
    changed: () => void,
    env: NodeJS.ProcessEnv,
  ) {
    this.changed = changed;
    this.state = {
      projectId: target.projectId,
      agentId: target.agentId,
      runId,
      model,
      thinkingLevel,
      phase: 'opening',
      working: false,
      revision: 0,
      messages: [],
    };
    this.child = spawn(node, [bridge, bootstrap], {
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.read(this.decoder.write(chunk)));
    // Always drain diagnostics. They may contain provider/extension secrets and never cross preload.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => this.failed(t('Chat.disconnected')));
    this.child.once('error', () => this.failed(t('Chat.couldNotStart')));
    this.child.once('exit', () => {
      clearTimeout(this.exitTimer);
      this.state.phase = this.stopping ? 'closed' : 'error';
      if (!this.stopping) this.state.error = t('Chat.disconnected');
      this.state.working = false;
      this.dialogs.length = 0;
      this.state.dialog = undefined;
      this.rejectPending(new Error(t('Chat.disconnected')));
      this.touch();
    });
  }
  get alive() {
    return (
      this.child.pid !== undefined && this.child.exitCode === null && this.child.signalCode === null
    );
  }
  async ready() {
    // stdin is buffered until SDK resources, extensions and MCP have initialized.
    await this.command('get_state', {}, 120_000);
    await this.refresh();
  }
  markReady() {
    this.state.phase = 'ready';
    this.touch();
  }
  snapshot() {
    for (let index = this.dialogs.length - 1; index >= 0; index--) {
      const expires = this.dialogs[index].expiresAt;
      if (expires && expires <= Date.now()) this.dialogs.splice(index, 1);
    }
    this.state.dialog = this.dialogs[0];
    return structuredClone(this.state);
  }
  private touch() {
    this.state.revision++;
    this.notifyTimer ??= setTimeout(() => {
      this.notifyTimer = undefined;
      this.changed();
    }, 80);
    this.notifyTimer.unref();
  }
  private rejectPending(error: Error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
  private failed(message: string) {
    this.state.phase = 'error';
    this.state.error = message;
    this.state.working = false;
    this.rejectPending(new Error(message));
    this.touch();
  }
  stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.child.stdin.end();
    // A hung startup must not become an untracked orphan. Signal only this owned child.
    this.exitTimer = setTimeout(() => {
      if (this.alive) this.child.kill('SIGTERM');
    }, 10_000);
    this.exitTimer.unref();
  }
  private write(value: unknown) {
    if (!this.alive || this.stopping || this.child.stdin.destroyed)
      throw new Error(t('Chat.disconnected'));
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }
  private command(
    type: string,
    args: Record<string, unknown> = {},
    timeout = 30_000,
  ): Promise<RpcData> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer =
        timeout > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(t('Chat.commandTimeout')));
            }, timeout)
          : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, type, ...args });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async send(message: string, images: unknown[] = [], behavior?: 'steer' | 'followUp') {
    if (this.state.phase !== 'ready') throw new Error(t('Chat.notReady'));
    if (this.state.working && !behavior) throw new Error(t('Chat.chooseQueue'));
    const data = await this.command(
      'prompt',
      {
        message,
        ...(images.length ? { images } : {}),
        ...(behavior ? { streamingBehavior: behavior } : {}),
      },
      0,
    );
    if (data?.disposition === 'started') this.state.working = true;
    this.touch();
    return data?.disposition;
  }
  async abort() {
    await this.command('abort', {}, 120_000);
    this.dialogs.length = 0;
    this.state.dialog = undefined;
    this.touch();
  }
  answer(answer: ChatAnswer) {
    const dialog = this.dialogs.find((item) => item.id === answer.id);
    if (!dialog || (dialog.expiresAt && dialog.expiresAt <= Date.now()))
      throw new Error(t('Chat.dialogExpired'));
    if (
      dialog.method === 'select' &&
      !answer.cancelled &&
      !dialog.options?.includes(answer.value ?? '')
    )
      throw new Error(t('Chat.invalidRequest'));
    this.write({
      type: 'extension_ui_response',
      id: dialog.id,
      ...(answer.cancelled
        ? { cancelled: true }
        : dialog.method === 'confirm'
          ? { confirmed: answer.confirmed === true }
          : { value: answer.value ?? '' }),
    });
    this.dialogs.splice(this.dialogs.indexOf(dialog), 1);
    this.state.dialog = this.dialogs[0];
    this.touch();
  }
  private refresh() {
    this.refreshing ??= this.command('get_messages')
      .then((data) => {
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        this.state.historyTruncated = messages.length > 1000;
        this.state.messages = messages
          .slice(-1000)
          .map((message: unknown, index: number) => projectChatMessage(message, String(index)));
        this.touch();
      })
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
  private read(chunk: string) {
    this.text += chunk;
    if (this.text.length > 64_000_000) {
      this.failed(t('Chat.invalidResponse'));
      this.stop();
      return;
    }
    let end: number;
    while ((end = this.text.indexOf('\n')) >= 0) {
      const line = this.text.slice(0, end).replace(/\r$/, '');
      this.text = this.text.slice(end + 1);
      if (!line) continue;
      try {
        this.receive(JSON.parse(line));
      } catch {
        this.failed(t('Chat.invalidResponse'));
        this.stop();
      }
    }
  }
  private receive(event: RpcEvent) {
    if (!event || typeof event.type !== 'string') throw new Error('Invalid RPC event');
    if (event.type === 'response') {
      const request = event.id ? this.pending.get(event.id) : undefined;
      if (!request) return;
      this.pending.delete(event.id!);
      clearTimeout(request.timer);
      if (event.success) request.resolve(event.data ?? {});
      else request.reject(new Error(chatText(event.error, 4000) || t('Chat.commandFailed')));
      return;
    }
    if (event.type === 'queue_update')
      this.state.queue = projectChatQueue(event.steering, event.followUp);
    else if (event.type === 'message_start')
      this.state.messages.push(projectChatMessage(event.message, randomUUID()));
    else if (event.type === 'message_update') {
      const message = this.state.messages.at(-1),
        delta = event.assistantMessageEvent;
      if (!message || message.role !== 'assistant' || !delta) return;
      const index = delta.contentIndex;
      if (index === undefined || !Number.isSafeInteger(index) || index < 0 || index > 200) return;
      if (delta.type === 'text_start') message.parts[index] = { type: 'text', text: '' };
      else if (delta.type === 'thinking_start')
        message.parts[index] = { type: 'thinking', text: '' };
      else if (delta.type === 'toolcall_start')
        message.parts[index] = {
          type: 'toolCall',
          id: chatText(delta.id, 500),
          name: chatText(delta.toolName, 500),
          arguments: '',
        };
      else if (delta.type === 'text_delta' || delta.type === 'thinking_delta') {
        const part = message.parts[index];
        if (part) part.text = chatText((part.text ?? '') + chatText(delta.delta));
      } else if (delta.type === 'toolcall_delta') {
        const part = message.parts[index];
        if (part) part.arguments = chatText((part.arguments ?? '') + chatText(delta.delta));
      }
    } else if (event.type === 'message_end') {
      const last = this.state.messages.at(-1);
      const message = projectChatMessage(event.message, last?.id ?? randomUUID());
      if (last?.role === message.role)
        this.state.messages[this.state.messages.length - 1] = message;
      else this.state.messages.push(message);
    } else if (event.type === 'agent_start') this.state.working = true;
    else if (event.type === 'agent_settled') {
      this.state.working = false;
      void this.refresh().catch(() => {});
    } else if (event.type === 'extension_ui_request') {
      if (event.method && ['select', 'confirm', 'input', 'editor'].includes(event.method)) {
        if (this.dialogs.length >= 32) return;
        this.dialogs.push({
          id: chatText(event.id, 500),
          method: event.method as ChatDialog['method'],
          title: chatText(event.title, 4000),
          message: chatText(event.message, 8000),
          placeholder: chatText(event.placeholder, 2000),
          prefill: chatText(event.prefill),
          options: Array.isArray(event.options)
            ? event.options.slice(0, 1000).map((item: unknown) => chatText(item, 4000))
            : undefined,
          ...(typeof event.timeout === 'number' ? { expiresAt: Date.now() + event.timeout } : {}),
        });
        this.state.dialog = this.dialogs[0];
      } else if (event.method === 'notify' || event.method === 'setStatus')
        this.state.notification = chatText(event.message ?? event.statusText, 4000);
      else if (event.method === 'set_editor_text')
        this.state.editorText = { id: chatText(event.id, 500), text: chatText(event.text) };
    } else if (event.type === 'extension_error')
      this.state.notification = chatText(event.error, 4000);
    this.state.messages = this.state.messages.slice(-1000);
    this.touch();
  }
}
