import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserSession } from './BrowserSession.mjs';
import { validateBrowserCall } from './tools.mjs';
import { readPrivateJson, writePrivateJson } from './browserPreferences.mjs';

/** Subsessions never escape the bound studio/project/agent/canonical-Pi-dialogue namespace. */
export class BrowserSessions {
  constructor(binding, sessionId, factory = (value) => new BrowserSession(value, sessionId)) {
    this.binding = binding;
    this.factory = factory;
    this.default = factory(binding);
    this.sessions = new Map([['default', this.default]]);
    this.registry = join(this.default.root, 'browser-sessions.json');
  }
  async load() {
    if (this.state) return;
    const state = await readPrivateJson(this.registry, { names: ['default'], selected: 'default' });
    if (
      !state ||
      !Array.isArray(state.names) ||
      !state.names.includes('default') ||
      state.names.length > 16 ||
      new Set(state.names).size !== state.names.length ||
      !state.names.includes(state.selected) ||
      state.names.some((name) => !this.validName(name))
    )
      throw new Error('Некорректный список браузерных сессий.');
    this.state = state;
  }
  validName(name) {
    return (
      typeof name === 'string' &&
      name.length > 0 &&
      name.length <= 80 &&
      name === name.trim() &&
      !/[\p{Cc}\p{Cf}]/u.test(name)
    );
  }
  session(name) {
    if (!this.sessions.has(name))
      this.sessions.set(
        name,
        this.factory({
          ...this.binding,
          scope: this.binding.scope + '\0browser:' + name,
        }),
      );
    return this.sessions.get(name);
  }
  async call(name, input) {
    if (this.closed) throw new Error('Браузерные сессии закрыты.');
    await this.load();
    if (name !== 'browser_session') return this.session(this.state.selected).call(name, input);
    const args = validateBrowserCall(name, input);
    if (['create', 'switch', 'close'].includes(args.action)) {
      if (!this.validName(args.name))
        throw new Error('Укажите точное имя браузерной сессии (до 80 символов).');
      const next = structuredClone(this.state);
      if (args.action === 'create') {
        if (next.names.includes(args.name))
          throw new Error('Браузерная сессия с таким именем уже существует.');
        if (next.names.length >= 16)
          throw new Error('Можно создать не больше 16 браузерных сессий в одном диалоге.');
        next.names.push(args.name);
      } else if (!next.names.includes(args.name))
        throw new Error('Браузерная сессия не найдена в этом диалоге.');
      if (args.action === 'close') await this.session(args.name).call('browser_close', {});
      else next.selected = args.name;
      // A screenshot in another browser must never authorize input after a switch.
      for (const session of this.sessions.values()) session.observed = false;
      await mkdir(this.default.root, { recursive: true, mode: 0o700 });
      await writePrivateJson(this.registry, next);
      this.state = next;
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            selected: this.state.selected,
            sessions: this.state.names.map((name) => ({
              name,
              browserOpen: this.sessions.get(name)?.opened === true,
            })),
            preserved:
              'Cookies, history and login remain in each private profile; open/screenshot explicitly to launch.',
          }),
        },
      ],
    };
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.sessions.values()].map((session) => session.close()));
  }
}
