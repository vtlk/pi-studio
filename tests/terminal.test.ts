import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openTerminalCommand, activateTerminalProcess } from '../src/main/pi/terminalCommand.ts';
import { agentTerminalTitle } from '../src/main/pi/terminalTitle.ts';
import { fixedTitleTerminal } from '../bundled/pi-bridge/terminal-title.mjs';

test('dialogue title preserves display names, quotes and shell characters without OSC controls', () => {
  assert.equal(
    agentTerminalTitle('Сценарист «А»', 'Ролик "Б" $() `test`'),
    'Сценарист «А» · Ролик "Б" $() `test`',
  );
  assert.equal(agentTerminalTitle('Другой агент', 'Новый проект'), 'Другой агент · Новый проект');
  assert.equal(agentTerminalTitle('A\nB\x1b\x07', 'P\u009cQ'), 'A B · P Q');
  assert.equal(agentTerminalTitle('', undefined), 'Без названия · Без названия');
});

test('public Terminal adapter preserves native receivers and prevents Pi/extension title replacement', () => {
  const written: string[] = [],
    titles: string[] = [];
  class NativeTerminal {
    #rows = 31;
    get rows() {
      return this.#rows;
    }
    write(value: string) {
      this.#rows++;
      written.push(value);
    }
    setTitle(value: string) {
      titles.push(value);
    }
  }
  const original = new NativeTerminal();
  const terminal = fixedTitleTerminal(original, 'Сценарист · Проект');
  assert.equal(terminal.rows, 31);
  terminal.write('native content');
  assert.equal(terminal.rows, 32);
  terminal.setTitle('Pi - automatic session name');
  terminal.setTitle('extension spinner');
  assert.deepEqual(written, ['native content']);
  assert.deepEqual(titles, ['Сценарист · Проект', 'Сценарист · Проект']);
  original.setTitle('outside Studio remains native');
  assert.equal(titles.at(-1), 'outside Studio remains native');
  assert.throws(() => fixedTitleTerminal(original, 'bad\x1b]0;title\x07'));
});

test('Terminal dispatch uses one script command, suppresses the startup window, and passes paths as data', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-terminal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const command = `exec '/path/with "quotes" and $() and a newline\n/pi' 'a\\b'`;
  const title = 'Сценарист "цитата" $() · Проект';
  let count = 0;
  await openTerminalCommand(
    command,
    async (file, args) => {
      count++;
      assert.equal(file, '/usr/bin/osascript');
      assert.equal(args[0], '-e');
      assert.equal(args[2], command);
      assert.equal(args[3], title);
      assert.equal(args[1].includes(title), false);
      assert.match(args[1], /set custom title of dialogueTab to item 2 of argv/);
      assert.equal(args[1].includes(command), false);
      assert.equal((args[1].match(/do script/g) ?? []).length, 1);
      assert.ok(args[1].indexOf('launch') < args[1].indexOf('do script'));
      assert.ok(args[1].indexOf('do script') < args[1].indexOf('activate'));
      // Compile only: no Terminal window is opened or controlled by the test.
      await promisify(execFile)('/usr/bin/osacompile', [
        '-o',
        join(root, 'launch.scpt'),
        '-e',
        args[1],
      ]);
    },
    title,
  );
  assert.equal(count, 1);
});

test('denied Terminal automation returns an actionable error without a second launch or command disclosure', async () => {
  let calls = 0;
  await assert.rejects(
    openTerminalCommand('PRIVATE_BOOTSTRAP', async () => {
      calls++;
      throw { stderr: 'Not authorized to send Apple events. (-1743) PRIVATE_BOOTSTRAP' };
    }),
    (error: Error) =>
      error.message.includes('Автоматизация') && !error.message.includes('PRIVATE_BOOTSTRAP'),
  );
  assert.equal(calls, 1);
});

test('reopening a live dialogue selects its exact TTY tab without creating a window or sending input', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-terminal-focus-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const title = 'Сцены · Другой проект';
  await activateTerminalProcess(
    123,
    async (file, args) => {
      calls++;
      if (file === '/bin/ps') {
        assert.deepEqual(args, ['-p', '123', '-o', 'tty=']);
        return { stdout: ' ttys042\n' };
      }
      assert.equal(file, '/usr/bin/osascript');
      assert.equal(args[2], '/dev/ttys042');
      assert.equal(args[3], title);
      assert.match(args[1], /set custom title of terminalTab to item 2 of argv/);
      assert.match(args[1], /tty of terminalTab is targetTTY/);
      assert.match(args[1], /set selected tab of terminalWindow to terminalTab/);
      assert.doesNotMatch(args[1], /do script|launch|keystroke/);
      // Compile the installed Terminal dictionary only; never execute Terminal automation in QA.
      await promisify(execFile)('/usr/bin/osacompile', [
        '-o',
        join(root, 'focus.scpt'),
        '-e',
        args[1],
      ]);
    },
    title,
  );
  assert.equal(calls, 2);
});

test('invalid or unavailable TTY and denied activation never fall back to another dialogue', async () => {
  let calls = 0;
  await assert.rejects(
    activateTerminalProcess(NaN, async () => {
      calls++;
    }),
  );
  assert.equal(calls, 0);
  for (const stdout of ['??', '', 'ttys001\nPRIVATE', '/dev/ttys001']) {
    await assert.rejects(
      activateTerminalProcess(123, async (file) => {
        assert.equal(file, '/bin/ps');
        return { stdout };
      }),
      /больше недоступно/,
    );
  }
  await assert.rejects(
    activateTerminalProcess(123, async (file) => {
      if (file === '/bin/ps') return { stdout: 'ttys001' };
      throw { stderr: '-1743 PRIVATE_RAW_ERROR' };
    }),
    (error: Error) => error.message.includes('Автоматизация') && !error.message.includes('PRIVATE'),
  );
});
