import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { collectUsage } from './usage.mjs';

// No model runtime, auth, extensions, network or changes to the canonical file.
global.fetch = async () => { throw new Error('Usage recovery is offline.'); };
try {
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 10000) throw Error(); }
  const request = JSON.parse(input);
  const handle = await open(request.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let entries;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 64 * 1024 ** 2) throw Error();
    const bytes = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
    const after = await handle.stat();
    if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw Error();
    entries = bytes.subarray(0, offset).toString('utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    if (entries[0]?.type !== 'session' || entries[0].version !== 3) throw Error();
  } finally { await handle.close(); }
  const { SessionManager } = await import(pathToFileURL(process.argv[2]).href);
  const manager = SessionManager.inMemory(request.cwd, undefined, entries);
  const records = collectUsage(manager.getEntries());
  await new Promise((done, reject) => process.stdout.write(JSON.stringify({ records }), error => error ? reject(error) : done()));
} catch { process.exitCode = 1; }
