import { readFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { npmSettings, runtimeInformation, withNodeCommand } from './node-tools.mjs';
import { assertPiResources } from './package-resources.mjs';
import { shellSettings } from './shell-tools.mjs';

let connection;
process.once('SIGTERM', () => {
  if (connection) void connection.close().finally(() => process.exit(1));
  else process.exit(1);
});
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 100000) throw new Error();
  }
  const request = JSON.parse(input);
  const sdkUrl = pathToFileURL(process.argv[2]);
  const { getAgentDir, ModelRuntime, DefaultPackageManager, SettingsManager } = await import(
    sdkUrl.href
  );
  const agentDir = getAgentDir(),
    cwd = request.cwd;
  const configApi = await import(new URL('./extensions/mcp/config.js', sdkUrl).href);
  const core = await import(new URL('./core/mcp-servers.js', sdkUrl).href);
  const loaded = () => configApi.loadMcpConfig({ agentDir, cwd, projectTrusted: false });
  const server = () => {
    if (request.config) {
      const config = core.validateMcpServerConfig(request.name, request.config);
      if (typeof config === 'string') throw new Error();
      return { name: request.name, config, source: 'Pi Studio assignment', scope: 'extension' };
    }
    const entry = loaded().servers.find((entry) => entry.name === request.name);
    if (!entry) throw new Error();
    return entry;
  };
  const metadata = (entry) => ({
    name: entry.name,
    transport: entry.config.command ? 'stdio' : 'HTTP',
    description: entry.config.description ?? '',
    enabled: entry.config.enabled !== false,
  });
  let result;
  if (request.action === 'inspect-runtime') {
    result = { runtime: runtimeInformation() };
    const shells = await import(new URL('./utils/shell.js', sdkUrl).href);
    try {
      const shell =
        process.platform === 'win32'
          ? shells.getPowerShellConfig()
          : shells.getShellConfig(shellSettings().shellPath);
      result.runtime.shell = { available: true, ...shell };
    } catch {
      result.runtime.shell = { available: false };
    }
  } else if (request.action === 'list-mcp') {
    const config = loaded();
    result = { servers: config.servers.map(metadata), invalidEntries: config.errors.length };
  } else if (request.action === 'configure-mcp') {
    const entry = server();
    const previous = loaded().servers.find(
      (other) => other.name.replaceAll('-', '_') === entry.name.replaceAll('-', '_'),
    );
    if (previous && (!request.replace || previous.name !== entry.name)) throw new Error();
    configApi.addMcpServerConfig(join(agentDir, 'mcp.json'), entry.name, entry.config);
    result = metadata(entry);
  } else if (request.action === 'check-mcp') {
    const entry = server();
    if (entry.config.enabled === false) result = { status: 'disabled', toolCount: 0 };
    else {
      const runtime = await import(new URL('./extensions/mcp/runtime.js', sdkUrl).href);
      let models;
      connection = new runtime.McpServerConnection({
        entry: withNodeCommand(entry),
        cwd,
        createTransport: runtime.createDefaultTransport,
        credentials: new runtime.McpOAuthCredentialStore(),
        providerToken: async (provider) => {
          models ??= await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: true });
          return (await models.getAuth(provider))?.auth.apiKey;
        },
        onTools: () => {},
      });
      let timer;
      try {
        await Promise.race([
          connection.getClient(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error()), 30000);
          }),
        ]);
        result = {
          status: 'available',
          toolCount: connection.tools.filter(
            (tool) => core.getMcpToolExposure(entry.config, tool.name) !== 'hidden',
          ).length,
        };
      } catch {
        result = {
          status: connection.state === 'needs-auth' ? 'needs_auth' : 'unavailable',
          toolCount: 0,
        };
      } finally {
        clearTimeout(timer);
        await connection.close();
        await models?.settleCredentialWrites();
      }
    }
  } else if (request.action === 'install-package' || request.action === 'check-package') {
    if (request.action === 'check-package') process.env.PI_OFFLINE = '1';
    else delete process.env.PI_OFFLINE;
    const manager = new DefaultPackageManager({
      cwd,
      agentDir,
      settingsManager: SettingsManager.inMemory({ packages: [], ...npmSettings() }),
    });
    const paths = await manager.resolveExtensionSources([request.source], { temporary: true });
    const resources = ['extensions', 'skills', 'prompts', 'themes'].flatMap((kind) =>
      paths[kind]
        .filter((item) => item.enabled)
        .map((item) => ({ kind, path: item.path, root: item.metadata.packageRoot })),
    );
    if (paths.installFailures?.length)
      throw Object.assign(new Error(), { category: 'package-install-failed' });
    await assertPiResources(paths);
    let version = '';
    const root = resources.find((item) => item.root)?.root;
    if (root) {
      try {
        const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        version = typeof manifest.version === 'string' ? manifest.version : '';
      } catch {
        /* Standalone local resources have no package version. */
      }
    }
    result = {
      status: 'available',
      version,
      contents: resources.map(({ kind, path }) => `${kind}: ${basename(path)}`).join(', '),
      count: resources.length,
    };
  } else throw new Error();
  // Dedicated pipe: npm/server output and credentials can never become a tool/UI result.
  writeSync(3, JSON.stringify({ ok: true, result }));
} catch (error) {
  // Never forward npm/server stderr or raw exceptions: these may contain credentials.
  const category = ['not-pi-package', 'package-install-failed'].includes(error?.category)
    ? error.category
    : undefined;
  writeSync(3, JSON.stringify({ ok: false, category }));
  process.exitCode = 1;
}
