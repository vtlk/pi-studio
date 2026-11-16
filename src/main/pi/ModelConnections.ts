import { t } from '../../shared/i18n/index.ts';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { StudioService } from '../storage/StudioStore.ts';
import type {
  Connection,
  ModelConnectionRequest,
  ModelConnectionStatus,
  ModelLoginRequest,
} from '../../shared/connections.ts';
import { stableId } from '../storage/validation.ts';
import type { BrowserAuth } from './BrowserAuth.ts';
import { connectionAuthScope, modelAuthOperation } from './modelAuth.ts';
import { readPiCatalog } from './catalog.ts';
import { openClaudeCodeAction, type ClaudeCodeAction } from './claudeCode.ts';

export class ModelConnections {
  private service: StudioService;
  private directory: string;
  private scripts: string;
  private piPath: () => string;
  private browserAuth: BrowserAuth;
  constructor(
    service: StudioService,
    directory: string,
    scripts: string,
    piPath: () => string,
    browserAuth: BrowserAuth,
  ) {
    this.service = service;
    this.directory = directory;
    this.scripts = scripts;
    this.piPath = piPath;
    this.browserAuth = browserAuth;
  }
  private async descriptor(request: ModelConnectionRequest) {
    if (!request || typeof request.folder !== 'string')
      throw new Error(t('error.modelConnections.selectAStudioFolder'));
    stableId(request.connectionId);
    return this.service.serialize(async () => {
      const store = await this.service.load();
      if ((await realpath(request.folder)) !== store.folder)
        throw new Error(t('registerTeamHandlers.studioFolderChanged'));
      const sections = store.bootstrap().sections;
      const connection = (sections.connections as Connection[]).find(
        (item) => item.id === request.connectionId,
      );
      if (!connection || connection.purpose === 'images')
        throw new Error(t('error.modelConnections.modelConnectionMissing'));
      const path = String(sections.piPath ?? '') || this.piPath();
      return {
        cwd: store.folder,
        connection,
        path,
        scope: await connectionAuthScope(this.directory, store.folder, connection),
        signature: JSON.stringify([connection, path, store.folder]),
      };
    });
  }
  async status(request: ModelConnectionRequest): Promise<ModelConnectionStatus> {
    const saved = await this.descriptor(request);
    const status = await modelAuthOperation<{
      provider: string;
      status: ModelConnectionStatus['status'];
    }>(saved.path, join(this.scripts, 'model-auth.mjs'), {
      action: 'status',
      provider: saved.connection.providerId,
      scope: saved.scope,
      cwd: saved.cwd,
    });
    if ((await this.descriptor(request)).signature !== saved.signature)
      throw new Error(t('error.modelConnections.theConnectionChangedDuringVerificati'));
    if (
      status.provider !== saved.connection.providerId ||
      !['ready', 'not_ready', 'invalid'].includes(status.status)
    )
      throw new Error(t('error.modelConnections.unsupportedPiAuthenticationResponse'));
    return { ...status, connectionId: request.connectionId };
  }
  async catalog(request?: ModelConnectionRequest) {
    if (!request) {
      const saved = await this.service.serialize(async () => {
        const store = await this.service.load();
        return {
          folder: store.folder,
          path: String(store.bootstrap().sections.piPath ?? '') || this.piPath(),
        };
      });
      return readPiCatalog(saved.path, join(this.scripts, 'catalog.mjs'), saved.folder);
    }
    const saved = await this.descriptor(request);
    const catalog = await readPiCatalog(
      saved.path,
      join(this.scripts, 'catalog.mjs'),
      request.folder,
      saved.scope,
    );
    if ((await this.descriptor(request)).signature !== saved.signature)
      throw new Error(t('error.modelConnections.theConnectionChangedWhileThe'));
    return catalog;
  }
  async login(request: ModelLoginRequest) {
    if (!['oauth', 'api_key'].includes(request.method))
      throw new Error(t('error.modelConnections.selectASignInMethod'));
    const saved = await this.descriptor(request);
    if (saved.connection.providerId === 'claude-code')
      throw new Error(t('error.modelConnections.useClaudeCodeSNative'));
    return this.browserAuth.startProvider(saved.path, {
      provider: saved.connection.providerId,
      method: request.method,
      scope: saved.scope,
      cwd: saved.cwd,
      key: saved.signature,
      verify: async () => {
        if ((await this.descriptor(request)).signature !== saved.signature) return false;
        return (await this.status(request)).status === 'ready';
      },
    });
  }
  async discover(request: ModelConnectionRequest) {
    const saved = await this.descriptor(request);
    if (!saved.scope?.endpoint)
      throw new Error(t('error.modelConnections.selectACompatibleOrLocal'));
    let models: string[];
    try {
      models = await modelAuthOperation<string[]>(
        saved.path,
        join(this.scripts, 'model-auth.mjs'),
        { action: 'discover', scope: saved.scope, cwd: saved.cwd },
      );
    } catch {
      throw new Error(t('error.modelConnections.theServerDidNotReturn'));
    }
    if ((await this.descriptor(request)).signature !== saved.signature)
      throw new Error(t('error.modelConnections.theConnectionChangedWhileModels'));
    return models;
  }
  async logout(request: ModelConnectionRequest) {
    const saved = await this.descriptor(request);
    if (saved.connection.providerId === 'claude-code')
      throw new Error(t('error.modelConnections.sharedSignInBelongsTo'));
    await modelAuthOperation(saved.path, join(this.scripts, 'model-auth.mjs'), {
      action: 'logout',
      provider: saved.connection.providerId,
      scope: saved.scope,
      cwd: saved.cwd,
    });
  }
  async claudeCode(request: ModelConnectionRequest & { action: ClaudeCodeAction }) {
    const saved = await this.descriptor(request);
    if (saved.connection.providerId !== 'claude-code')
      throw new Error(t('error.modelConnections.selectAClaudeCodeConnection'));
    const state = await modelAuthOperation<{ command?: string; status: string; detail?: string }>(
      saved.path,
      join(this.scripts, 'model-auth.mjs'),
      { action: 'claude-status' },
    );
    if ((await this.descriptor(request)).signature !== saved.signature)
      throw new Error(t('error.modelConnections.theConnectionChangedDuringVerificati'));
    await openClaudeCodeAction(request.action, state, saved.cwd);
  }
}
