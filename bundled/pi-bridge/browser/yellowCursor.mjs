/** Fixed inert page overlay. MousePointer2 geometry from lucide-react 0.577.0 (ISC). */
export function yellowCursorScript(point, press = false, enabled = true) {
  return `(${installYellowCursor.toString()})(${JSON.stringify(point ?? null)},${press === true},${enabled === true})`;
}
function installYellowCursor(point, press, enabled) {
  const key = '__piStudioBrowserCursor';
  if (!enabled) {
    globalThis[key]?.host.remove();
    delete globalThis[key];
    return true;
  }
  if (!document.documentElement) return false;
  let state = globalThis[key];
  if (!state?.host.isConnected) {
    const host = document.createElement('pi-studio-browser-cursor');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('inert', '');
    host.style.cssText =
      'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;contain:layout style!important';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host,*{pointer-events:none!important}.pointer{position:fixed;display:none;width:29px;height:29px;transform:translate(-4px,-3px);filter:drop-shadow(0 1px 2px #0008)}
      .ring{position:fixed;width:36px;height:36px;margin:-18px;border:2px solid #f2cc43;border-radius:50%;box-sizing:border-box;box-shadow:0 0 12px #f2cc4380;animation:pulse 650ms ease-out forwards}
      @keyframes pulse{from{transform:scale(.35);opacity:1}to{transform:scale(1.8);opacity:0}}
      @media(prefers-reduced-motion:reduce){.ring{animation:fade 650ms linear forwards}}@keyframes fade{to{opacity:0}}
    </style><svg class="pointer" viewBox="0 0 24 24" fill="#f2cc43" stroke="#302b1c" stroke-width="1.6" stroke-linejoin="round"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/></svg>`;
    document.documentElement.append(host);
    state = globalThis[key] = { host, shadow, pointer: shadow.querySelector('.pointer') };
  }
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    Object.assign(state.pointer.style, {
      display: 'block',
      left: point.x + 'px',
      top: point.y + 'px',
    });
    if (press) {
      const ring = document.createElement('div');
      ring.className = 'ring';
      Object.assign(ring.style, { left: point.x + 'px', top: point.y + 'px' });
      state.shadow.prepend(ring);
      setTimeout(() => ring.remove(), 700);
    }
  }
  return true;
}
