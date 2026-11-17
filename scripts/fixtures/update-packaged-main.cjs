// Copied only into temporary, re-signed QA apps. Never imported or bundled by production.
const { app, ipcMain } = require('electron');
const {
  readFileSync,
  appendFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  realpathSync,
} = require('node:fs');
const { join, relative, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { Readable } = require('node:stream');
const { createReadStream } = require('node:fs');
const config = JSON.parse(readFileSync(process.env.PI_STUDIO_PACKAGED_UPDATE_QA, 'utf8'));
const temporary = realpathSync(tmpdir()),
  root = realpathSync(config.root);
const inside = relative(temporary, root);
if (
  !inside ||
  inside === '..' ||
  inside.startsWith('..' + sep) ||
  !root.includes('pistudio-packaged-update-')
)
  throw Error('Unowned QA root');
const version = require('./package.json').version;
app.setPath('userData', config.userData);
app.setPath('videos', config.videos);
const trace = (event, fields = {}) =>
  appendFileSync(
    join(root, 'trace.jsonl'),
    JSON.stringify({ version, pid: process.pid, event, ...fields }) + '\n',
  );
trace('starting');
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, action) =>
  handle(
    channel,
    channel === 'studio:startup'
      ? () => ({ phase: 'ready', message: 'QA: do not install/start Pi.' })
      : [
            'studio:launch-agent',
            'studio:open-setup-assistant',
            'studio:create-library-asset',
          ].includes(channel)
        ? () => {
            fail('Unexpected model/Terminal launch');
            throw Error('QA blocks model launches');
          }
        : channel === 'studio:update-readiness' &&
            version === config.to &&
            config.mode === 'no-health'
          ? () => undefined
          : channel === 'studio:update-request'
            ? (...args) => {
                trace('request');
                return action(...args);
              }
            : action,
  );

globalThis.fetch = async (address, options) => {
  const url = new URL(String(address));
  if (options?.credentials !== 'omit' || options?.headers?.Authorization)
    throw Error('Update request carries credentials');
  trace('fetch', { address: url.origin + url.pathname });
  if (url.href.startsWith('https://api.github.com/repos/vtlk/pi-studio/releases?')) {
    const bytes = readFileSync(config.releases);
    return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  }
  if (url.href === config.manifestUrl) {
    const bytes = readFileSync(config.metadata);
    return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  }
  if (url.href === config.archiveUrl) {
    return new Response(Readable.toWeb(createReadStream(config.archive)), {
      headers: { 'content-length': String(config.archiveBytes) },
    });
  }
  throw Error('Unexpected network in isolated update test: ' + url.origin);
};
let window,
  reading = false,
  consent = false,
  openingOffer = false,
  lastState = '',
  finishing = false;
const fail = (message) => {
  trace('failure', { message });
  writeFileSync(join(root, 'failure.json'), JSON.stringify({ version, pid: process.pid, message }));
  app.exit(1);
};
const deadline = setTimeout(() => fail('Packaged QA app timed out'), 165000);
app.on('quit', () => {
  clearTimeout(deadline);
  trace('quit');
});
app.on('browser-window-created', (_event, value) => {
  window = value;
  window.webContents.setAudioMuted(true);
  window.webContents.once('did-finish-load', () => {
    window.webContents.removeAllListeners('will-prevent-unload');
    window.webContents.on('will-prevent-unload', () => fail('QA quit before saved'));
    trace('loaded', { visible: window.isVisible() });
  });
});
const js = (code) => window.webContents.executeJavaScript(code);
const expectedStageGone = () =>
  !readdirSync(root).some((name) => name.startsWith('.pistudio-update-')) &&
  !existsSync(join(config.userData, 'updates/active.json'));
const timer = setInterval(async () => {
  if (
    reading ||
    finishing ||
    !window ||
    window.isDestroyed() ||
    window.webContents.isLoadingMainFrame()
  )
    return;
  reading = true;
  try {
    if (window.isVisible()) throw Error('QA window became visible');
    const state = await js('window.studio.getUpdateState()');
    const summary = JSON.stringify([state.phase, state.offer?.version, state.startup?.phase]);
    if (summary !== lastState) {
      lastState = summary;
      trace('state', {
        phase: state.phase,
        offer: state.offer?.version,
        startup: state.startup?.phase,
      });
    }
    if (version === config.from && !state.startup && !consent) {
      const header = await js(`document.querySelector('.project-header h1')?.textContent`);
      if (header !== config.projectName) {
        await js(
          `(()=>{const button=[...document.querySelectorAll('.project-list-row')].find(item=>item.textContent.includes(${JSON.stringify(config.projectName)}));button?.click();})()`,
        );
        return;
      }
      if (!existsSync(join(root, 'baseline-ready.json'))) {
        writeFileSync(
          join(root, 'baseline-ready.json'),
          JSON.stringify({ pid: process.pid, version }),
        );
        trace('baseline');
      }
      if (!existsSync(join(root, 'allow-consent'))) return;
      if (state.offer?.version !== config.to) return;
      if (!openingOffer) {
        await js(
          `document.querySelector('button[aria-label='+JSON.stringify(${JSON.stringify(`Доступна версия ${config.to} — обновить`)})+']')?.click()`,
        );
        openingOffer = true;
        return;
      }
      const clicked = await js(
        `(()=>{const button=[...document.querySelectorAll('[data-update-dialog] button')].find(item=>item.textContent==='Обновить');if(!button)return false;button.click();return true;})()`,
      );
      if (clicked) {
        consent = true;
        trace('consent');
      }
    }
    if (
      (version === config.to && state.startup?.phase === 'committed') ||
      (version === config.from && state.startup?.phase === 'restored')
    ) {
      if (!expectedStageGone()) return;
      const display = await js(
        `({header:document.querySelector('.project-header h1')?.textContent,inert:document.querySelector('.update-workspace')?.inert,idle:document.querySelector('.prototype-label')?.dataset.saveState==='idle'||(document.querySelector('.prototype-label')?.dataset.saveState===undefined&&document.querySelector('.prototype-label')?.textContent==='Сохранено')})`,
      );
      if (display.header !== config.projectName || display.inert || !display.idle)
        return;
      const info = await js('window.studio.getInfo()');
      if (info.version !== version)
        throw Error('Compiled version does not match the actual application');
      finishing = true;
      clearInterval(timer);
      writeFileSync(
        join(root, 'finished.json'),
        JSON.stringify({ version, pid: process.pid, startup: state.startup.phase, ...display }),
      );
      trace('finished');
      app.quit();
    }
    if (state.phase === 'error' && consent) throw Error(state.message || 'Update failed');
    if (state.startup?.phase === 'recovery-required') throw Error(state.startup.message);
  } catch (error) {
    fail(error.message);
  } finally {
    reading = false;
  }
}, 200);
app.on('quit', () => clearInterval(timer));
require('./qa-offscreen.cjs').loadOffscreenMain(join(__dirname, 'out/main/index.cjs'));
