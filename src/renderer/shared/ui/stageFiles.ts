import type { ReferenceFile } from '../../../shared/attachments';
import { t } from '../../../shared/i18n';
export async function stageFiles(files: File[], images = false): Promise<ReferenceFile[]> {
  if (!window.studio) throw new Error(t('Chat.desktopOnly'));
  if (!files.length || files.length > 32)
    throw new Error(t('error.referenceFiles.selectNoMoreThanReferences'));
  if (!images) return window.studio.stageDroppedFiles(files);
  const staged: ReferenceFile[] = [];
  try {
    for (const file of files) {
      if (file.size > 32 * 1024 ** 2)
        throw new Error(t('error.referenceFiles.theImageExceedsMbReduce'));
      staged.push(await window.studio.stageClipboardImage({ bytes: await file.arrayBuffer() }));
    }
    return staged;
  } catch (error) {
    await window.studio.releaseReferenceFiles(staged.map((file) => file.id));
    throw error;
  }
}
