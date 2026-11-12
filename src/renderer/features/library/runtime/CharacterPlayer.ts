import type { CharacterPreviewOptions } from '../model/characterPreview';
import type { CharacterDesign, CharacterPose, CharacterRuntime } from './characterRuntime';

/** Owns one preview clock and its SVG. No profile, filesystem or generation responsibilities. */
export class CharacterPlayer {
  private frame = 0;
  private last = 0;
  private time = 0;
  private blinkStart = -100;
  private pose: CharacterPose | null = null;
  private visible = true;
  private disposed = false;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly observer: IntersectionObserver;
  private readonly svg: SVGSVGElement;

  constructor(
    private readonly host: HTMLElement,
    private readonly runtime: CharacterRuntime,
    private readonly design: CharacterDesign,
    private options: CharacterPreviewOptions,
    prefix: string,
    title: string,
  ) {
    this.svg = runtime.rig.create(design, { prefix, title });
    host.replaceChildren(this.svg);
    this.observer = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.syncClock();
    });
    this.observer.observe(host);
    document.addEventListener('visibilitychange', this.syncClock);
    this.reduced.addEventListener('change', this.onReducedMotion);
    this.draw(1);
    this.syncClock();
  }

  setOptions(options: CharacterPreviewOptions) {
    this.options = options;
    if (!this.canPlay()) this.draw(1);
    this.syncClock();
  }

  blink() {
    this.blinkStart = this.time;
    this.draw(1);
  }

  private canPlay() {
    return !this.disposed && this.visible && !document.hidden && !this.reduced.matches;
  }

  private onReducedMotion = () => {
    if (this.reduced.matches) {
      this.time = 0;
      this.pose = null;
      this.draw(1);
    }
    this.syncClock();
  };

  private syncClock = () => {
    if (!this.canPlay()) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.last = 0;
    } else if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  };

  private tick = (timestamp: number) => {
    this.frame = 0;
    if (!this.canPlay()) {
      this.last = 0;
      return;
    }
    const dt = this.last ? Math.min(0.05, (timestamp - this.last) / 1000) : 0;
    this.last = timestamp;
    this.time += dt * this.options.speed;
    this.draw(1 - Math.exp(-dt * 15));
    this.frame = requestAnimationFrame(this.tick);
  };

  private draw(alpha: number) {
    const { rig } = this.runtime;
    const target = rig.poseAt(this.design, this.options, this.time);
    if (this.time - this.blinkStart < 0.34) {
      target.blinkL = target.blinkR = rig.blinkAt(this.time - this.blinkStart, 0);
    }
    this.pose = rig.mixPose(this.pose, target, alpha);
    this.pose.blinkL = target.blinkL;
    this.pose.blinkR = target.blinkR;
    rig.renderPose(this.svg, this.design, this.pose);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    document.removeEventListener('visibilitychange', this.syncClock);
    this.reduced.removeEventListener('change', this.onReducedMotion);
    this.host.replaceChildren();
  }
}
