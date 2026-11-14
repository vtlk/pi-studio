import type { CapabilityKind } from './studio';
export interface ResourceCheck {
  status: 'available' | 'needs_auth' | 'unavailable' | 'disabled';
  checkedAt: number;
  toolCount?: number;
}
export interface Resource {
  id: string;
  name: string;
  kind: CapabilityKind;
  source: string;
  version: string;
  description: string;
  transport: string;
  args: string;
  credential: string;
  /** Names only, including removed credentials; their values must never fall back to global env. */
  mcpSecretNames?: string[];
  contents: string;
  createdAt: number;
  localSkill?: boolean;
  managedSkill?: boolean;
  check?: ResourceCheck;
}
export interface SkillWriteRequest {
  folder: string;
  id?: string;
  name: string;
  description: string;
  content: string;
  previousContent?: string;
}
export interface SkillDocument {
  name: string;
  description: string;
  source: string;
  content: string;
}
