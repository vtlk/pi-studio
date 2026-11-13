import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { checkPi } from './checkPi.ts';
import { resolvePiSdk } from './BrowserAuth.ts';
import type { PiModelCatalog } from '../../shared/models.ts';

export async function readPiCatalog(path: string, script: string): Promise<PiModelCatalog> {
  const pi = await checkPi(path);
  if (!pi.supported) throw new Error('Для каталога моделей требуется поддерживаемый Pi 1.5.2.');
  const sdk = await resolvePiSdk(await realpath(pi.path));
  let output: string;
  try {
    output = (
      await promisify(execFile)(join(dirname(pi.path), 'node'), [script, sdk], {
        timeout: 20_000,
        maxBuffer: 2_000_000,
        env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
      })
    ).stdout;
  } catch {
    throw new Error('Не удалось прочитать каталог моделей установленного Pi. Проверьте установку.');
  }
  const data = JSON.parse(output) as PiModelCatalog;
  if (!Array.isArray(data.providers) || !Array.isArray(data.models))
    throw new Error('Pi вернул несовместимый каталог моделей.');
  return data;
}
