import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { app, safeStorage, type IpcMainInvokeEvent } from 'electron';
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
  handleDesktopInvoke(desktopChannels.readMcpSecretStatus, (event, request: McpSecretRequest) => {
    caller(event);
    return secrets.status(request);
  });
  handleDesktopInvoke(
    desktopChannels.saveMcpSecrets,
    (event, request: McpSecretEdit & { values: Record<string, string> }) => {
      caller(event);
      return secrets.save(request);
    },
  );
  handleDesktopInvoke(desktopChannels.removeMcpSecrets, (event, request: McpSecretEdit) => {
    caller(event);
    return secrets.remove(request);
  });
  return secrets;
}
