import { i18n } from '../../shared/i18n/index.ts';
import { BrowserWindow, screen, type Display } from 'electron';
import { join } from 'node:path';
import type { ComputerFeedback } from './ComputerFeedback.ts';
import { computerAgentLabel } from './ComputerFeedback.ts';
import {
  computerFeedbackEvent,
  type ComputerFeedbackState,
  type ComputerPoint,
} from '../../shared/computerFeedback.ts';

interface Surface {
  window: BrowserWindow;
  ready: Promise<void>;
  display: Display;
}

/** Inert, unprivileged presentation windows. Never move the user's hardware pointer. */
export class ComputerOverlay implements ComputerFeedback {
  private readonly surfaces = new Map<number, Surface>();
  private active?: { session: string; state: Omit<ComputerFeedbackState, 'badgeTop'> };
  private suspended = false;
  private closed = false;
  private idle?: ReturnType<typeof setTimeout>;
  private listening = false;
  private readonly displaysChanged = () => {
    // Drop obsolete display geometry immediately; rebuild lazily at the next call.
    this.destroySurfaces();
  };

  private readonly languageChanged = () => {
    void this.paint().catch(() => {});
  };

  async begin(session: string, agentName: string, action: string, actionName?: string) {
    if (this.closed) return;
    clearTimeout(this.idle);
    this.suspended = false;
    this.active = {
      session,
      state: { agentName: computerAgentLabel(agentName), action, actionName, click: 0 },
    };
    if (!this.listening) {
      this.listening = true;
      i18n.on('languageChanged', this.languageChanged);
      screen.on('display-added', this.displaysChanged);
      screen.on('display-removed', this.displaysChanged);
      screen.on('display-metrics-changed', this.displaysChanged);
    }
    for (const display of screen.getAllDisplays()) {
      if (!this.surfaces.has(display.id)) this.create(display);
    }
    await this.paint();
  }

  private create(display: Display) {
    const window = new BrowserWindow({
      ...display.bounds,
      title: 'Pi Studio · Computer Use',
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        // No shared cookies/storage/permissions or desktop preload bridge.
        partition: 'computer-feedback',
        devTools: false,
      },
    });
    window.setIgnoreMouseEvents(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin')
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    const ready = process.env.ELECTRON_RENDERER_URL
      ? window.loadURL(
          new URL('computer-overlay.html', process.env.ELECTRON_RENDERER_URL + '/').href,
        )
      : window.loadFile(join(__dirname, '../renderer/computer-overlay.html'));
    // Loading and painting are awaited by the tool adapter; failures never gain input authority.
    this.surfaces.set(display.id, { window, ready, display });
    window.once('closed', () => this.surfaces.delete(display.id));
  }

  private async paint() {
    const active = this.active;
    if (!active || this.suspended || this.closed) return;
    await Promise.all(
      [...this.surfaces.values()].map(async ({ window, ready, display }) => {
        await ready;
        if (window.isDestroyed() || this.active !== active || this.suspended || this.closed) return;
        const point = active.state.point;
        const inside =
          point &&
          point.x >= display.bounds.x &&
          point.y >= display.bounds.y &&
          point.x < display.bounds.x + display.bounds.width &&
          point.y < display.bounds.y + display.bounds.height;
        const state: ComputerFeedbackState = {
          ...active.state,
          language: i18n.resolvedLanguage === 'ru' ? 'ru' : 'en',
          point: inside
            ? { x: point.x - display.bounds.x, y: point.y - display.bounds.y }
            : undefined,
          badgeTop: Math.max(12, display.workArea.y - display.bounds.y + 12),
        };
        // This renderer has no preload or IPC; only this main-owned, text-only state enters it.
        await window.webContents.executeJavaScript(
          `window.dispatchEvent(new CustomEvent(${JSON.stringify(computerFeedbackEvent)}, {detail:${JSON.stringify(state)}}))`,
        );
        if (!window.isDestroyed() && this.active === active && !this.suspended && !this.closed)
          window.showInactive();
      }),
    );
  }

  async pointer(session: string, point?: ComputerPoint, click = false) {
    if (this.active?.session !== session) return;
    this.active.state.point = point;
    if (click) this.active.state.click++;
    await this.paint();
  }
  async suspend() {
    this.suspended = true;
    const visible = [...this.surfaces.values()].some(
      ({ window }) => !window.isDestroyed() && window.isVisible(),
    );
    for (const { window } of this.surfaces.values()) if (!window.isDestroyed()) window.hide();
    // Allow the OS compositor to remove the windows before a native screen/hit-test read.
    if (visible) await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  async resume() {
    this.suspended = false;
    await this.paint();
  }
  finish(session: string) {
    if (this.active?.session !== session) return;
    clearTimeout(this.idle);
    // Bridge rapid tool calls, but never claim that an idle dialogue owns the computer.
    this.idle = setTimeout(() => this.release(session), 1800);
    this.idle.unref();
  }
  release(session: string) {
    if (this.active?.session !== session) return;
    clearTimeout(this.idle);
    this.active = undefined;
    this.destroySurfaces();
  }
  private destroySurfaces() {
    for (const { window } of this.surfaces.values()) if (!window.isDestroyed()) window.destroy();
    this.surfaces.clear();
  }
  close() {
    this.closed = true;
    i18n.off('languageChanged', this.languageChanged);
    this.active = undefined;
    clearTimeout(this.idle);
    this.destroySurfaces();
    if (this.listening) {
      screen.removeListener('display-added', this.displaysChanged);
      screen.removeListener('display-removed', this.displaysChanged);
      screen.removeListener('display-metrics-changed', this.displaysChanged);
      this.listening = false;
    }
  }
}
