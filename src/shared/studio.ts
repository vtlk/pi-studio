export interface Asset {
  id: string;
  title: string;
  description?: string;
  category?: string;
  image: string;
  reference?: string;
  vector?: string;
  type: string;
  actions?: string[];
  emotions?: string[];
  library?: { kind: 'characters' | 'locations'; version: number; animated: boolean };
}
export interface Instruction {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
}
export type CapabilityKind = 'skills' | 'mcps' | 'plugins';
export interface CapabilitySettings {
  enabled: boolean;
}
export interface Agent {
  id: string;
  name: string;
  enabled: boolean;
  instructions: Instruction[];
  skills: string[];
  mcps: string[];
  plugins: string[];
  capabilitySettings?: Record<string, CapabilitySettings>;
  mainInstruction?: string;
  requiresSceneApproval?: boolean;
  model?: {
    connectionId?: string;
    provider: string;
    id: string;
    reasoning: string;
    temperature: string;
  };
}
