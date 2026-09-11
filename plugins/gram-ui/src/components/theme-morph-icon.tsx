import { h } from '@ton-ai/atom/jsx-runtime';
import { t, S } from '@ton-ai/gram-lang';
import { useEffect, useMemo, useRef } from '@ton-ai/atom/hooks';

export const MOON_D_ORIGINAL = 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z';
export const SUN_CENTER = { x: 12, y: 12 };
export const SUN_RADIUS = 5;
export const MORPH_VIEWBOX = '0 0 24 24';
export const MORPH_DURATION_MS = 650;

export const MORPH_BEZIER: [number, number, number, number] = [0.4, 0, 0.2, 1];

export const THEME_MORPH_ALWAYS_ANIMATE = true;

export const MORPH_SEGMENTS = 64;

export const SUN_RAYS: Array<[number, number, number, number]> = [
  [12, 1, 12, 3],
  [12, 21, 12, 23],
  [4.22, 4.22, 5.64, 5.64],
  [18.36, 18.36, 19.78, 19.78],
  [1, 12, 3, 12],
  [21, 12, 23, 12],
  [4.22, 19.78, 5.64, 18.36],
  [18.36, 5.64, 19.78, 4.22],
];

export interface Pt { x: number; y: number; }

function arcToCenterPoints(
  x1: number, y1: number, rx: number, ry: number,
  largeArc: 0 | 1, sweep: 0 | 1, x2: number, y2: number,
  samples: number,
): Pt[] {
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  let rrx = Math.abs(rx);
  let rry = Math.abs(ry);
  const lam = (dx * dx) / (rrx * rrx) + (dy * dy) / (rry * rry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rrx *= s;
    rry *= s;
  }
  const num = rrx * rrx * rry * rry - rrx * rrx * dy * dy - rry * rry * dx * dx;
  const den = rrx * rrx * dy * dy + rry * rry * dx * dx;
  let f = den <= 0 ? 0 : num / den;
  f = Math.sqrt(Math.max(0, f));
  if (largeArc === sweep) f = -f;
  const cxp = (f * rrx * dy) / rry;
  const cyp = (-f * rry * dx) / rrx;
  const cx = cxp + (x1 + x2) / 2;
  const cy = cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let a = Math.acos(Math.min(1, Math.max(-1, len === 0 ? 0 : dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const t1 = angle(1, 0, (dx - cxp) / rrx, (dy - cyp) / rry);
  let dt = angle(
    (dx - cxp) / rrx, (dy - cyp) / rry,
    (-dx - cxp) / rrx, (-dy - cyp) / rry,
  );
  if (sweep === 0 && dt > 0) dt -= Math.PI * 2;
  if (sweep === 1 && dt < 0) dt += Math.PI * 2;

  const pts: Pt[] = [];
  for (let i = 0; i <= samples; i++) {
    const a = t1 + (dt * i) / samples;
    pts.push({ x: cx + rrx * Math.cos(a), y: cy + rry * Math.sin(a) });
  }
  return pts;
}

export function sampleOriginalMoonPath(samplesPerArc = 48): Pt[] {
  const arc1 = arcToCenterPoints(21, 12.79, 9, 9, 1, 1, 11.21, 3, samplesPerArc);
  const arc2 = arcToCenterPoints(11.21, 3, 7, 7, 0, 0, 21, 12.79, samplesPerArc);

  return [...arc1.slice(0, -1), ...arc2.slice(0, -1)];
}

export function resampleClosedLoop(pts: Pt[], k: number): Pt[] {
  const n = pts.length;
  if (n === 0) return [];
  const cum: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1];
    const b = pts[i % n];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[n] || 1;
  const out: Pt[] = [];
  let j = 0;
  for (let s = 0; s < k; s++) {
    const d = (total * s) / k;
    while (j < n - 1 && cum[j + 1] < d) j++;
    const segLen = cum[j + 1] - cum[j] || 1;
    const f = (d - cum[j]) / segLen;
    const a = pts[j % n];
    const b = pts[(j + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function sampleSunDisc(k: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < k; i++) {
    const a = (2 * Math.PI * i) / k;
    pts.push({ x: SUN_CENTER.x + SUN_RADIUS * Math.cos(a), y: SUN_CENTER.y + SUN_RADIUS * Math.sin(a) });
  }
  return pts;
}

function alignStart(moon: Pt[], sun: Pt[]): Pt[] {
  const k = moon.length;
  let best = sun;
  let bestCost = Infinity;
  const candidates = [sun, [...sun].reverse()];
  for (const cand of candidates) {
    for (let shift = 0; shift < k; shift++) {
      let cost = 0;
      for (let i = 0; i < k; i++) {
        const p = cand[(i + shift) % k];
        const dx = p.x - moon[i].x;
        const dy = p.y - moon[i].y;
        cost += dx * dx + dy * dy;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = cand.map((_, i) => cand[(i + shift) % k]);
      }
    }
  }
  return best;
}

export interface MorphGeometry {
  moon: Pt[];
  sun: Pt[];
}

let geometryCache: MorphGeometry | null = null;

export function getMorphGeometry(): MorphGeometry {
  if (geometryCache) return geometryCache;
  const moon = resampleClosedLoop(sampleOriginalMoonPath(), MORPH_SEGMENTS);
  let sun = sampleSunDisc(MORPH_SEGMENTS);
  if (signedArea(moon) * signedArea(sun) < 0) sun = [...sun].reverse();
  sun = alignStart(moon, sun);
  geometryCache = { moon, sun };
  return geometryCache;
}

export function morphPointAt(geo: MorphGeometry, t: number): Pt[] {
  const c = Math.min(1, Math.max(0, t));
  return geo.moon.map((m, i) => ({
    x: m.x + (geo.sun[i].x - m.x) * c,
    y: m.y + (geo.sun[i].y - m.y) * c,
  }));
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

export function buildMorphD(geo: MorphGeometry, t: number): string {
  const pts = morphPointAt(geo, t);
  if (pts.length === 0) return '';
  let d = `M${fmt(pts[0].x)},${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += `L${fmt(pts[i].x)},${fmt(pts[i].y)}`;
  return d + 'Z';
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function rayProgressAt(t: number): number {
  return smoothstep(0.2, 0.95, clamp01(t));
}

export function collapsedRayPoint(ray: [number, number, number, number]): Pt {
  const dx = ray[2] - SUN_CENTER.x;
  const dy = ray[3] - SUN_CENTER.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: SUN_CENTER.x + (dx / len) * SUN_RADIUS, y: SUN_CENTER.y + (dy / len) * SUN_RADIUS };
}

export interface RayFrame { x1: number; y1: number; x2: number; y2: number; opacity: number; }

export function rayFrameAt(ray: [number, number, number, number], t: number): RayFrame {
  const rt = rayProgressAt(t);
  const c = collapsedRayPoint(ray);
  return {
    x1: c.x + (ray[0] - c.x) * rt,
    y1: c.y + (ray[1] - c.y) * rt,
    x2: c.x + (ray[2] - c.x) * rt,
    y2: c.y + (ray[3] - c.y) * rt,
    opacity: rt,
  };
}

function bezierCoord(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function bezierDerivative(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

export function cubicBezierEasing(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 5; i++) {
      const err = bezierCoord(t, x1, x2) - x;
      if (Math.abs(err) < 1e-4) break;
      const d = bezierDerivative(t, x1, x2);
      if (Math.abs(d) < 1e-4) break;
      t = clamp01(t - err / d);
    }
    return bezierCoord(t, y1, y2);
  };
}

export const morphEasing = cubicBezierEasing(...MORPH_BEZIER);

export function isReducedMotion(): boolean {
  try {
    if (typeof document !== 'undefined' && (document.documentElement as any)?.dataset?.animations === 'off') return true;
  } catch {}
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function nowMs(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  } catch {  }
  return Date.now();
}

function nextFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => cb());
  return Number(setTimeout(() => cb(), 16));
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    try { cancelAnimationFrame(id); } catch {  }
    return;
  }
  clearTimeout(id);
}

export type MorphTarget = 0 | 1;

export interface MorphAnimator {
  getProgress(): number;
  getTarget(): MorphTarget;
  isAnimating(): boolean;
  animateTo(target: MorphTarget): void;
  snapTo(target: MorphTarget): void;
  cancel(): void;
  dispose(): void;
}

export function createThemeMorphAnimator(opts: {
  durationMs?: number;
  initial?: number;
  onFrame: (t: number) => void;
  isReducedMotion?: () => boolean;
}): MorphAnimator {
  const durationMs = opts.durationMs ?? MORPH_DURATION_MS;
  const reduced = opts.isReducedMotion ?? isReducedMotion;
  let progress = clamp01(opts.initial ?? 0);
  let target: MorphTarget = progress >= 0.5 ? 1 : 0;
  let rafId: number | null = null;
  let startProgress = progress;
  let startTime = 0;
  let disposed = false;

  const finishTo = (v: number): void => {
    rafId = null;
    progress = clamp01(v);
    if (!disposed) opts.onFrame(progress);
  };

  const step = (): void => {
    if (disposed || rafId === null) return;
    const raw = durationMs <= 0 ? 1 : clamp01((nowMs() - startTime) / durationMs);
    const eased = morphEasing(raw);
    progress = clamp01(startProgress + (target - startProgress) * eased);
    opts.onFrame(progress);
    if (raw >= 1 || progress === target) {
      rafId = null;
      progress = target;
      opts.onFrame(progress);
      return;
    }
    rafId = nextFrame(step);
  };

  return {
    getProgress: () => progress,
    getTarget: () => target,
    isAnimating: () => rafId !== null,
    animateTo(next: MorphTarget) {
      if (disposed) return;
      target = next;
      if (reduced()) {
        if (rafId !== null) { cancelFrame(rafId); rafId = null; }
        finishTo(next);
        return;
      }

      if (rafId !== null) { cancelFrame(rafId); rafId = null; }
      startProgress = progress;
      if (startProgress === next) {
        opts.onFrame(progress);
        return;
      }
      startTime = nowMs();
      rafId = nextFrame(step);
    },
    snapTo(next: MorphTarget) {
      if (disposed) return;
      target = next;
      if (rafId !== null) { cancelFrame(rafId); rafId = null; }
      finishTo(next);
    },
    cancel() {
      if (rafId !== null) { cancelFrame(rafId); rafId = null; }
    },
    dispose() {
      disposed = true;
      if (rafId !== null) { cancelFrame(rafId); rafId = null; }
    },
  };
}

export function applyMorphFrame(
  body: SVGPathElement | null,
  raysGroup: SVGGElement | null,
  rayLines: Array<SVGLineElement | null>,
  geo: MorphGeometry,
  t: number,
): void {
  const c = clamp01(t);
  if (body) body.setAttribute('d', buildMorphD(geo, c));
  const rt = rayProgressAt(c);
  if (raysGroup) raysGroup.setAttribute('opacity', String(Math.round(rt * 1000) / 1000));
  for (let i = 0; i < rayLines.length && i < SUN_RAYS.length; i++) {
    const el = rayLines[i];
    if (!el) continue;
    const f = rayFrameAt(SUN_RAYS[i], c);
    el.setAttribute('x1', fmt(f.x1));
    el.setAttribute('y1', fmt(f.y1));
    el.setAttribute('x2', fmt(f.x2));
    el.setAttribute('y2', fmt(f.y2));
  }
}

export type ThemeName = 'light' | 'dark';

export function themeToTarget(theme: ThemeName): MorphTarget {
  return theme === 'dark' ? 1 : 0;
}

export function ThemeMorphIcon({ theme, size = 20 }: { theme: ThemeName; size?: number }) {
  const geo = useMemo(() => getMorphGeometry(), []);
  const target = themeToTarget(theme);

  const initialSnapshot = useMemo(() => {
    const t0 = themeToTarget(theme);
    const lines = SUN_RAYS.map((r) => rayFrameAt(r, t0));
    return { d: buildMorphD(getMorphGeometry(), t0), lines, raysOpacity: rayProgressAt(t0) };
  }, []);

  const bodyRef = useRef<SVGPathElement | null>(null);
  const raysRef = useRef<SVGGElement | null>(null);
  const lineRefs = useRef<Array<SVGLineElement | null>>([]);
  const animRef = useRef<MorphAnimator | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    const anim = createThemeMorphAnimator({
      durationMs: MORPH_DURATION_MS,
      initial: themeToTarget(theme),
      isReducedMotion: () => THEME_MORPH_ALWAYS_ANIMATE ? false : isReducedMotion(),
      onFrame: (t) => applyMorphFrame(bodyRef.current, raysRef.current, lineRefs.current, geo, t),
    });
    animRef.current = anim;

    anim.snapTo(themeToTarget(theme));
    return () => {
      anim.dispose();
      animRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;

      animRef.current?.snapTo(target);
      return;
    }
    animRef.current?.animateTo(target);
  }, [theme]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={MORPH_VIEWBOX}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      class="tgui-theme-morph-svg"
    >
      <path ref={bodyRef} d={initialSnapshot.d} />
      <g ref={raysRef} opacity={initialSnapshot.raysOpacity}>
        {initialSnapshot.lines.map((ln, i) => (
          <line
            key={i}
            ref={(el: SVGLineElement | null) => { lineRefs.current[i] = el; }}
            x1={ln.x1}
            y1={ln.y1}
            x2={ln.x2}
            y2={ln.y2}
          />
        ))}
      </g>
    </svg>
  );
}

export function themeToggleLabel(theme: ThemeName, lang?: string): string {
  const toLight = theme === 'dark';
  return toLight ? t(S.THEME_SWITCH_LIGHT) : t(S.THEME_SWITCH_DARK);
}

export function ThemeToggle({
  theme,
  onToggle,
  className = 'tgui-theme-toggle',
  lang,
  size = 20,
}: {
  theme: ThemeName;
  onToggle: () => void;
  className?: string;
  lang?: string;
  size?: number;
}) {
  const label = themeToggleLabel(theme, lang);
  return (
    <button
      type="button"
      class={className}
      onClick={onToggle}
      aria-label={label}
      aria-pressed={theme === 'dark'}
      title={label}
    >
      <ThemeMorphIcon theme={theme} size={size} />
    </button>
  );
}
