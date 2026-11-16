import type { ComputerPoint } from '../../shared/computerFeedback.ts';

type ObjectValue = Record<string, unknown>;
interface Bounds extends ComputerPoint {
  width: number;
  height: number;
}
interface Snapshot {
  bounds: Bounds;
  width: number;
  height: number;
  snapshotId?: string;
  captureId?: string;
  elements: Map<string, ComputerPoint>;
}
const object = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
function bounds(value: unknown): Bounds | undefined {
  const data = object(value);
  return data &&
    number(data.x) &&
    number(data.y) &&
    number(data.width) &&
    number(data.height) &&
    data.width > 0 &&
    data.height > 0
    ? { x: data.x, y: data.y, width: data.width, height: data.height }
    : undefined;
}
export function computerPayload(json?: string): ObjectValue | undefined {
  try {
    return json ? object(JSON.parse(json)) : undefined;
  } catch {
    return undefined;
  }
}

/** Only the calling session's exact window capture can ground a visual cursor. */
export class CursorGeometry {
  private readonly snapshots = new Map<string, Snapshot>();
  private key(session: string, pid: unknown, window: unknown) {
    return `${session}:${pid}:${window}`;
  }
  observe(session: string, data?: ObjectValue) {
    if (!data || !number(data.pid) || !number(data.window_id) || data.display_only === true) return;
    const key = this.key(session, data.pid, data.window_id);
    const old = this.snapshots.get(key);
    const frame = bounds(data.window_bounds);
    const valid =
      data.screenshot_frame_valid === true &&
      frame &&
      number(data.screenshot_width) &&
      data.screenshot_width > 0 &&
      number(data.screenshot_height) &&
      data.screenshot_height > 0;
    // A tree-only/error read must not keep an old pixel transform alive.
    if (!valid) {
      this.snapshots.delete(key);
      return;
    }
    const snapshotId = typeof data.snapshot_id === 'string' ? data.snapshot_id : undefined;
    const elements =
      old && old.snapshotId === snapshotId && snapshotId
        ? old.elements
        : new Map<string, ComputerPoint>();
    if (Array.isArray(data.elements)) {
      elements.clear();
      for (const item of data.elements) {
        const element = object(item),
          rect = object(element?.frame);
        if (
          !element ||
          typeof element.element_token !== 'string' ||
          !rect ||
          !number(rect.x) ||
          !number(rect.y) ||
          !number(rect.w) ||
          !number(rect.h) ||
          rect.w <= 0 ||
          rect.h <= 0
        )
          continue;
        // Cua emits element frames in the delivered window screenshot's pixels.
        elements.set(element.element_token, {
          // Fractions survive screenshot-only rereads at a different max_image_dimension.
          x: (rect.x + rect.w / 2) / (data.screenshot_width as number),
          y: (rect.y + rect.h / 2) / (data.screenshot_height as number),
        });
      }
    }
    this.snapshots.delete(key);
    this.snapshots.set(key, {
      bounds: frame,
      width: data.screenshot_width as number,
      height: data.screenshot_height as number,
      snapshotId,
      captureId: typeof data.capture_id === 'string' ? data.capture_id : undefined,
      elements,
    });
    // Long sessions must not retain an unbounded catalogue of observed windows.
    if (this.snapshots.size > 64) this.snapshots.delete(this.snapshots.keys().next().value!);
  }
  point(
    session: string,
    args: ObjectValue,
    liveWindow: unknown,
    end = false,
  ): ComputerPoint | undefined {
    const live = object(liveWindow),
      current = bounds(live?.bounds);
    const saved = this.snapshots.get(this.key(session, args.pid, args.window_id));
    if (
      !saved ||
      !live ||
      live.pid !== args.pid ||
      live.window_id !== args.window_id ||
      live.is_on_screen !== true ||
      live.minimized === true ||
      live.on_current_space === false ||
      !current ||
      args.from_zoom === true ||
      current.width !== saved.bounds.width ||
      current.height !== saved.bounds.height ||
      (args.capture_id !== undefined && args.capture_id !== saved.captureId)
    )
      return;
    let point: ComputerPoint | undefined;
    if (typeof args.element_token === 'string') {
      const normalized = saved.elements.get(args.element_token);
      if (normalized) point = { x: normalized.x * saved.width, y: normalized.y * saved.height };
    } else {
      const x = args[end ? 'to_x' : 'x'] ?? args.from_x;
      const y = args[end ? 'to_y' : 'y'] ?? args.from_y;
      if (number(x) && number(y)) point = { x, y };
    }
    if (!point || point.x < 0 || point.y < 0 || point.x >= saved.width || point.y >= saved.height)
      return;
    return {
      x: current.x + (point.x * current.width) / saved.width,
      y: current.y + (point.y * current.height) / saved.height,
    };
  }
  release(session: string) {
    for (const key of this.snapshots.keys())
      if (key.startsWith(session + ':')) this.snapshots.delete(key);
  }
}
