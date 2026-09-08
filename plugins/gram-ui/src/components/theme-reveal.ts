export const THEME_REVEAL_HOLE_R_PX = 26;
export const THEME_REVEAL_FEATHER_R_PX = 30;

export const THEME_TOGGLE_SELECTOR = '.tgui-theme-toggle, .login-theme-toggle';

export function themeRevealHoleMask(cx: number, cy: number): string {
  return `radial-gradient(circle ${THEME_REVEAL_FEATHER_R_PX}px at ${cx}px ${cy}px, transparent ${THEME_REVEAL_HOLE_R_PX}px, black ${THEME_REVEAL_FEATHER_R_PX}px)`;
}

export function themeRevealOverlayCss(cx: number, cy: number, bg: string): string {
  const mask = themeRevealHoleMask(cx, cy);
  return [
    'position:fixed',
    'inset:0',
    'z-index:99999',
    'pointer-events:none',
    `background:${bg}`,
    `clip-path:circle(150% at ${cx}px ${cy}px)`,
    'transition:clip-path .35s cubic-bezier(0.4,0.0,0.2,1)',
    'will-change:clip-path',
    `mask-image:${mask}`,
    `-webkit-mask-image:${mask}`,
  ].join(';');
}

export const VT_NO_DEFAULT_CLASS = 'tgui-no-vt-default';

export const VT_OLD_ON_TOP_CLASS = 'tgui-vt-old-top';

export const VT_DARK_CLASS = 'tgui-vt-dark';

export const VT_LIGHT_CLASS = 'tgui-vt-light';

export const VT_REVEAL_DURATION_MS = 500;
export const VT_REVEAL_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

export interface RevealPoint { x: number; y: number; }

export function supportsViewTransitions(): boolean {
  try {
    return typeof document !== 'undefined'
      && typeof (document as any).startViewTransition === 'function';
  } catch {
    return false;
  }
}

export function revealRadius(x: number, y: number, w: number, h: number): number {
  return Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
}

export interface RevealHandle {
  finished: Promise<void>;
  cancel(): void;
}

interface VtTransition {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition?: () => void;
}

export function viewTransitionReveal(opts: {
  point: RevealPoint;
  goingDark: boolean;
  apply: () => void;
  durationMs?: number;
}): RevealHandle | null {
  const doc = typeof document !== 'undefined' ? document : null;
  const starter = (doc as any)?.startViewTransition?.bind(doc);
  if (typeof starter !== 'function' || !doc) return null;

  const durationMs = opts.durationMs ?? VT_REVEAL_DURATION_MS;
  const root = doc.documentElement;
  const { x, y } = opts.point;
  const r = Math.ceil(revealRadius(x, y, window.innerWidth, window.innerHeight));

  root.style.setProperty('--vt-x', `${x}px`);
  root.style.setProperty('--vt-y', `${y}px`);
  root.style.setProperty('--vt-r', `${r}px`);
  root.style.setProperty('--vt-duration', `${durationMs}ms`);

  root.classList.add(VT_NO_DEFAULT_CLASS);
  root.classList.add(opts.goingDark ? VT_DARK_CLASS : VT_LIGHT_CLASS);
  if (!opts.goingDark) root.classList.add(VT_OLD_ON_TOP_CLASS);

  let transition: VtTransition;
  try {
    transition = starter(() => { opts.apply(); });
  } catch {
    cleanupReveal(root);
    return null;
  }

  let safetyTimer: number | undefined;
  const finished = transition.finished.then(cleanup, cleanup);

  safetyTimer = Number(setTimeout(() => {
    try { transition.skipTransition?.(); } catch {  }
  }, durationMs + 1500));

  function cleanup() {
    if (safetyTimer !== undefined) { clearTimeout(safetyTimer); safetyTimer = undefined; }
    cleanupReveal(root);
  }

  return {
    finished,
    cancel() {
      try { transition.skipTransition?.(); } catch {  }
    },
  };
}

function cleanupReveal(root: HTMLElement): void {
  root.classList.remove(VT_NO_DEFAULT_CLASS, VT_OLD_ON_TOP_CLASS, VT_DARK_CLASS, VT_LIGHT_CLASS);
  root.style.removeProperty('--vt-x');
  root.style.removeProperty('--vt-y');
  root.style.removeProperty('--vt-r');
  root.style.removeProperty('--vt-duration');
}
