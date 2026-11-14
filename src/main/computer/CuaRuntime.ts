import type { CuaDriverLike, ToolResult } from '@trycua/cua-driver';
import type { SessionTool } from '../pi/RunChannel.ts';

export interface ComputerResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string })[];
  isError?: boolean;
}
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
  private driver() {
    if (this.closed) throw new Error('Computer Use закрыт.');
    this.loading ??= (async () => {
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
    })();
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
    })();
    return this.inventory;
  }
  async permissions() {
    const result = await (
      await this.driver()
    ).callTool('check_permissions', JSON.stringify({ prompt: false, probe_direct_capture: false }));
    if (result.isError || !result.structuredJson)
      throw new Error('Не удалось проверить разрешения Computer Use.');
    const state = JSON.parse(result.structuredJson) as {
      accessibility?: boolean;
      screen_recording?: boolean;
    };
    return {
      accessibility: state.accessibility === true,
      screenRecording: state.screen_recording === true,
    };
  }
  call(session: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const task = this.tail.then(async () => {
      signal.throwIfAborted();
      const tool = (await this.tools()).find((tool) => tool.name === name);
      if (!tool) return error('Этот инструмент Computer Use недоступен.');
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      if (Object.keys(args).some((key) => !Object.hasOwn(properties, key)))
        return error('Computer Use: неизвестный или закрытый параметр.');
      if (name === 'check_permissions')
        return {
          content: [{ type: 'text', text: JSON.stringify(await this.permissions()) }],
        } as ComputerResult;
      const permissions = await this.permissions();
      if (!permissions.accessibility || !permissions.screenRecording)
        return error(
          'Разрешите Pi Studio управление компьютером и запись экрана в настройках macOS. Изменение разрешений выполняется пользователем в Studio; затем перезапустите приложение.',
        );
      const driver = await this.driver();
      // Native sessions expire while Pi waits for user input. Revive only our own private label.
      const sdk = await import('@trycua/cua-driver');
      await driver.startSession(sdk.StartSessionInput.new({ session }), { signal });
      this.sessions.add(session);
      signal.throwIfAborted();
      const result = await driver.callTool(
        name,
        JSON.stringify({
          ...args,
          ...(inputs.has(name) && 'delivery_mode' in properties
            ? { delivery_mode: args.delivery_mode ?? 'background' }
            : {}),
          session,
        }),
        { signal },
      );
      const response = this.result(result);
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
        if (observed && !observed.isError) response.content.push(...this.result(observed).content);
        else
          response.content.push({
            type: 'text',
            text: 'Свежий снимок после действия недоступен. Исход не подтверждён; автоматического повтора нет.',
          });
      }
      return response;
    });
    this.tail = task.catch(() => {});
    return task;
  }
  private result(result: ToolResult): ComputerResult {
    return {
      ...(result.isError ? { isError: true } : {}),
      content: [
        { type: 'text', text: result.text || result.structuredJson || result.rawJson },
        ...result.images.map((image) => ({
          type: 'image' as const,
          mimeType: image.mimeType,
          data: image.dataBase64,
        })),
      ],
    };
  }
  release(session: string) {
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
