import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { atomicJson, isMissing, readJson, safePath } from '../storage/files.ts';

export interface ImageOperation {
  id: string;
  requestId: string;
  requestHash: string;
  createdAt: number;
  connectionId: string;
  modelId: string;
  state: 'pending' | 'saved' | 'uncertain' | 'failed' | 'save_failed';
  reason?:
    'authentication' | 'quota' | 'parameters' | 'generation' | 'uncertain' | 'cancelled' | 'saving';
  path?: string;
  sha256?: string;
  usage?: Record<string, number>;
}

/** Bounded operation metadata outside projects; no prompt, key or instruction text. */
export class ImageOperations {
  private directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  private async path(scope: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return safePath(
      this.directory,
      `${createHash('sha256').update(scope).digest('hex')}.json`,
      true,
    );
  }
  async read(scope: string): Promise<ImageOperation[]> {
    try {
      const data = (await readJson(await this.path(scope))) as {
        version?: unknown;
        operations?: unknown;
      };
      if (data.version !== 1 || !Array.isArray(data.operations) || data.operations.length > 1000)
        throw new Error('Некорректные сведения об операциях изображений.');
      for (const item of data.operations)
        if (
          !item ||
          typeof item !== 'object' ||
          !/^[a-f0-9-]{36}$/.test(item.id) ||
          typeof item.requestHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(item.requestHash) ||
          typeof item.requestId !== 'string' ||
          !['pending', 'saved', 'uncertain', 'failed', 'save_failed'].includes(item.state)
        )
          throw new Error(
            'Повреждены сведения об операции изображения. Автоматического повтора нет.',
          );
      return data.operations as ImageOperation[];
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }
  async save(scope: string, operations: ImageOperation[]) {
    // Keep unresolved operations even when the recent successful window is full.
    const unresolved = operations.filter((operation) =>
      ['pending', 'uncertain', 'save_failed'].includes(operation.state),
    );
    const recent = operations.filter((operation) => !unresolved.includes(operation)).slice(-100);
    if (unresolved.length + recent.length > 1000)
      throw new Error(
        'Слишком много незавершённых операций изображений. Разберите их перед новой генерацией.',
      );
    await atomicJson(await this.path(scope), {
      version: 1,
      operations: [...unresolved, ...recent].sort((a, b) => a.createdAt - b.createdAt),
    });
  }
}
