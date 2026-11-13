export interface Connection {
  id: string;
  name: string;
  purpose: 'codex' | 'images' | 'pi' | 'compatible' | 'local';
  providerId: string;
  endpoint: string;
  account: string;
  createdAt: number;
}

export interface ImageConnectionStatus {
  keyStored: boolean;
  secureStorageAvailable: boolean;
  authentication: 'unchecked' | 'ready' | 'invalid';
  modelIds: string[];
  checkedAt?: number;
}

export interface ImageConnectionRequest {
  folder: string;
  connectionId: string;
}
