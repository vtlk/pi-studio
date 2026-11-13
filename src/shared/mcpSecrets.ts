export interface McpSecretRequest {
  folder: string;
  resourceId: string;
}
export interface McpSecretStatus {
  revision: string;
  destination: string;
  secureStorageAvailable: boolean;
  managed: boolean;
  hasSavedValues: boolean;
  configurationChanged: boolean;
  unreadable: boolean;
  fields: { name: string; stored: boolean }[];
}
export interface McpSecretEdit extends McpSecretRequest {
  revision: string;
}
