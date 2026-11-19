import { createContext, useContext } from 'react';
import type { ChatDraft, ChatSendResult } from '../../../shared/chatDrafts';
import type { ChatTarget } from '../../../shared/chat';
import type { ReferenceAttachment } from '@/shared/ui/ReferenceAttachments';

export interface ChatPanelsValue {
  target: ChatTarget | null;
  error: string;
  opening: boolean;
  open: (target: ChatTarget, autoContinue?: boolean) => Promise<void>;
  show: (target: ChatTarget) => void;
  showRunning: (target: ChatTarget) => () => void;
  hide: () => void;
  hideFor: (target: ChatTarget) => void;
  drafts: Map<string, string>;
  attachments: Map<string, ReferenceAttachment[]>;
  draftScope: string;
  draftsReady: boolean;
  flushDrafts: (key?: string) => Promise<boolean>;
  currentDraft: (key: string) => ChatDraft;
  draftSent: (key: string, revision: number, result: ChatSendResult | void) => boolean;
  setDraft: (key: string, text: string) => void;
  setAttachments: (key: string, files: ReferenceAttachment[]) => void;
}
export const ChatPanelsContext = createContext<ChatPanelsValue | null>(null);
export function useChatPanels() {
  const value = useContext(ChatPanelsContext);
  if (!value) throw new Error('ChatPanelsProvider is missing');
  return value;
}
