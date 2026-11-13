import type { ModelEndpoint } from './modelEndpoint';
export interface Connection {
  id: string;
  name: string;
  purpose: 'codex' | 'images' | 'pi' | 'compatible' | 'local';
  providerId: string;
  endpoint: string;
  account: string;
  createdAt: number;
  authScope?: 'native' | 'connection';
  endpointConfig?: ModelEndpoint;
}

export interface ImageConnectionStatus {
  keyStored: boolean;
  secureStorageAvailable: boolean;
  authentication: 'unchecked' | 'ready' | 'invalid' | 'restricted';
  modelIds: string[];
  checkedAt?: number;
}

export interface ImageConnectionRequest {
  folder: string;
  connectionId: string;
}

export interface ModelConnectionRequest {
  folder: string;
  connectionId: string;
}
export interface ModelConnectionStatus {
  connectionId: string;
  provider: string;
  status: 'ready' | 'not_ready' | 'invalid';
}
export interface ModelLoginRequest extends ModelConnectionRequest {
  method: 'oauth' | 'api_key';
}
