import { app, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { desktopChannels } from '../../shared/contracts';
import type { McpSecretEdit, McpSecretRequest } from '../../shared/mcpSecrets';
import type { StudioService } from '../storage/StudioStore';
import { SecretVault } from '../storage/SecretVault';
import { McpSecrets } from './McpSecrets';

export function registerMcpSecretHandlers(
  service: StudioService,
  caller: (event: IpcMainInvokeEvent) => unknown,
  piPath: () => string,
) {
  const secrets = new McpSecrets(
    service,
    new SecretVault(join(app.getPath('userData'), 'mcp-secrets'), safeStorage),
    piPath,
  );
  ipcMain.handle(desktopChannels.readMcpSecretStatus, (event, request: McpSecretRequest) => {
    caller(event);
    return secrets.status(request);
  });
  ipcMain.handle(
    desktopChannels.saveMcpSecrets,
    (event, request: McpSecretEdit & { values: Record<string, string> }) => {
      caller(event);
      return secrets.save(request);
    },
  );
  ipcMain.handle(desktopChannels.removeMcpSecrets, (event, request: McpSecretEdit) => {
    caller(event);
    return secrets.remove(request);
  });
  return secrets;
}
