import { readFile, realpath, appendFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep, basename } from 'node:path';

// Assigned only to owned QA profiles. Not bundled or installed in the user's Pi.
const quote = (text) => "'" + text.replaceAll("'", "'\"'\"'") + "'";
const inside = (root, path) => {
  const r = relative(root, path);
  return !r || (r !== '..' && !r.startsWith('..' + sep));
};
async function canonical(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return resolve(await canonical(dirname(path)), basename(path));
  }
}
export default async function (pi) {
  const config = JSON.parse(await readFile(new URL('./scope.json', import.meta.url), 'utf8'));
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName === 'bash') {
      const input = event.input;
      if (typeof input.command !== 'string')
        return { block: true, reason: 'QA bash requires a command.' };
      await appendFile(
        config.audit,
        JSON.stringify({ at: Date.now(), action: 'sandboxed-bash' }) + '\n',
      );
      input.command = [
        'exec /usr/bin/env -i',
        'PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        'LANG=en_US.UTF-8',
        'HOME=' + quote(config.home),
        'TMPDIR=' + quote(config.temp),
        '/usr/bin/sandbox-exec',
        '-D ' + quote('QA_OUTPUT=' + config.output),
        '-D ' + quote('QA_HOME=' + config.realHome),
        '-f ' + quote(config.profile),
        '/bin/bash -c ' + quote(input.command),
      ].join(' ');
    } else if (['read', 'write', 'edit'].includes(event.toolName)) {
      const path = event.input.path;
      if (typeof path !== 'string' || path.startsWith('~') || path.includes('\0'))
        return {
          block: true,
          reason: 'QA file tools require an explicit path in the owned test workspace.',
        };
      const target = await canonical(resolve(ctx.cwd, path));
      const allowed = event.toolName === 'read' ? config.root : config.output;
      if (!inside(allowed, target)) {
        await appendFile(
          config.audit,
          JSON.stringify({ at: Date.now(), action: 'blocked-file', tool: event.toolName }) + '\n',
        );
        return {
          block: true,
          reason:
            'QA file operation is outside the owned workspace/output. Use your output and its .qa-tmp directory.',
        };
      }
    }
  });
}
