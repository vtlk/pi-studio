/** Data-only view of a Pi SDK session. Credentials and runtime configuration stay in main. */
export interface ChatTarget {
  projectId: string;
  agentId: string;
}
export interface ChatPart {
  type: 'text' | 'thinking' | 'toolCall' | 'image';
  text?: string;
  id?: string;
  name?: string;
  arguments?: string;
  src?: string;
}
export interface ChatMessage {
  id: string;
  role: string;
  parts: ChatPart[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  error?: string;
  command?: string;
}
export interface ChatDialog {
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor';
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  expiresAt?: number;
}
export interface ChatState extends ChatTarget {
  runId: string;
  phase: 'opening' | 'ready' | 'closed' | 'error';
  working: boolean;
  revision: number;
  messages: ChatMessage[];
  dialog?: ChatDialog;
  notification?: string;
  editorText?: { id: string; text: string };
  error?: string;
  historyTruncated?: boolean;
  model: string;
  thinkingLevel: string;
}
export interface ChatSend extends ChatTarget {
  text: string;
  attachments?: string[];
  behavior?: 'steer' | 'followUp';
}
export interface ChatAnswer extends ChatTarget {
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}
export interface PiProcessInfo extends ChatTarget {
  runId: string;
  pid: number;
  agentName: string;
  working: boolean;
  embedded: boolean;
}
