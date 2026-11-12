export interface AuthLoginState {
  id: string;
  phase: 'opening' | 'waiting' | 'verifying' | 'ready' | 'error' | 'cancelled';
  message: string;
  prompt?: { id: string; secret: boolean };
}
