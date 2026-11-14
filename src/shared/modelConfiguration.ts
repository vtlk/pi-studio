import type { Agent } from './studio.ts';
import type { Connection } from './connections.ts';

export type AgentModel = NonNullable<Agent['model']> & { connectionId: string };

export function hasModelConfiguration(model: Agent['model']): model is AgentModel {
  return !!(
    model?.connectionId?.trim() &&
    model.provider?.trim() &&
    model.id?.trim() &&
    model.reasoning?.trim()
  );
}

/** Pure selection check shared by the renderer guard and all main launch adapters. */
export function validateAgentModel(model: Agent['model'], connections: readonly Connection[]) {
  if (!hasModelConfiguration(model)) return { ok: false, reason: 'missing-model' } as const;
  const connection = connections.find((item) => item.id === model.connectionId);
  if (!connection) return { ok: false, reason: 'missing-connection' } as const;
  if (connection.purpose === 'images') return { ok: false, reason: 'images-connection' } as const;
  if (connection.providerId !== model.provider)
    return { ok: false, reason: 'provider-mismatch' } as const;
  return { ok: true, model, connection } as const;
}
