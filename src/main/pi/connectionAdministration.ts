import { randomUUID } from 'node:crypto';
import { t } from '../../shared/i18n/index.ts';
import type { Connection } from '../../shared/connections.ts';
import type { PiModelCatalog } from '../../shared/models.ts';
import type { StudioStore } from '../storage/StudioStore.ts';
import {
  endpointProviderId,
  parseModelEndpoint,
  modelEndpointUrl,
} from '../../shared/modelEndpoint.ts';

export async function configureConnection(
  store: StudioStore,
  name: string,
  args: Record<string, unknown>,
  models?: PiModelCatalog,
) {
  const connections = (store.bootstrap().sections.connections ?? []) as Connection[];
  if (name === 'register_model_endpoint') {
    const old =
      typeof args.id === 'string' ? connections.find((item) => item.id === args.id) : undefined;
    if (args.id && !old) throw new Error(t('error.setupAdministration.connectionMissing'));
    if (old && !['compatible', 'local'].includes(old.purpose))
      throw new Error(t('error.setupAdministration.selectAModelServerConnection'));
    if (
      typeof args.name !== 'string' ||
      !args.name.trim() ||
      !['compatible', 'local'].includes(String(args.purpose)) ||
      typeof args.endpoint !== 'string'
    )
      throw new Error(t('error.setupAdministration.specifyAServerNameType'));
    const id = old?.id ?? randomUUID();
    const connection: Connection = {
      id,
      name: args.name.trim(),
      purpose: args.purpose as 'compatible' | 'local',
      providerId: endpointProviderId(id),
      authScope: 'connection',
      endpoint: modelEndpointUrl(args.endpoint),
      endpointConfig: parseModelEndpoint(args.endpointConfig),
      account: '',
      createdAt: old?.createdAt ?? Date.now(),
    };
    await store.saveSection('connections', [
      connection,
      ...connections.filter((item) => item.id !== id),
    ]);
    return {
      connection,
      authorization: 'not_checked',
      next: 'User configures any required API key in Studio. Never request keys in chat.',
    };
  }
  if (name === 'register_connection') {
    if (
      typeof args.provider !== 'string' ||
      !models?.providers.some((provider) => provider.id === args.provider)
    )
      throw new Error(t('error.setupAdministration.theProviderIsMissingFrom'));
    if (typeof args.name !== 'string' || !args.name.trim())
      throw new Error(t('error.setupAdministration.aConnectionNameIsRequired'));
    const old =
      typeof args.id === 'string'
        ? connections.find((connection) => connection.id === args.id)
        : undefined;
    if (args.id && !old)
      throw new Error(t('error.setupAdministration.theRequestedConnectionIsMissing'));
    const connection: Connection = {
      ...(old ?? {
        id: randomUUID(),
        createdAt: Date.now(),
        endpoint: '',
        account: '',
        authScope: 'connection',
      }),
      name: args.name.trim(),
      providerId: args.provider,
      purpose: args.provider === 'openai-codex' ? 'codex' : 'pi',
    };
    await store.saveSection('connections', [
      connection,
      ...connections.filter((item) => item.id !== connection.id),
    ]);
    return { connection, authorization: 'not_checked' };
  }
  throw Error(t('SettingsRead.invalid'));
}
