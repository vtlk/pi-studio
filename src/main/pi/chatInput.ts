import { readFile } from 'node:fs/promises';
import type { SavedAttachment } from '../../shared/attachments.ts';
import { safePath } from '../storage/files.ts';

export async function chatInput(root: string, text: string, attachments: SavedAttachment[] = []) {
  const images = [];
  for (const attachment of attachments) {
    if (!attachment.image) continue;
    const path = await safePath(root, attachment.image.path);
    images.push({
      type: 'image',
      mimeType: attachment.image.mimeType,
      data: (await readFile(path)).toString('base64'),
    });
  }
  return {
    message:
      text +
      (attachments.length
        ? `\n\nInput files (paths relative to project directory): ${JSON.stringify(attachments)}\nUse assigned handlers for document/audio/video formats; report missing handlers explicitly. Never execute an attachment automatically.`
        : ''),
    images,
  };
}
