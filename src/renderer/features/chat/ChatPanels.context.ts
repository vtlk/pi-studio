import { createContext, useContext } from 'react';
import type { ChatTarget } from '../../../shared/chat';
import type { ReferenceAttachment } from '@/shared/ui/ReferenceAttachments';

export interface ChatPanelsValue {
  target: ChatTarget | null;
  error: string;
  opening: boolean;
  open: (target: ChatTarget, autoContinue?: boolean) => Promise<void>;
  show: (target: ChatTarget) => void;
  hide: () => void;
  hideFor: (target: ChatTarget) => void;
  drafts: Map<string, string>;
  attachments: Map<string, ReferenceAttachment[]>;
  draftScope: string;
  setDraft: (key: string, text: string) => void;
  setAttachments: (key: string, files: ReferenceAttachment[]) => void;
}
export const ChatPanelsContext = createContext<ChatPanelsValue | null>(null);
export function useChatPanels() {
  const value = useContext(ChatPanelsContext);
  if (!value) throw new Error('ChatPanelsProvider is missing');
  return value;
}
