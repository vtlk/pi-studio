import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import model from '../src/main/voice/model.json' with { type: 'json' };
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import en from '../src/shared/i18n/en.json' with { type: 'json' };
import ru from '../src/shared/i18n/ru.json' with { type: 'json' };

// Uses only the installed, isolated headless shell. Never launches the system browser or Electron.
const executable =
  process.env.PISTUDIO_QA_CHROME ||
  join(
    homedir(),
    'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  );
if (executable.includes('/Applications/')) throw Error('QA must not launch the system browser');
const root = await mkdtemp(join(tmpdir(), 'pistudio-rich-preview-'));
const webRoot = resolve('out/renderer');
let probes = 0;
const modelRoot = process.env.PI_STUDIO_VOICE_QA_MODEL_ROOT;
const sample = process.env.PI_STUDIO_VOICE_QA_WAV;
if (!modelRoot || !sample)
  throw Error('Explicit isolated QA model root and public-fixture WAV are required');
for (const file of model.files) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const part of createReadStream(join(modelRoot, file.name))) {
    hash.update(part);
    size += part.length;
  }
  assert.equal(size, file.bytes);
  assert.equal(hash.digest('hex'), file.sha256);
}
let servedModelBytes = 0;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/qa-voice.html') {
      const index = await readFile(join(webRoot, 'index.html'), 'utf8');
      const policy = index.match(/content="(default-src[^"]+)"/)[1];
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><title>Isolated local voice QA</title>`,
      );
      return;
    }
    if (url.pathname === '/qa-public.wav' || url.pathname === '/qa-second.wav') {
      response.setHeader('Content-Type', 'audio/wav');
      createReadStream(
        url.pathname === '/qa-second.wav' ? process.env.PI_STUDIO_VOICE_QA_WAV_SECOND : sample,
      ).pipe(response);
      return;
    }
    if (url.pathname.startsWith('/voice-model/')) {
      console.log('Model request', request.url);
      const name = decodeURIComponent(url.pathname).slice(
        ('/voice-model/' + model.repo + '/').length,
      );
      const file = model.files.find((file) => file.name === name);
      if (!file) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.setHeader(
        'Content-Type',
        name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      );
      response.setHeader('Content-Length', file.bytes);
      servedModelBytes += file.bytes;
      createReadStream(join(modelRoot, file.name)).pipe(response);
      return;
    }
    if (new URL(request.url, 'http://localhost').pathname === '/html-probe') probes++;
    if (/^\/qa-(portrait|landscape)\.mp4$/.test(request.url)) {
      response.setHeader('Content-Type', 'video/mp4');
      const bytes = await readFile(join(root, request.url.slice(4)));
      response.setHeader('Accept-Ranges', 'bytes');
      if (request.headers.range) {
        const [, from, to] = /bytes=(\d+)-(\d*)/.exec(request.headers.range);
        const start = Number(from),
          end = to ? Number(to) : bytes.length - 1;
        response.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
          'Content-Length': end - start + 1,
        });
        response.end(bytes.subarray(start, end + 1));
      } else {
        response.setHeader('Content-Length', bytes.length);
        response.end(bytes);
      }
      return;
    }
    const path = resolve(
      webRoot,
      '.' + new URL(request.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'),
    );
    if (!path.startsWith(webRoot + sep)) throw Error('scope');
    let bytes = await readFile(path);
    if (path.includes('voice.worker-'))
      bytes = Buffer.from(
        bytes
          .toString()
          .replaceAll(
            'studio-voice://models/',
            `http://127.0.0.1:${server.address().port}/voice-model/`,
          ),
      );
    response.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
      }[extname(path)] || 'application/octet-stream',
    );
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser, socket;
const errors = [];
try {
  browser = spawn(
    executable,
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${join(root, 'profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-extensions',
      '--disable-breakpad',
      '--no-sandbox',
      '--use-mock-keychain',
      '--password-store=basic',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const address = await new Promise((done, fail) => {
    let log = '';
    const timer = setTimeout(() => fail(Error('Headless startup timed out: ' + log)), 15000);
    browser.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    browser.once('exit', (code) => {
      clearTimeout(timer);
      fail(Error(`Headless shell exited before startup (${code}): ${log}`));
    });
    browser.stderr.on('data', (data) => {
      log += data;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
    browser.on('exit', (code) => {
      clearTimeout(timer);
      fail(Error(`Headless exited ${code}: ${log}`));
    });
  });
  socket = new WebSocket(address);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = fail;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown')
      errors.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      );
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      message.error
        ? request.reject(Error(JSON.stringify(message.error)))
        : request.resolve(message.result);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(Error(`CDP timed out: ${method}`));
      }, 15000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(
        JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }),
      );
    });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1100,
    height: 840,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const js = async (expression) => {
    const value = await cdp('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (value.exceptionDetails)
      throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/qa-voice.html` });
  const deadline = async (expression, milliseconds) => {
    const start = Date.now();
    let next = start + 30000;
    while (Date.now() - start < milliseconds) {
      const error = await js('window.voiceResult?.error');
      if (error) throw Error(JSON.stringify(error));
      if (await js(expression)) return Date.now() - start;
      if (Date.now() > next) {
        console.log('Local model still computing', Date.now() - start);
        next = Date.now() + 30000;
      }
      await new Promise((done) => setTimeout(done, 250));
    }
    throw Error('Voice fixture timed out: ' + expression);
  };
  const asset = (await readdir(join(webRoot, 'assets'))).find((name) =>
    /^voice\.worker-.*\.js$/.test(name),
  );
  assert.ok(asset, 'Compiled production voice worker exists');
  await js(
    `window.voiceResult={};window.voiceWorker=new Worker('/assets/${asset}');window.voiceWorker.onmessage=({data})=>{if(data.error)window.voiceResult.error=data;else Object.assign(window.voiceResult,data)};window.voiceWorker.onerror=e=>window.voiceResult.error=e.message;window.voiceWorker.postMessage({id:1,command:'load'});`,
  );
  const loadMs = await deadline('window.voiceResult.ready===true', 300000);
  console.log('Actual Whisper Turbo loaded', loadMs);
  const recordings = [];
  const cases = [
    {
      url: '/qa-public.wav',
      expect: process.env.PI_STUDIO_VOICE_QA_EXPECT ?? 'country|americans',
      language: process.env.PI_STUDIO_VOICE_QA_LANGUAGE,
      fixture: process.env.PI_STUDIO_VOICE_QA_FIXTURE ?? 'Public JFK speech',
    },
  ];
  if (process.env.PI_STUDIO_VOICE_QA_WAV_SECOND)
    cases.push({
      url: '/qa-second.wav',
      expect: process.env.PI_STUDIO_VOICE_QA_EXPECT_SECOND,
      language: process.env.PI_STUDIO_VOICE_QA_LANGUAGE_SECOND,
      fixture: process.env.PI_STUDIO_VOICE_QA_FIXTURE_SECOND,
    });
  for (const item of cases) {
    await js(`window.voiceResult={backend:window.voiceResult.backend};`);
    await js(
      `(async()=>{const bytes=await(await fetch('${item.url}')).arrayBuffer();const context=new OfflineAudioContext(1,16000,16000);const decoded=await context.decodeAudioData(bytes);const audio=new Float32Array(decoded.getChannelData(0));window.voiceWorker.postMessage({id:2,command:'transcribe',audio},[audio.buffer]);})()`,
    );
    const inferenceMs = await deadline("typeof window.voiceResult.text==='string'", 300000);
    const text = await js('window.voiceResult.text');
    const language = await js('window.voiceResult.language');
    assert.match(text, new RegExp(item.expect, 'iu'));
    if (item.language) assert.equal(language, item.language);
    recordings.push({ fixture: item.fixture, inferenceMs, language, text });
    console.log('Speech recording verified', JSON.stringify(recordings.at(-1)));
  }
  const { inferenceMs, text } = recordings[0];
  assert.deepEqual(errors, []);
  const proof = {
    checkedAt: new Date().toISOString(),
    model: model.repo,
    revision: model.revision,
    dtype: 'q4',
    engine: 'Actual compiled Transformers.js 4.3.2 + packaged ONNX Web worker',
    backend: await js('window.voiceResult.backend'),
    loadMs,
    inferenceMs,
    audioFixture:
      process.env.PI_STUDIO_VOICE_QA_FIXTURE ??
      'OpenAI Whisper tests/jfk.flac (JFK public speech), converted locally to 16 kHz mono',
    detectedLanguage: recordings[0].language,
    transcript: text,
    recordings,
    sameWorkerForAllRecordings: true,
    servedModelBytes,
    hashPinnedModelFilesVerified: true,
    nativeMicrophoneOrPermissionsProbed: false,
    userAppOrDataChanged: false,
    transport:
      'Only the compiled studio-voice URL literal is mapped to isolated loopback HTTP serving the same verified model files; not native Windows/OS microphone acceptance',
  };
  await writeFile(
    'artifacts/' + (process.env.PI_STUDIO_VOICE_QA_PROOF ?? 'local-whisper-turbo-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(JSON.stringify(proof));
} finally {
  socket?.close();
  if (browser?.pid && browser.exitCode === null) {
    const ended = new Promise((done) => browser.once('exit', done));
    browser.kill('SIGTERM');
    await ended;
  }
  await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
}
