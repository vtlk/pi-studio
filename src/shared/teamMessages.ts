export interface TeamMessageInfo {
  id: string;
  senderId: string;
  recipientId: string;
  createdAt: number;
  state: 'queued' | 'dispatching' | 'received' | 'completed' | 'failed' | 'uncertain' | 'cancelled';
  reason?: string;
  preview?: string;
  requiresExplicitResume: boolean;
}
export interface TeamMessageAction {
  projectId: string;
  messageId: string;
  action: 'resume' | 'cancel';
}
