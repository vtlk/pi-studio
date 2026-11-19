import type { ChatTarget } from './chat';
import type { ReferenceFile } from './attachments';
export interface ChatDraft extends ChatTarget {
  revision: number;
  text: string;
  attachments: ReferenceFile[];
}
export interface ChatDraftSave extends ChatTarget {
  folder: string;
  revision: number;
  text: string;
  attachments: string[];
}
export interface ChatDraftConsumed extends ChatTarget {
  folder: string;
  sentRevision: number;
  revision: number;
}
export interface ChatSendResult {
  draft?: { revision?: number; cleared: boolean; saveFailed?: boolean };
}
