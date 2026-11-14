const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm, realpath, readdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');

async function parent() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-constructor-')));
  try {
    for (const name of ['UserData', 'Videos']) await mkdir(join(root, name));
    for (const phase of ['edit', 'reopen'])
      await new Promise((resolveChild, reject) => {
        const child = spawn(require('electron'), [__filename, '--child', root, phase], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
        });
        let output = '';
        child.stdout.on('data', (data) => {
          process.stdout.write(data);
          output += data;
        });
        child.stderr.on('data', (data) => {
          output += data;
        });
        const timer = setTimeout(() => child.kill('SIGTERM'), 90_000);
        child.once('error', reject);
        child.once('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) reject(new Error(output));
          else resolveChild();
        });
      });
    const report = JSON.parse(await readFile(join(root, 'proof.json'), 'utf8'));
    report.separateProcessReopen = true;
    report.version = JSON.parse(await readFile('package.json', 'utf8')).version;
    report.verifiedAt = new Date().toISOString();
    report.mainSha256 = createHash('sha256')
      .update(await readFile('out/main/index.cjs'))
      .digest('hex');
    report.rendererSha256 = {};
    for (const name of await readdir('out/renderer/assets')) {
      if (/\.(js|css)$/.test(name))
        report.rendererSha256[name] = createHash('sha256')
          .update(await readFile(join('out/renderer/assets', name)))
          .digest('hex');
    }
    report.sourceSha256 = {};
    for (const path of [
      'src/renderer/features/agents/model/AgentProfiles.tsx',
      'src/renderer/features/agents/ui/InstructionBlock.tsx',
      'src/renderer/features/agents/ui/CapabilitiesPanel.tsx',
      'scripts/smoke-agent-constructor.cjs',
    ]) {
      report.sourceSha256[path] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    }
    report.scope =
      'Real compiled main/preload/React CRUD and disk persistence in two offscreen processes. Model catalog/status/startup are explicit IPC fixtures; no model, Pi Terminal, MCP execution or user studio changes.';
    await mkdir(resolve('artifacts'), { recursive: true });
    await writeFile(
      resolve('artifacts/agent-constructor-proof.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function child() {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const [, , , root, phase] = process.argv;
  app.setPath('userData', join(root, 'UserData'));
  app.setPath('videos', join(root, 'Videos'));
  const model = {
    provider: 'test',
    id: 'qa-model',
    name: 'QA model',
    reasoning: true,
    reasoningLevels: ['low', 'medium', 'high'],
    defaultReasoningLevel: 'medium',
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (name, action) =>
    handle(
      name,
      name === 'studio:startup'
        ? () => ({ phase: 'skipped', message: 'QA' })
        : name === 'studio:model-catalog'
          ? () => ({ providers: [], models: [model] })
          : name === 'studio:connection-status'
            ? () => ({ provider: 'test', status: 'ready' })
            : action,
    );
  let window;
  const deadline = setTimeout(() => {
    console.error('Constructor QA timeout');
    app.exit(1);
  }, 85_000);
  try {
    const loaded = new Promise((resolveWindow) =>
      app.once('browser-window-created', (_, created) => {
        created.hide();
        created.on('show', () => created.hide());
        created.webContents.setBackgroundThrottling(false);
        created.webContents.once('did-finish-load', () => resolveWindow(created));
      }),
    );
    require('./offscreen-main.cjs').loadOffscreenMain();
    window = await loaded;
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => {
      console.error('Unsaved QA close');
      app.exit(1);
    });
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
    const js = (code) =>
      window.webContents.executeJavaScript(code, true).catch(async (error) => {
        console.error('Constructor expression:', code.slice(0, 600));
        console.error(
          await window.webContents.executeJavaScript('document.body.innerText.slice(-1800)'),
        );
        throw error;
      });
    const until = async (code) => {
      for (let i = 0; i < 150; i++) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw Error(code + '\n' + (await js('document.body.innerText.slice(-1400)')));
    };
    const click = (text) =>
      js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    const named = (label) =>
      js(
        `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`,
      );
    const field = (label, value) =>
      js(
        `(()=>{const e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    const saved = () =>
      until(
        `document.querySelector('.prototype-label')?.textContent==='Сохранено'&&!document.querySelector('.storage-error')`,
      );
    const drag = async (selector, from, to, targetSelector = selector) => {
      await js('new Promise(r=>setTimeout(r,250))');
      const points = await js(
        `(()=>{const starts=document.querySelectorAll(${JSON.stringify(selector)}),targets=document.querySelectorAll(${JSON.stringify(targetSelector)});const a=starts[${from}].getBoundingClientRect(),b=targets[${to}].getBoundingClientRect(),source=targets[${from}].getBoundingClientRect();return {x:Math.round(a.x+a.width/2),y:Math.round(a.y+a.height/2),targetX:Math.round(a.x+a.width/2),targetY:Math.round(a.y+a.height/2+b.y+b.height/2-source.y-source.height/2)};})()`,
      );
      const send = (type, x, y) =>
        window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type,
          x,
          y,
          button: type === 'mouseMoved' ? 'none' : 'left',
          buttons: type === 'mouseReleased' ? 0 : 1,
          clickCount: 1,
        });
      await send('mouseMoved', points.x, points.y);
      await send('mousePressed', points.x, points.y);
      for (let i = 1; i <= 16; i++) {
        await send(
          'mouseMoved',
          Math.round(points.x + ((points.targetX - points.x) * i) / 16),
          Math.round(points.y + ((points.targetY - points.y) * i) / 16),
        );
        await js('new Promise(r=>requestAnimationFrame(r))');
      }
      await send('mouseReleased', points.targetX, points.targetY);
    };
    const load = () => js('window.studio.loadStudio()');
    const save = async (section, value) => {
      const before = await load();
      assert.ok(
        (
          await js(
            `window.studio.saveSection(${JSON.stringify(section)},${JSON.stringify(value)},${JSON.stringify({ folder: before.folder, base: before.sections[section] })})`,
          )
        ).saved,
      );
    };
    const select = async (label, text) => {
      await named(label);
      await until(
        `Array.from(document.querySelectorAll('[role="option"]')).some(e=>e.textContent.includes(${JSON.stringify(text)}))`,
      );
      await js(
        `Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`,
      );
    };
    const agent = () =>
      load().then((s) => s.sections.agents.find((a) => a.name === 'Первый агент'));
    const addInstruction = async (name, content) => {
      await named('Добавить инструкцию');
      await until(
        `!!document.querySelector('[aria-label="Название инструкции: Новая инструкция"]')`,
      );
      await js(`document.querySelector('.instruction-sortable .disclosure-trigger').click()`);
      await field('Название инструкции: Новая инструкция', name);
      await field(`Текст инструкции: ${name}`, content);
      await saved();
    };
    const attach = async (tab, name) => {
      await click(tab);
      await named(`Добавить ${tab}`);
      await until(`!!document.querySelector('[role="dialog"]')`);
      if (tab === 'MCP') await click('Свой MCP');
      await until(
        `Array.from(document.querySelectorAll('[role="dialog"] .resource-row')).some(e=>e.textContent.includes(${JSON.stringify(name)}))`,
      );
      await js(
        `Array.from(document.querySelectorAll('[role="dialog"] .resource-row')).find(e=>e.textContent.includes(${JSON.stringify(name)})).querySelector('.button.primary').click()`,
      );
      await click('Готово');
      await saved();
    };
    await until(`!!document.querySelector('[aria-label="Создать проект"]')`);
    if (phase === 'reopen') {
      const expected = JSON.parse(await readFile(join(root, 'expected.json'), 'utf8'));
      const actual = await load();
      assert.deepEqual(actual.sections, expected.sections);
      assert.deepEqual(actual.projects, expected.projects);
      await click('Агенты');
      await js(
        `Array.from(document.querySelectorAll('.agent-list-entry:not([data-system-role]) .agent-list-item')).find(e=>e.textContent.includes('Первый агент')).click()`,
      );
      await until(
        `document.querySelector('[aria-label="Основной промпт агента"]')?.value==='Основная роль: создать мультфильм'`,
      );
      await click('Инструкции');
      assert.deepEqual(
        await js(
          `Array.from(document.querySelectorAll('.instruction-sortable .ui-list-row-label')).map(e=>e.textContent)`,
        ),
        ['Вернуть блок', 'Новый блок', 'Первый блок'],
      );
      await click('Модель');
      await until(
        `document.querySelector('[aria-label="Модель агента"]')?.textContent.includes('QA model')`,
      );
      assert.ok(
        (
          await js(
            `document.querySelector('[aria-label="Уровень рассуждения (effort)"]').textContent`,
          )
        ).includes('Высокий'),
      );
      await saved();
      console.log(
        'Constructor reopen passed: exact persisted sections/projects and visible prompt/instruction/model values in a separate process.',
      );
    } else {
      await click('Агенты');
      await named('Добавить агента');
      await field('Название агента', 'Первый агент');
      await field('Основной промпт агента', 'Основная роль: создать мультфильм');
      await saved();
      const firstId = (await agent()).id;
      await named('Добавить агента');
      await field('Название агента', 'Второй агент');
      await saved();
      assert.deepEqual(
        (await load()).sections.agents.map((a) => a.name),
        ['Первый агент', 'Второй агент'],
      );
      assert.equal(
        await js(`document.querySelector('[aria-label="Название агента"]').value`),
        'Второй агент',
      );
      assert.equal(
        await js(
          `(()=>{const plus=document.querySelector('[aria-label="Добавить агента"]'),system=document.querySelector('[data-system-role]');return Array.from(document.querySelectorAll('.agent-list-entry:not([data-system-role])')).every(row=>!!(row.compareDocumentPosition(plus)&Node.DOCUMENT_POSITION_FOLLOWING))&&!!(plus.compareDocumentPosition(system)&Node.DOCUMENT_POSITION_FOLLOWING);})()`,
        ),
        true,
      );
      const key = async (key, code, number, text = '') => {
        for (const type of ['keyDown', 'keyUp'])
          await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
            type,
            key,
            code,
            windowsVirtualKeyCode: number,
            ...(type === 'keyDown' && text ? { text, unmodifiedText: text } : {}),
          });
        await js('new Promise(r=>requestAnimationFrame(r))');
      };
      await js(`document.querySelector('.agent-list-item').focus()`);
      await key(' ', 'Space', 32, ' ');
      await until(`!!document.querySelector('.agent-list-entry[data-dragging]')`);
      await key('ArrowDown', 'ArrowDown', 40);
      await js('new Promise(r=>setTimeout(r,350))');
      await key(' ', 'Space', 32, ' ');
      await saved();
      await until(`document.querySelector('.agent-list-name')?.textContent==='Второй агент'`);
      assert.deepEqual(
        (await load()).sections.agents.map((a) => a.name),
        ['Второй агент', 'Первый агент'],
      );
      await drag('.agent-list-entry:not([data-system-role]) .agent-list-item', 1, 0);
      await until(`document.querySelector('.agent-list-name')?.textContent==='Первый агент'`);
      await saved();
      await drag('.agent-list-entry:not([data-system-role]) .agent-list-item', 0, 1);
      await until(`document.querySelector('.agent-list-name')?.textContent==='Второй агент'`);
      await saved();
      await js(
        `Array.from(document.querySelectorAll('.agent-list-item')).find(e=>e.textContent.includes('Первый агент')).click()`,
      );
      await named('Агент включён');
      await saved();
      assert.equal((await agent()).enabled, false);
      assert.equal(
        await js(`document.querySelector('.agent-list-item[aria-current="true"]').dataset.enabled`),
        'false',
      );
      await field('Основной промпт агента', 'Основная роль: создать мультфильм');
      await named('Агент включён');
      await saved();
      await click('Инструкции');
      await addInstruction('Первый блок', 'Текст первого блока');
      await addInstruction('Вернуть блок', 'Восстановить только этот блок');
      await named('Удалить инструкцию: Вернуть блок');
      assert.equal((await agent()).instructions.length, 2);
      await click('Отмена');
      assert.equal((await agent()).instructions.length, 2);
      await named('Удалить инструкцию: Вернуть блок');
      await click('Удалить');
      await saved();
      assert.equal((await agent()).instructions.length, 1);
      await addInstruction('Новый блок', 'Нельзя терять после Undo');
      await click('Вернуть');
      await saved();
      assert.deepEqual(
        (await agent()).instructions.map((i) => i.name),
        ['Вернуть блок', 'Новый блок', 'Первый блок'],
        'Undo must preserve subsequently added instructions',
      );
      await drag('.instruction-drag-handle', 0, 1, '.instruction-sortable');
      await until(
        `document.querySelector('.instruction-sortable .ui-list-row-label')?.textContent==='Новый блок'`,
      );
      await saved();
      await drag('.instruction-drag-handle', 0, 1, '.instruction-sortable');
      await until(
        `document.querySelector('.instruction-sortable .ui-list-row-label')?.textContent==='Вернуть блок'`,
      );
      await saved();
      await named('Использовать инструкцию: Новый блок');
      await saved();
      assert.equal(
        (await agent()).instructions.find((i) => i.name === 'Новый блок').enabled,
        false,
      );
      const resources = ['Навык один', 'Навык два', 'Навык три'].map((name, index) => ({
        id: `qa-skill-${index}`,
        name,
        kind: 'skills',
        source: join(root, `skill-${index}`),
        version: '1',
        description: 'QA fixture',
        transport: 'local',
        args: '',
        credential: '',
        contents: '',
        createdAt: index + 1,
        localSkill: true,
      }));
      for (const resource of resources) {
        await mkdir(resource.source);
        await writeFile(
          join(resource.source, 'SKILL.md'),
          `---\nname: ${resource.id}\ndescription: QA fixture\n---\n\nCurrent fixture skill.`,
        );
      }
      resources.push(
        ...['mcps', 'plugins'].map((kind) => ({
          id: `qa-${kind}`,
          name: `QA ${kind}`,
          kind,
          source: join(root, kind),
          version: '1',
          description: 'QA fixture',
          transport: 'HTTP',
          args: '',
          credential: '',
          contents: '',
          createdAt: 10,
        })),
      );
      await save('resources', resources);
      await attach('Skills', 'Навык один');
      await attach('Skills', 'Навык два');
      await named('Убрать qa-skill-1 у агента');
      await click('Удалить');
      await saved();
      await attach('Skills', 'Навык три');
      await click('Вернуть');
      await saved();
      assert.deepEqual(
        (await agent()).skills,
        ['qa-skill-1', 'qa-skill-2', 'qa-skill-0'],
        'Undo must preserve subsequently attached resources',
      );
      await attach('MCP', 'QA mcps');
      await attach('Плагины', 'QA plugins');
      const account = {
        id: 'qa-account',
        name: 'QA connection',
        purpose: 'pi',
        providerId: 'test',
        endpoint: '',
        account: '',
        createdAt: 1,
      };
      await save('connections', [account]);
      await click('Модель');
      await select('Подключение модели', 'QA connection');
      await until(`!document.querySelector('[aria-label="Модель агента"]').disabled`);
      await select('Модель агента', 'QA model');
      await select('Уровень рассуждения (effort)', 'Высокий');
      await saved();
      assert.equal((await agent()).model.reasoning, 'high');
      await click('Итоговое задание');
      await until(`!!document.querySelector('[aria-label="Итоговые инструкции"]')`);
      const prompt = await js(
        `document.querySelector('textarea[aria-label="Итоговые инструкции"]').value`,
      );
      for (const text of [
        'Основная роль: создать мультфильм',
        'Восстановить только этот блок',
        'Текст первого блока',
        'Навык один',
        'Навык два',
        'Навык три',
        'QA mcps',
        'QA plugins',
        'qa-model',
      ])
        assert.ok(prompt.includes(text), text);
      assert.equal(prompt.includes('Нельзя терять после Undo'), false);
      await click('Закрыть');
      await click('Проекты');
      const state = await load();
      await js(
        `window.studio.projectCommand({kind:'create',name:'Constructor snapshot',agents:[]})`,
      );
      const project = (await load()).projects[0];
      assert.deepEqual(
        project.agents.map((a) => a.profile.id),
        state.sections.agents.map((a) => a.id),
      );
      const snapshot = project.agents.find((a) => a.profile.id === firstId).profile;
      assert.equal('mainInstruction' in snapshot, false);
      assert.equal('instructions' in snapshot, false);
      assert.deepEqual(snapshot.model, (await agent()).model);
      await click('Агенты');
      await named('Удалить агента «Второй агент»');
      assert.equal((await load()).sections.agents.length, 2);
      await click('Отмена');
      await named('Удалить агента «Второй агент»');
      await click('Удалить');
      await saved();
      assert.equal((await load()).sections.agents.length, 1);
      await click('Вернуть');
      await saved();
      assert.deepEqual(
        (await load()).sections.agents.map((a) => a.name),
        ['Второй агент', 'Первый агент'],
      );
      const final = await load();
      assert.deepEqual(
        final.projects[0].agents,
        project.agents,
        'Constructor edits/deletion do not rewrite snapshots',
      );
      await writeFile(join(root, 'expected.json'), JSON.stringify(final));
      await writeFile(
        join(root, 'proof.json'),
        JSON.stringify({
          passed: true,
          appendedAndSelected: true,
          keyboardAgentReorder: true,
          pointerAgentReorder: true,
          pointerInstructionReorder: true,
          disabledEditable: true,
          instructionConfirmationCancelUndo: true,
          undoPreservesLaterInstructions: true,
          resourceUndoPreservesLaterLinks: true,
          skillsMcpPluginsAssigned: true,
          modelAndEffortSelected: true,
          compiledCurrentEnabledInstructions: true,
          snapshotOmitsInstructionText: true,
          agentConfirmationCancelUndo: true,
          snapshotPreserved: true,
          externalRequests: 0,
        }),
      );
      console.log(
        'Constructor editing passed: CRUD, keyboard reorder, confirmed Undo preserves newer edits, resources/model and immutable project snapshot.',
      );
    }
    clearTimeout(deadline);
    for (const created of BrowserWindow.getAllWindows()) created.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
}
(process.versions.electron ? child() : parent()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
