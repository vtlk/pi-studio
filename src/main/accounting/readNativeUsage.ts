import { t } from '../../shared/i18n/index.ts';
import { piNode } from '../pi/platform.ts';
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { checkPi } from '../pi/checkPi.ts';
import { resolvePiSdk } from '../pi/BrowserAuth.ts';
import { parseUsageSample } from './usageState.ts';
import type { UsageRecord } from '../../shared/projectUsage.ts';

export async function readNativeUsage(
  piPath: string,
  script: string,
  file: string,
  cwd: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const pi = await checkPi(piPath);
  if (!pi.supported) throw new Error('Unsupported Pi usage format');
  const sdk = await resolvePiSdk(await realpath(pi.path));
  const node = await piNode(pi.path);
  signal.throwIfAborted();
  return new Promise<UsageRecord[]>((resolve, reject) => {
    const child = execFile(
      node,
      [script, sdk],
      {
        signal,
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 16 * 1024 ** 2,
        env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
      },
      (error, stdout) => {
        if (error) {
          reject(new Error(t('error.readNativeUsage.couldNotRecoverAvailablePi')));
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as { records: UsageRecord[] };
          if (!Array.isArray(parsed.records) || parsed.records.length > 100000) throw Error();
          const records: UsageRecord[] = [];
          for (let i = 0; i < parsed.records.length; i += 500)
            records.push(
              ...parseUsageSample({ records: parsed.records.slice(i, i + 500) }).records,
            );
          resolve(records);
        } catch {
          reject(new Error(t('error.readNativeUsage.invalidPiStatistics')));
        }
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify({ file, cwd }));
  });
}
