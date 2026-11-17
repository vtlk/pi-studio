export interface RpcData {
  messages?: unknown[];
  disposition?: string;
  isStreaming?: boolean;
}
export interface RpcEvent {
  type: string;
  id?: string;
  success?: boolean;
  data?: RpcData;
  error?: string;
  message?: unknown;
  assistantMessageEvent?: {
    type: string;
    contentIndex?: number;
    id?: string;
    toolName?: string;
    delta?: string;
  };
  method?: string;
  title?: string;
  placeholder?: string;
  prefill?: string;
  options?: unknown[];
  timeout?: number;
  statusText?: string;
  text?: string;
}
