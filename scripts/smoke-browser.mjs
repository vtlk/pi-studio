import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { realpath } from 'node:fs/promises';
import { readAgentBrowser } from '../src/main/browser/installAgentBrowser.ts';
import { readChrome } from '../src/main/browser/installChrome.ts';
import { AGENT_BROWSER_VERSION, CHROME_VERSION } from '../src/main/browser/browserVersions.ts';

// Real upstream browser + Pi's native MCP transport. Only a private loopback fixture; no model, OS UI or personal browser.
const runtime = process.argv[2];
assert.ok(runtime, 'Pass an installer-created runtime root with agent-browser/ and chrome/.');
const binary = await readAgentBrowser(join(runtime, `agent-browser-${AGENT_BROWSER_VERSION}`));
const chrome = await readChrome(join(runtime, `chrome-${CHROME_VERSION}`));
assert.ok(binary && chrome);
const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-browser-smoke-')));
const events = [],
  requests = [],
  clients = new Set();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/event') {
    events.push(url.searchParams.get('name'));
    res.end('ok');
    return;
  }
  if (url.pathname === '/download') {
    res.writeHead(200, { 'Content-Disposition': 'attachment; filename="fixture.txt"' });
    res.end('BROWSER_DOWNLOAD_FIXTURE');
    return;
  }
  if (url.pathname === '/upload') {
    let bytes = '';
    for await (const chunk of req) bytes += chunk;
    events.push('upload:' + bytes);
    res.end('ok');
    return;
  }
  if (url.pathname === '/frame') {
    res.end(
      '<button style="position:absolute;left:30px;top:30px;width:160px;height:50px" onclick="fetch(\'/event?name=iframe\')">Iframe target</button>',
    );
    return;
  }
  requests.push({ dialogue: url.searchParams.get('id'), cookie: req.headers.cookie ?? '' });
  if (url.searchParams.get('set'))
    res.setHeader('Set-Cookie', `dialogue=${url.searchParams.get('set')}; Path=/; SameSite=Lax`);
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;min-height:1800px;font:20px system-ui;background:#f4f4f5}button,input,a{font:inherit}button{cursor:pointer}#icon{position:absolute;left:400px;top:100px;width:64px;height:64px}#overlay{position:absolute;left:0;top:0;width:1280px;height:800px;background:#0005;display:none;z-index:2}#modal{position:absolute;left:450px;top:300px;width:220px;height:80px}#dynamic{position:absolute;left:720px;top:100px;width:180px;height:60px}</style></head><body>
  <h1 style="margin:20px">Private browser fixture</h1>
  <canvas id="canvas" width="200" height="100" style="position:absolute;left:120px;top:100px"></canvas>
  <button id="icon" aria-label="Open menu">☰</button><button id="dynamic">Move target</button>
  <input aria-label="Message" id="message" style="position:absolute;left:120px;top:250px;width:400px;height:50px">
  <iframe src="/frame" style="position:absolute;left:120px;top:400px;width:500px;height:180px;border:0"></iframe>
  <input type="file" aria-label="Upload fixture" style="position:absolute;left:700px;top:400px">
  <a href="/download" style="position:absolute;left:700px;top:500px">Download fixture</a>
  <div id="overlay"><button id="modal">Close overlay</button></div>
  <script>const event=n=>fetch('/event?name='+encodeURIComponent(n));const c=document.querySelector('canvas'),g=c.getContext('2d');g.fillStyle='#f59e0b';g.fillRect(0,0,200,100);g.fillStyle='black';g.fillText('Canvas target',50,50);c.onclick=()=>{g.fillStyle='#22c55e';g.fillRect(0,0,200,100);event('canvas')};
  let down;c.onmousedown=e=>down=[e.clientX,e.clientY];c.onmouseup=e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])>20)event('drag')};onscroll=()=>event('scroll:'+Math.round(scrollY));
  icon.onclick=()=>{overlay.style.display='block';event('icon')};modal.onclick=()=>{overlay.style.display='none';event('overlay')};dynamic.onclick=()=>{dynamic.style.left='940px';dynamic.textContent='Moved';event('dynamic')};
  message.oninput=()=>event('typed:'+message.value);document.querySelector('[type=file]').onchange=async e=>{await fetch('/upload',{method:'POST',body:await e.target.files[0].text()})};</script>
  </body></html>`);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const pi = await checkPi('');
const sdkPath = await resolvePiSdk(await realpath(pi.path));
const { McpServerConnection, createDefaultTransport, McpOAuthCredentialStore } = await import(
  pathToFileURL(join(dirname(sdkPath), 'extensions/mcp/runtime.js'))
);
const script = resolve('bundled/pi-bridge/browser/server.mjs');
const output = join(root, 'project/output');
await mkdir(output, { recursive: true });
await writeFile(join(root, 'project/reference.txt'), 'UPLOAD_FIXTURE');
const binding = {
  scope: 'private-fixture',
  sessions: join(root, 'dialogues'),
  binary,
  chrome,
  visual: true,
  projectRoot: join(root, 'project'),
  outputRoot: output,
};
await writeFile(join(root, 'binding.json'), JSON.stringify(binding));
async function connect(id, file = 'binding.json') {
  const client = new McpServerConnection({
    entry: {
      name: 'pi_studio_browser',
      source: 'QA',
      scope: 'extension',
      config: {
        command: join(dirname(pi.path), 'node'),
        args: [script, join(root, file)],
        env: { PI_STUDIO_BROWSER_SESSION: id },
        timeout: 60,
      },
    },
    cwd: root,
    createTransport: createDefaultTransport,
    credentials: new McpOAuthCredentialStore(),
    onTools() {},
  });
  clients.add(client);
  await client.getClient();
  assert.equal(client.state, 'connected');
  assert.equal(client.tools.length, 17);
  return client;
}
const proof = {
  checkedAt: new Date().toISOString(),
  backend: '0.43.0',
  chrome: '157.0.8103.78',
  nativePi: pi.version,
  modelRequests: 0,
  personalBrowserUsed: false,
};
async function call(client, name, args = {}, image = true) {
  const response = await client.callTool('browser_' + name, args, {});
  assert.ok(
    !response.isError,
    response.content
      ?.filter((x) => x.type === 'text')
      .map((x) => x.text)
      .join('\n'),
  );
  if (image) {
    const shot = response.content.find((x) => x.type === 'image');
    assert.ok(shot);
    const png = Buffer.from(shot.data, 'base64');
    assert.equal(png.readUInt32BE(16), 1280);
    assert.equal(png.readUInt32BE(20), 800);
  }
  return response;
}
try {
  const a = await connect('canonical-a'),
    b = await connect('canonical-b');
  await call(a, 'open', { url: base + '/?id=a&set=alpha' });
  await call(b, 'open', { url: base + '/?id=b' });
  assert.equal(requests.find((x) => x.dialogue === 'b').cookie, '');
  const before = await call(a, 'screenshot');
  await call(a, 'click', { x: 200, y: 150 });
  assert.ok(events.includes('canvas'));
  await call(a, 'drag', { x: 160, y: 125, toX: 260, toY: 175 });
  assert.ok(events.includes('drag'));
  await call(a, 'scroll', { x: 1100, y: 700, dy: 300 });
  assert.ok(events.some(x => /^scroll:[1-9]/.test(x)));
  await call(a, 'scroll', { x: 1100, y: 700, dy: -300 });
  await call(a, 'click', { x: 430, y: 132 });
  assert.ok(events.includes('icon'));
  await call(a, 'click', { x: 550, y: 340 });
  assert.ok(events.includes('overlay'));
  await call(a, 'click', { x: 200, y: 470 });
  assert.ok(events.includes('iframe'));
  await call(a, 'click', { x: 810, y: 130 });
  await call(a, 'click', { x: 1020, y: 130 });
  assert.equal(events.filter((x) => x === 'dynamic').length, 2);
  await call(a, 'click', { x: 220, y: 275 });
  await call(a, 'type', { text: 'Привет из Pi' });
  assert.ok(events.includes('typed:Привет из Pi'));
  const ax = await call(a, 'accessibility', {}, false);
  const info = ax.content
    .filter((x) => x.type === 'text')
    .map((x) => x.text)
    .join('\n');
  const ref = info.match(/Upload fixture[^\n]*\[ref=(e\d+)\]/)?.[1];
  assert.ok(ref, info.slice(0, 3000));
  await call(a, 'screenshot');
  await call(a, 'upload', { ref, files: ['reference.txt'] });
  assert.ok(events.includes('upload:UPLOAD_FIXTURE'));
  await call(a, 'click', { x: 810, y: 515 });
  let downloads;
  for (let i = 0; i < 20; i++) {
    downloads = await call(a, 'downloads', {}, false);
    if (downloads.content[0].text.includes('fixture.txt')) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.match(downloads.content[0].text, /fixture.txt/);
  await call(a, 'save_download', { name: 'fixture.txt', output: 'browser/result.txt' }, false);
  assert.equal(
    await readFile(join(output, 'browser/result.txt'), 'utf8'),
    'BROWSER_DOWNLOAD_FIXTURE',
  );
  const bad = await a.callTool('browser_open', { url: base, session: 'canonical-b' }, {});
  assert.ok(bad.isError);
  const traversal = await a.callTool(
    'browser_save_download',
    { name: 'fixture.txt', output: '../escape.txt' },
    {},
  );
  assert.ok(traversal.isError);
  await a.close();
  clients.delete(a);
  await call(b, 'screenshot'); // Closing A must not kill B.
  const resumed = await connect('canonical-a');
  await call(resumed, 'open', { url: base + '/?id=resumed' });
  assert.match(requests.find((x) => x.dialogue === 'resumed').cookie, /dialogue=alpha/);
  await writeFile(
    join(root, 'unavailable.json'),
    JSON.stringify({ ...binding, binary: '/missing', chrome: '/missing' }),
  );
  const missing = await connect('missing', 'unavailable.json');
  const state = await call(missing, 'status', {}, false);
  assert.match(state.content[0].text, /не установлены/);
  assert.ok((await missing.callTool('browser_open', { url: base }, {})).isError);
  await writeFile(join(root, 'nonvisual.json'), JSON.stringify({ ...binding, visual: false }));
  const nonvisual = await connect('nonvisual', 'nonvisual.json');
  assert.ok((await nonvisual.callTool('browser_open', { url: base }, {})).isError);
  Object.assign(proof, {
    tools: 17,
    cssPixels: '1280x800 scale 1',
    canvas: true,
    iconOnly: true,
    nestedFrame: true,
    overlay: true,
    dynamicLayout: true,
    unicodeInput: true,
    drag: true,
    scroll: true,
    upload: true,
    download: true,
    isolatedCookies: true,
    exactDialogueProfileResume: true,
    missingComponentsDoNotBlockMcp: true,
    nonvisualModelRejected: true,
    scopeOverrideRejected: true,
  });
  assert.ok(before.content.some((x) => x.type === 'image'));
} finally {
  await Promise.allSettled([...clients].map((client) => client.close()));
  await new Promise((done) => setTimeout(done, 1500));
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid,args'], {
    maxBuffer: 2 * 1024 ** 2,
  });
  const remaining = stdout
    .split('\n')
    .filter((line) => line.includes(root) && /chrome-headless-shell|agent-browser/.test(line));
  proof.cleanup = remaining.length === 0;
  await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
  assert.deepEqual(remaining, [], 'Owned browser processes must close with native MCP.');
}
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/browser-runtime-proof.json', JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof));
