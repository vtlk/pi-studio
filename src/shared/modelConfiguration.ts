import type { Agent } from './studio.ts';

export function hasModelConfiguration(
  model: Agent['model'],
): model is NonNullable<Agent['model']> & { connectionId: string } {
  return !!(
    model?.connectionId?.trim() &&
    model.provider?.trim() &&
    model.id?.trim() &&
    model.reasoning?.trim()
  );
}
