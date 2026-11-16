import { t } from '../../shared/i18n/index.ts';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { safePath } from '../storage/files.ts';

export async function validateCompletedOutputs(outputRoot: string, value: unknown) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 100 ||
    value.some((item) => typeof item !== 'string')
  )
    throw new Error(t('error.completeStage.provideOutputFilesRelativeTo'));
  if (new Set(value).size !== value.length)
    throw new Error(t('error.completeStage.outputPathsMustNotRepeat'));
  const result: { path: string; size: number; sha256: string }[] = [];
  for (const path of value as string[]) {
    const absolute = await safePath(outputRoot, path);
    const info = await stat(absolute);
    if (!info.isFile() || info.size === 0)
      throw new Error(t('error.completeStage.resultIsMissingOrEmpty', { value1: path }));
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(absolute)) hash.update(chunk);
    result.push({ path, size: info.size, sha256: hash.digest('hex') });
  }
  return result;
}
