import { t } from '../../shared/i18n/index.ts';
import type { CuaDriverLike } from '@trycua/cua-driver';
import type { SessionTool } from '../pi/RunChannel.ts';
import { CursorGeometry, computerPayload } from './CursorGeometry.ts';
import { computerPermissionsReady } from '../../shared/computer.ts';
import { computerPermissions, ComputerPermissionCheckError } from './computerPermissions.ts';
import {
  computerActionLabel,
  computerAgentLabel,
  type ComputerFeedback,
} from './ComputerFeedback.ts';

import { computerResult, type ComputerResult } from './computerResult.ts';
export type { ComputerResult } from './computerResult.ts';

const allowed = new Set([
  'list_apps',
  'list_windows',
  'launch_app',
  'get_window_state',
  'get_desktop_state',
  'get_screen_size',
  'click',
  'drag',
  'type_text',
  'press_key',
  'hotkey',
  'set_value',
  'scroll',
  'invoke_menu',
  'check_permissions',
]);
const inputs = new Set([
  'click',
  'drag',
  'type_text',
  'press_key',
  'hotkey',
  'set_value',
  'scroll',
  'invoke_menu',
]);
const privateFields = new Set(['session', 'screenshot_out_file', 'debug_image_out']);
const launchFields = new Set(['name', 'bundle_id']);
const error = (text: string): ComputerResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

/** One in-process vendor runtime. No daemon, global input fallbacks or extra model. */
export class CuaRuntime {
  private loading?: Promise<CuaDriverLike>;
  private inventory?: Promise<SessionTool[]>;
  private readonly sessions = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly labels = new Map<string, string>();
  private readonly geometry: CursorGeometry;
  private feedback?: ComputerFeedback;
  private readonly options: {
    feedback?: ComputerFeedback;
    driver?: () => Promise<CuaDriverLike>;
    platform?: NodeJS.Platform;
  };
  constructor(
    options: {
      feedback?: ComputerFeedback;
      driver?: () => Promise<CuaDriverLike>;
      platform?: NodeJS.Platform;
    } = {},
  ) {
    this.options = options;
    this.geometry = new CursorGeometry(options.platform);
    this.feedback = options.feedback;
  }
  identify(session: string, agentName: string) {
    this.labels.set(session, computerAgentLabel(agentName));
  }
  private async present(action: (feedback: ComputerFeedback) => void | Promise<void>) {
    if (!this.feedback) return;
    try {
      await action(this.feedback);
    } catch {
      // A broken presentation surface must be removed, never change tool delivery/focus.
      this.feedback.close();
      this.feedback = undefined;
    }
  }
  private driver() {
    if (this.closed) throw new Error(t('error.cuaRuntime.computerUseIsClosed'));
    this.loading ??= (async () => {
      if (this.options.driver) return this.options.driver();
      const sdk = await import('@trycua/cua-driver');
      return sdk.CuaDriver.createConfigured(
        sdk.ConfiguredDriverOptions.new({
          claudeCodeCompatibility: false,
          authorization: sdk.RuntimeAuthorizationOptions.new({
            allowedModes: [sdk.SessionPermissionMode.Standard],
            compatibilityMode: sdk.SessionPermissionMode.Standard,
            unrestrictedAcknowledged: false,
            maxSessionTtlSeconds: 28800n,
            maxIdleTtlSeconds: 300n,
          }),
        }),
      );
    })().catch((error) => {
      this.loading = undefined;
      throw error;
    });
    return this.loading;
  }
  tools() {
    this.inventory ??= (async () => {
      const data = JSON.parse(await (await this.driver()).listToolsJson()) as
        SessionTool[] | { tools: SessionTool[] };
      const tools = Array.isArray(data) ? data : data.tools;
      return tools
        .filter((tool) => allowed.has(tool.name))
        .map((tool) => {
          const inputSchema = structuredClone(tool.inputSchema);
          const properties = inputSchema.properties as Record<string, unknown>;
          for (const key of Object.keys(properties))
            if (privateFields.has(key) || (tool.name === 'launch_app' && !launchFields.has(key)))
              delete properties[key];
          if (tool.name === 'check_permissions') {
            delete properties.prompt;
            delete properties.probe_direct_capture;
          }
          if (inputs.has(tool.name)) {
            // Keep each action on an exact window; callers cannot use a desktop/default target.
            for (const key of ['target', 'scope']) delete properties[key];
            inputSchema.required = [
              ...new Set([...((inputSchema.required as string[]) ?? []), 'pid', 'window_id']),
            ];
          }
          inputSchema.additionalProperties = false;
          inputSchema.required = ((inputSchema.required as string[]) ?? []).filter((key) =>
            Object.hasOwn(properties, key),
          );
          return {
            ...tool,
            inputSchema,
            description:
              tool.description +
              (inputs.has(tool.name)
                ? ' Studio serializes desktop actions. Default delivery is background; an unsupported background action is not retried in foreground. Inspect the fresh screenshot after every action; never blindly repeat an uncertain action.'
                : ''),
          };
        });
    })().catch((error) => {
      this.inventory = undefined;
      throw error;
    });
    return this.inventory;
  }
  async permissions() {
    const driver = await this.driver();
    const platform = this.options.platform ?? process.platform;
    try {
      const result = await driver.callTool(
        'check_permissions',
        JSON.stringify(
          platform === 'darwin'
            ? { prompt: false, probe_direct_capture: false }
            : { prompt: false },
        ),
      );
      if (result.isError) throw Error();
      return computerPermissions(result.structuredJson, platform);
    } catch {
      throw new ComputerPermissionCheckError(t('error.cuaRuntime.couldNotCheckComputerUse'));
    }
  }
  call(session: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const task = this.tail.then(async () => {
      signal.throwIfAborted();
      const tool = (await this.tools()).find((tool) => tool.name === name);
      if (!tool) return error(t('error.cuaRuntime.toolUnavailable'));
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      if (Object.keys(args).some((key) => !Object.hasOwn(properties, key)))
        return error(t('error.cuaRuntime.invalidParameter'));
      if (name === 'check_permissions')
        return {
          content: [{ type: 'text', text: JSON.stringify(await this.permissions()) }],
        } as ComputerResult;
      const permissions = await this.permissions();
      if (!computerPermissionsReady(permissions)) {
        this.feedback?.release(session);
        return error(
          (this.options.platform ?? process.platform) === 'win32'
            ? t('error.cuaRuntime.windowsAccessNotConfirmed')
            : t('error.cuaRuntime.macosAccessRequired'),
        );
      }
      const driver = await this.driver();
      // Native sessions expire while Pi waits for user input. Revive only our own private label.
      const sdk = await import('@trycua/cua-driver');
      await driver.startSession(sdk.StartSessionInput.new({ session }), { signal });
      this.sessions.add(session);
      if (this.feedback && (this.options.platform ?? process.platform) === 'win32') {
        // Suppress only this private SDK cursor: it uses a random session colour.
        // Studio supplies the common yellow pointer without moving the hardware cursor.
        await driver.callTool(
          'set_agent_cursor_enabled',
          JSON.stringify({ session, enabled: false }),
          { signal },
        );
      }
      signal.throwIfAborted();
      const clearFeedback = () => this.feedback?.release(session);
      signal.addEventListener('abort', clearFeedback, { once: true });
      let completed = false;
      try {
        await this.present((feedback) =>
          feedback.begin(
            session,
            this.labels.get(session) ?? t('computerOverlay.agent'),
            computerActionLabel(name),
            name,
          ),
        );
        signal.throwIfAborted();
        // Our windows must not enter native capture, visibility/occlusion checks or app discovery.
        await this.present((feedback) => feedback.suspend());
        let point: import('../../shared/computerFeedback.ts').ComputerPoint | undefined;
        let endPoint: typeof point;
        if (
          inputs.has(name) &&
          this.feedback &&
          typeof args.pid === 'number' &&
          typeof args.window_id === 'number'
        ) {
          const listed = await driver
            .callTool('list_windows', JSON.stringify({ pid: args.pid, session }), { signal })
            .catch(() => undefined);
          const windows = computerPayload(listed?.structuredJson)?.windows;
          const window = Array.isArray(windows)
            ? windows.find((item) => item?.pid === args.pid && item?.window_id === args.window_id)
            : undefined;
          point = this.geometry.point(session, args, window);
          endPoint = name === 'drag' ? this.geometry.point(session, args, window, true) : point;
          await this.present((feedback) => feedback.pointer(session, point));
        }
        signal.throwIfAborted();
        // Ask for structured frames in the SAME snapshot: an extra AX read would stale tokens.
        const enrichedTree =
          this.feedback &&
          name === 'get_window_state' &&
          args.include_accessibility_tree !== false &&
          args.tree_format !== 'elements' &&
          args.tree_format !== 'both' &&
          !args.full_output;
        const result = await driver.callTool(
          name,
          JSON.stringify({
            ...args,
            ...(enrichedTree ? { tree_format: 'both' } : {}),
            ...(inputs.has(name) && 'delivery_mode' in properties
              ? { delivery_mode: args.delivery_mode ?? 'background' }
              : {}),
            session,
          }),
          { signal },
        );
        if (name === 'get_window_state')
          this.geometry.observe(session, computerPayload(result.structuredJson));
        const response = computerResult(result);
        if (
          inputs.has(name) &&
          !signal.aborted &&
          typeof args.pid === 'number' &&
          typeof args.window_id === 'number'
        ) {
          const observed = await driver
            .callTool(
              'get_window_state',
              JSON.stringify({
                pid: args.pid,
                window_id: args.window_id,
                session,
                include_screenshot: true,
                include_accessibility_tree: false,
                max_image_dimension: 1280,
              }),
              { signal },
            )
            .catch(() => undefined);
          if (observed && !observed.isError)
            response.content.push(...computerResult(observed).content);
          else
            response.content.push({
              type: 'text',
              text: t('error.cuaRuntime.freshScreenshotUnavailable'),
            });
          this.geometry.observe(session, computerPayload(observed?.structuredJson));
        }
        if (!signal.aborted && !this.closed) {
          const payload = computerPayload(result.structuredJson);
          const accepted =
            !result.isError && payload?.effect !== 'refused' && !payload?.refusal && !payload?.code;
          if (inputs.has(name))
            await this.present((feedback) =>
              feedback.pointer(
                session,
                accepted ? endPoint : undefined,
                accepted && name === 'click' && !!endPoint,
              ),
            );
        }
        completed = true;
        return response;
      } finally {
        signal.removeEventListener('abort', clearFeedback);
        if (!completed || signal.aborted || this.closed) clearFeedback();
        else {
          await this.present((feedback) => feedback.resume());
          this.feedback?.finish(session);
        }
      }
    });
    this.tail = task.catch(() => {});
    return task;
  }
  release(session: string) {
    this.labels.delete(session);
    this.geometry.release(session);
    this.feedback?.release(session);
    const task = this.tail.then(async () => {
      if (!this.sessions.delete(session) || !this.loading) return;
      const sdk = await import('@trycua/cua-driver');
      await (await this.loading).endSession(sdk.EndSessionInput.new({ session }));
    });
    this.tail = task.catch(() => {});
    return task;
  }
  async close() {
    this.closed = true;
    this.feedback?.close();
    this.labels.clear();
    await this.tail;
    if (this.loading) {
      const driver = await this.loading.catch(() => undefined);
      if (driver) {
        await driver.shutdown();
        if ('uniffiDestroy' in driver && typeof driver.uniffiDestroy === 'function')
          driver.uniffiDestroy();
      }
    }
    this.sessions.clear();
  }
}
