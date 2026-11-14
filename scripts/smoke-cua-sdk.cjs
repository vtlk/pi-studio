const { app, BrowserWindow } = require('electron');
const { mkdtemp, rm, writeFile, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
app.setActivationPolicy('accessory');
let root, driver;
const deadline = setTimeout(() => { console.error('Cua SDK probe timed out'); app.exit(1); }, 20000);
(async () => {
  root = await mkdtemp(join(tmpdir(), 'pistudio-cua-sdk-'));
  app.setPath('userData', root);
  await app.whenReady();
  const sdk = await import('@trycua/cua-driver');
  driver = sdk.CuaDriver.createConfigured(sdk.ConfiguredDriverOptions.new({
    claudeCodeCompatibility: false,
    authorization: sdk.RuntimeAuthorizationOptions.new({
      allowedModes: [sdk.SessionPermissionMode.Standard],
      compatibilityMode: sdk.SessionPermissionMode.Standard,
      unrestrictedAcknowledged: false,
      maxSessionTtlSeconds: 28800n,
      maxIdleTtlSeconds: 300n,
    }),
  }));
  const metadata = await driver.metadata();
  assert.equal(metadata.driverVersion, '0.49.11');
  assert.equal(metadata.embedded, true);
  assert.equal(metadata.pid, process.pid);
  assert.equal(driver.socketPath(), '');
  const inventory = JSON.parse(await driver.listToolsJson());
  const tools = Array.isArray(inventory) ? inventory : inventory.tools;
  for (const name of ['list_apps','list_windows','get_window_state','click','drag','type_text','scroll','check_permissions']) assert.ok(tools.some(tool => tool.name === name));
  // Read-only probe only. No OS prompt, app discovery, pixels or desktop input.
  const permissions = await driver.callTool('check_permissions', JSON.stringify({ prompt: false, probe_direct_capture: false }));
  assert.equal(permissions.images.length, 0);
  const state = JSON.parse(permissions.structuredJson);
  assert.equal(state.source.direct_runtime, true);
  assert.equal(state.source.pid, process.pid);
  assert.equal(state.direct_capture_status, 'not_checked');
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  const proof = {
    checkedAt: new Date().toISOString(), sdk: metadata.driverVersion, contract: metadata.contractVersion,
    electron: process.versions.electron, node: process.versions.node,
    sameProcessRuntime: true, noDaemonOrSocket: true, standardModeOnly: true,
    toolManifestCount: tools.length, nativeFfiRoundTrip: true, promptlessPermissionProbe: true,
    noWindowsOrDesktopActions: true, noModelRequests: true,
    limits: 'Isolated Electron launched by Codex, not the installed Pi Studio responsibility chain. Does not prove Pi Studio TCC grants, capture pixels or input delivery. SDK/MCP/app integration and GUI acceptance remain open.',
  };
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/cua-sdk-probe-proof.json',JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof));
  await driver.shutdown(); driver.uniffiDestroy(); driver = undefined;
  clearTimeout(deadline); await rm(root,{recursive:true,force:true}); app.exit(0);
})().catch(async error => { console.error(error); clearTimeout(deadline); if(driver){await driver.shutdown().catch(()=>{});driver.uniffiDestroy();}if(root)await rm(root,{recursive:true,force:true});app.exit(1); });
