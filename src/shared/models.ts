export interface PiModelSummary {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  imageInput: boolean;
  api?: string;
}
export interface PiProviderSummary {
  id: string;
  name: string;
  configured: boolean;
  subscription: boolean;
}
export interface PiModelCatalog {
  providers: PiProviderSummary[];
  models: PiModelSummary[];
  nativeDefault?: { provider: string; id: string };
}
