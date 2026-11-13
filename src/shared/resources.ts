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
  contents: string;
  createdAt: number;
  localSkill?: boolean;
  check?: ResourceCheck;
}
export interface SkillDocument {
  name: string;
  description: string;
  source: string;
  content: string;
}
