/**
 * @jest-environment jsdom
 */
import { h } from '@ton-ai/atom/jsx-runtime';
import { render } from '@ton-ai/atom/render';
import { useState } from '@ton-ai/atom/hooks';
import {
  MOON_D_ORIGINAL,
  SUN_RAYS,
  MORPH_SEGMENTS,
  MORPH_DURATION_MS,
  getMorphGeometry,
  sampleOriginalMoonPath,
  morphPointAt,
  buildMorphD,
  rayProgressAt,
  rayFrameAt,
  collapsedRayPoint,
  cubicBezierEasing,
  morphEasing,
  createThemeMorphAnimator,
  applyMorphFrame,
  themeToTarget,
  themeToggleLabel,
  ThemeToggle,
} from '../src/components/theme-morph-icon';
import {
  THEME_REVEAL_HOLE_R_PX,
  THEME_TOGGLE_SELECTOR,
  VT_DARK_CLASS,
  VT_LIGHT_CLASS,
  VT_NO_DEFAULT_CLASS,
  VT_OLD_ON_TOP_CLASS,
  supportsViewTransitions,
  revealRadius,
  viewTransitionReveal,
  themeRevealHoleMask,
  themeRevealOverlayCss,
} from '../src/components/theme-reveal';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mockReducedMotion(matches: boolean): () => void {
  const prev = (window as any).matchMedia;
  (window as any).matchMedia = () => ({ matches, addEventListener() {}, removeEventListener() {} });
  return () => { (window as any).matchMedia = prev; };
}

describe('source SVG assets are pinned', () => {
  test('canonical moon path is intact', () => {
    expect(MOON_D_ORIGINAL).toBe('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
  });

  test('8 feather sun rays are in place', () => {
    expect(SUN_RAYS).toHaveLength(8);
    expect(SUN_RAYS[0]).toEqual([12, 1, 12, 3]);
    expect(SUN_RAYS[4]).toEqual([1, 12, 3, 12]);
  });
});

describe('compatible morph geometry', () => {
  test('same topology: K points in both shapes', () => {
    const geo = getMorphGeometry();
    expect(geo.moon).toHaveLength(MORPH_SEGMENTS);
    expect(geo.sun).toHaveLength(MORPH_SEGMENTS);
    for (const p of [...geo.moon, ...geo.sun]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  test('moon outline passes through the original reference points', () => {
    const geo = getMorphGeometry();
    const near = (x: number, y: number) =>
      Math.min(...geo.moon.map((p) => Math.hypot(p.x - x, p.y - y)));
    expect(near(21, 12.79)).toBeLessThan(0.05);
    expect(near(11.21, 3)).toBeLessThan(0.05);
  });

  test('sun outline is an exact r=5 circle centered at (12,12)', () => {
    const geo = getMorphGeometry();
    for (const p of geo.sun) {
      expect(Math.hypot(p.x - 12, p.y - 12)).toBeCloseTo(5, 2);
    }
  });

  test('both shapes inside viewBox 0 0 24 24, shared center', () => {
    const geo = getMorphGeometry();
    for (const pass of [morphPointAt(geo, 0), morphPointAt(geo, 0.5), morphPointAt(geo, 1)]) {
      for (const p of pass) {
        expect(p.x).toBeGreaterThanOrEqual(-0.5);
        expect(p.x).toBeLessThanOrEqual(24.5);
        expect(p.y).toBeGreaterThanOrEqual(-0.5);
        expect(p.y).toBeLessThanOrEqual(24.5);
      }
    }
  });
});

describe('d interpolation is a genuine morph, not a swap', () => {
  test('t=0 is moon (starts at source point M21,12.79), t=1 is sun', () => {
    const geo = getMorphGeometry();
    const d0 = buildMorphD(geo, 0);
    const d1 = buildMorphD(geo, 1);
    expect(d0.startsWith('M21,12.79')).toBe(true);
    expect(d0.endsWith('Z')).toBe(true);
    expect(d1.endsWith('Z')).toBe(true);
    expect(d0).not.toBe(d1);
  });

  test('morph is continuous: no jumps between adjacent frames', () => {
    const geo = getMorphGeometry();
    let prev = morphPointAt(geo, 0);
    for (let step = 1; step <= 100; step++) {
      const cur = morphPointAt(geo, step / 100);
      for (let i = 0; i < cur.length; i++) {
        expect(Math.hypot(cur[i].x - prev[i].x, cur[i].y - prev[i].y)).toBeLessThan(0.6);
      }
      prev = cur;
    }
  });

  test('50% is a genuine intermediate shape, not one of the endpoints', () => {
    const geo = getMorphGeometry();
    const mid = morphPointAt(geo, 0.5);
    const dist = (pts: typeof mid) =>
      pts.reduce((s, p, i) => s + Math.hypot(p.x - geo.moon[i].x, p.y - geo.moon[i].y), 0) / pts.length;
    const toMoon = dist(mid);
    const toSun = mid.reduce((s, p, i) => s + Math.hypot(p.x - geo.sun[i].x, p.y - geo.sun[i].y), 0) / mid.length;
    expect(toMoon).toBeGreaterThan(0.5);
    expect(toSun).toBeGreaterThan(0.5);
  });

  test('each frame is a single path (no two SVGs stacked)', () => {
    const geo = getMorphGeometry();
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const d = buildMorphD(geo, t);
      expect((d.match(/M/g) || []).length).toBe(1);
    }
  });
});

describe('rays are a geometric transform in the same SVG', () => {
  test('t=0: rays collapsed on the disc edge, invisible', () => {
    for (const ray of SUN_RAYS) {
      const f = rayFrameAt(ray, 0);
      expect(f.opacity).toBe(0);
      expect(Math.hypot(f.x2 - f.x1, f.y2 - f.y1)).toBeCloseTo(0, 6);
      const c = collapsedRayPoint(ray);
      expect(Math.hypot(c.x - 12, c.y - 12)).toBeCloseTo(5, 6);
    }
  });

  test('t=1: exact feather-ray coordinates', () => {
    for (const ray of SUN_RAYS) {
      const f = rayFrameAt(ray, 1);
      expect(f.opacity).toBe(1);
      expect([f.x1, f.y1, f.x2, f.y2]).toEqual([...ray]);
    }
  });

  test('rays grow monotonically in the second phase', () => {
    let prevLen = -1;
    for (let s = 0; s <= 20; s++) {
      const f = rayFrameAt(SUN_RAYS[0], s / 20);
      const len = Math.hypot(f.x2 - f.x1, f.y2 - f.y1);
      expect(len + 1e-9).toBeGreaterThanOrEqual(prevLen);
      prevLen = len;
    }
    expect(rayProgressAt(0)).toBe(0);
    expect(rayProgressAt(1)).toBe(1);
  });
});

describe('easing cubic-bezier(0.4, 0, 0.2, 1)', () => {
  test('bounds and monotonicity', () => {
    expect(morphEasing(0)).toBe(0);
    expect(morphEasing(1)).toBe(1);
    let prev = -1;
    for (let s = 0; s <= 50; s++) {
      const v = morphEasing(s / 50);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  test('characteristic curve point (nonlinear)', () => {
    expect(morphEasing(0.5)).toBeGreaterThan(0.6);
    expect(morphEasing(0.5)).toBeLessThan(0.9);
    expect(cubicBezierEasing(0, 0, 1, 1)(0.37)).toBeCloseTo(0.37, 1);
  });
});

describe('animator: single rAF, resume from current position', () => {
  test('reaches the target within ~duration', async () => {
    const frames: number[] = [];
    const anim = createThemeMorphAnimator({
      durationMs: 40,
      initial: 0,
      onFrame: (t) => frames.push(t),
      isReducedMotion: () => false,
    });
    anim.animateTo(1);
    expect(anim.isAnimating()).toBe(true);
    await sleep(150);
    expect(anim.isAnimating()).toBe(false);
    expect(anim.getProgress()).toBe(1);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]).toBeGreaterThanOrEqual(0);
    anim.dispose();
  });

  test('10 fast clicks: no jumps, finish on the last target', async () => {
    const frames: number[] = [];
    const anim = createThemeMorphAnimator({
      durationMs: 60,
      initial: 0,
      onFrame: (t) => frames.push(t),
      isReducedMotion: () => false,
    });
    let target: 0 | 1 = 0;
    for (let i = 0; i < 10; i++) {
      target = target === 0 ? 1 : 0;
      anim.animateTo(target as 0 | 1);
    }
    await sleep(250);
    expect(anim.getProgress()).toBe(target);
    expect(anim.isAnimating()).toBe(false);

    let maxJump = 0;
    for (let i = 1; i < frames.length; i++) {
      maxJump = Math.max(maxJump, Math.abs(frames[i] - frames[i - 1]));
    }
    expect(maxJump).toBeLessThan(0.5);
    anim.dispose();
  });

  test('mid-flight reversal continues from the current progress', async () => {
    const frames: number[] = [];
    const anim = createThemeMorphAnimator({
      durationMs: 80,
      initial: 0,
      onFrame: (t) => frames.push(t),
      isReducedMotion: () => false,
    });
    anim.animateTo(1);
    await sleep(40);
    const mid = anim.getProgress();
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    anim.animateTo(0);
    await sleep(200);
    expect(anim.getProgress()).toBe(0);

    const idx = frames.findIndex((v) => Math.abs(v - mid) < 0.25 && v > 0);
    expect(idx).toBeGreaterThanOrEqual(0);
    anim.dispose();
  });

  test('instances are independent: no shared timer/state', async () => {
    const a: number[] = [];
    const b: number[] = [];
    const animA = createThemeMorphAnimator({ durationMs: 40, initial: 0, onFrame: (t) => a.push(t), isReducedMotion: () => false });
    const animB = createThemeMorphAnimator({ durationMs: 40, initial: 1, onFrame: (t) => b.push(t), isReducedMotion: () => false });
    animA.animateTo(1);
    animB.animateTo(0);
    await sleep(150);
    expect(animA.getProgress()).toBe(1);
    expect(animB.getProgress()).toBe(0);
    animA.dispose();
    animB.dispose();
  });

  test('prefers-reduced-motion: instant transition without rAF', async () => {
    const frames: number[] = [];
    let rafCalls = 0;
    const prevRaf = (global as any).requestAnimationFrame;
    (global as any).requestAnimationFrame = (cb: any) => { rafCalls++; return prevRaf ? prevRaf(cb) : setTimeout(cb, 16); };
    try {
      const anim = createThemeMorphAnimator({
        durationMs: MORPH_DURATION_MS,
        initial: 0,
        onFrame: (t) => frames.push(t),
        isReducedMotion: () => true,
      });
      anim.animateTo(1);
      expect(anim.getProgress()).toBe(1);
      expect(anim.isAnimating()).toBe(false);
      expect(rafCalls).toBe(0);
      anim.dispose();
    } finally {
      (global as any).requestAnimationFrame = prevRaf;
    }
  });

  test('dispose cancels the loop, no timer leaks', async () => {
    const frames: number[] = [];
    const anim = createThemeMorphAnimator({ durationMs: 1000, initial: 0, onFrame: (t) => frames.push(t), isReducedMotion: () => false });
    anim.animateTo(1);
    expect(anim.isAnimating()).toBe(true);
    const n = frames.length;
    anim.dispose();
    expect(anim.isAnimating()).toBe(false);
    await sleep(60);
    expect(frames.length).toBe(n);
  });
});

describe('applyMorphFrame writes geometry to the DOM', () => {
  test('d and rays update without re-render', () => {
    const NS = 'http://www.w3.org/2000/svg';
    const geo = getMorphGeometry();
    const body = document.createElementNS(NS, 'path') as unknown as SVGPathElement;
    const g = document.createElementNS(NS, 'g') as unknown as SVGGElement;
    const lines = SUN_RAYS.map(() => document.createElementNS(NS, 'line') as unknown as SVGLineElement);
    applyMorphFrame(body, g, lines, geo, 0);
    const d0 = body.getAttribute('d')!;
    expect(d0.startsWith('M21,12.79')).toBe(true);
    expect(g.getAttribute('opacity')).toBe('0');
    applyMorphFrame(body, g, lines, geo, 1);
    expect(body.getAttribute('d')).not.toBe(d0);
    expect(g.getAttribute('opacity')).toBe('1');
    expect(lines[0].getAttribute('x1')).toBe('12');
    expect(lines[0].getAttribute('y2')).toBe('3');
  });
});

describe('ThemeToggle: single SVG, a11y, independent instances', () => {
  test('exactly one <svg>: no crossfade of two pictures', () => {
    const restore = mockReducedMotion(true);
    try {
      const box = document.createElement('div');
      document.body.appendChild(box);
      render(() => h(ThemeToggle, { theme: 'light', onToggle: () => {} }), box);
      const btn = box.querySelector('button')!;
      expect(btn).toBeTruthy();
      expect(box.querySelectorAll('svg')).toHaveLength(1);
      expect(box.querySelectorAll('path')).toHaveLength(1);
      expect(box.querySelectorAll('line')).toHaveLength(8);
      expect(box.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 24 24');
      (box as any).__atomRoot?.unmount();
      box.remove();
    } finally {
      restore();
    }
  });

  test('click morphs the icon without recreating SVG + aria reflects the state', async () => {
    const restore = mockReducedMotion(true);
    try {
      const box = document.createElement('div');
      document.body.appendChild(box);
      function Wrap() {
        const [theme, setTheme] = useState<'light' | 'dark'>('light');
        return h(ThemeToggle, { theme, onToggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') });
      }
      render(Wrap, box);
      const btn = box.querySelector('button') as HTMLButtonElement;
      const svgBefore = box.querySelector('svg')!;
      const dBefore = box.querySelector('path')!.getAttribute('d')!;
      expect(btn.getAttribute('aria-label')).toBe(themeToggleLabel('light'));
      expect(btn.getAttribute('aria-pressed')).toBe(null);
      btn.click();
      await sleep(50);
      const svgAfter = box.querySelector('svg')!;
      const dAfter = box.querySelector('path')!.getAttribute('d')!;
      expect(svgAfter).toBe(svgBefore);
      expect(dAfter).not.toBe(dBefore);
      expect(box.querySelector('button')!.getAttribute('aria-label')).toBe(themeToggleLabel('dark'));
      expect(box.querySelector('button')!.getAttribute('aria-pressed')).toBe('');
      (box as any).__atomRoot?.unmount();
      box.remove();
    } finally {
      restore();
    }
  });

  test('two instances: clicking one does not affect the other', async () => {
    const restore = mockReducedMotion(true);
    try {
      const boxA = document.createElement('div');
      const boxB = document.createElement('div');
      document.body.appendChild(boxA);
      document.body.appendChild(boxB);
      function WrapA() {
        const [theme, setTheme] = useState<'light' | 'dark'>('light');
        return h(ThemeToggle, { theme, onToggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') });
      }
      function WrapB() {
        const [theme, setTheme] = useState<'light' | 'dark'>('light');
        return h(ThemeToggle, { theme, onToggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') });
      }
      render(WrapA, boxA);
      render(WrapB, boxB);
      const dBBefore = boxB.querySelector('path')!.getAttribute('d')!;
      (boxA.querySelector('button') as HTMLButtonElement).click();
      await sleep(50);
      expect(boxA.querySelector('path')!.getAttribute('d')).not.toBe(dBBefore);
      expect(boxB.querySelector('path')!.getAttribute('d')).toBe(dBBefore);
      (boxA as any).__atomRoot?.unmount();
      (boxB as any).__atomRoot?.unmount();
      boxA.remove();
      boxB.remove();
    } finally {
      restore();
    }
  });

  test('themeToTarget preserves the original ThemeIcon semantics', () => {
    expect(themeToTarget('light')).toBe(0);
    expect(themeToTarget('dark')).toBe(1);
  });

  test('original moon sample covers both feather-path arcs', () => {
    const raw = sampleOriginalMoonPath();
    expect(raw.length).toBeGreaterThan(90);
  });

  test('live toggle: two clicks restore the original icon geometry', async () => {
    const restore = mockReducedMotion(false);
    try {
      const box = document.createElement('div');
      document.body.appendChild(box);
      function Wrap() {
        const [theme, setTheme] = useState<'light' | 'dark'>('light');
        return h(ThemeToggle, { theme, onToggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') });
      }
      render(Wrap, box);
      const btn = box.querySelector('button') as HTMLButtonElement;
      const svg = box.querySelector('svg')!;
      const d0 = box.querySelector('path')!.getAttribute('d')!;
      btn.click();
      await sleep(800);
      const d1 = box.querySelector('path')!.getAttribute('d')!;
      expect(box.querySelector('svg')).toBe(svg);
      expect(d1).not.toBe(d0);
      btn.click();
      await sleep(800);
      expect(box.querySelector('path')!.getAttribute('d')).toBe(d0);
      (box as any).__atomRoot?.unmount();
      box.remove();
    } finally {
      restore();
    }
  });
});

describe('theme reveal overlay does not cover the icon morph', () => {
  test('selector finds header and auth-form buttons', () => {
    expect(THEME_TOGGLE_SELECTOR).toContain('.tgui-theme-toggle');
    expect(THEME_TOGGLE_SELECTOR).toContain('.login-theme-toggle');
    const box = document.createElement('div');
    box.innerHTML = '<button class="tgui-theme-toggle"></button><button class="login-theme-toggle"></button>';
    expect(box.querySelectorAll(THEME_TOGGLE_SELECTOR)).toHaveLength(2);
  });

  test('overlay has a window under the button: mask + clip-path with the same center', () => {
    const css = themeRevealOverlayCss(100, 200, '#ffffff');
    expect(css).toContain('clip-path:circle(150% at 100px 200px)');
    expect(css).toContain('mask-image:radial-gradient(');
    expect(css).toContain('-webkit-mask-image:radial-gradient(');
    expect(css).toContain('at 100px 200px');
    expect(css).toContain(`transparent ${THEME_REVEAL_HOLE_R_PX}px`);
    expect(css).toContain('background:#ffffff');
    expect(css).toContain('pointer-events:none');
  });

  test('mask has a transparent center under the button, opaque edges', () => {
    const mask = themeRevealHoleMask(10, 20);
    const tIdx = mask.indexOf('transparent');
    const bIdx = mask.indexOf('black');
    expect(tIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(tIdx);
  });

  test('wave radius reaches the far screen corner', () => {
    expect(revealRadius(0, 0, 300, 400)).toBeCloseTo(500, 5);
    expect(revealRadius(150, 200, 300, 400)).toBeCloseTo(250, 5);
  });
});

describe('VT-reveal like on telegram.org', () => {
  function mockVT() {
    let cb: (() => void) | null = null;
    let finishedResolve!: () => void;
    const ready: Promise<void> = Promise.resolve();
    const finished = new Promise<void>((r) => { finishedResolve = r; });
    const skipTransition = jest.fn();
    (document as any).startViewTransition = jest.fn((c: () => void) => {
      cb = c;
      return { ready, finished, skipTransition };
    });
    return {
      skipTransition,
      runCallback: () => cb?.(),
      resolveFinished: finishedResolve,
      restore: () => {
        delete (document as any).startViewTransition;
        const root = document.documentElement;
        root.classList.remove(VT_NO_DEFAULT_CLASS, VT_OLD_ON_TOP_CLASS, VT_DARK_CLASS, VT_LIGHT_CLASS);
        root.style.removeProperty('--vt-x');
        root.style.removeProperty('--vt-y');
        root.style.removeProperty('--vt-r');
        root.style.removeProperty('--vt-duration');
      },
    };
  }

  function vtVars() {
    const st = document.documentElement.style;
    return {
      x: st.getPropertyValue('--vt-x'),
      y: st.getPropertyValue('--vt-y'),
      r: st.getPropertyValue('--vt-r'),
      duration: st.getPropertyValue('--vt-duration'),
    };
  }

  test('without VT support returns null (fallback needed), DOM untouched', () => {
    expect(supportsViewTransitions()).toBe(false);
    let applied = false;
    const h = viewTransitionReveal({ point: { x: 10, y: 10 }, goingDark: true, apply: () => { applied = true; } });
    expect(h).toBe(null);
    expect(applied).toBe(false);
    expect(document.documentElement.classList.contains(VT_NO_DEFAULT_CLASS)).toBe(false);
  });

  test('to dark: expansion wave from the button, classes and variables set', async () => {
    const m = mockVT();
    try {
      expect(supportsViewTransitions()).toBe(true);
      let applied = false;
      const h = viewTransitionReveal({
        point: { x: 100, y: 200 },
        goingDark: true,
        durationMs: 500,
        apply: () => { applied = true; },
      });
      expect(h).not.toBe(null);
      expect((document as any).startViewTransition).toHaveBeenCalledTimes(1);
      m.runCallback();
      expect(applied).toBe(true);
      const root = document.documentElement;
      expect(root.classList.contains(VT_NO_DEFAULT_CLASS)).toBe(true);
      expect(root.classList.contains(VT_DARK_CLASS)).toBe(true);
      expect(root.classList.contains(VT_LIGHT_CLASS)).toBe(false);

      expect(root.classList.contains(VT_OLD_ON_TOP_CLASS)).toBe(false);
      const v = vtVars();
      expect(v.x).toBe('100px');
      expect(v.y).toBe('200px');
      expect(v.duration).toBe('500ms');
      const r = Number(v.r.replace('px', ''));
      expect(r).toBeGreaterThan(Math.max(window.innerWidth, window.innerHeight) / 2);
      m.resolveFinished();
      await h!.finished;
      await sleep(10);
      expect(root.classList.contains(VT_NO_DEFAULT_CLASS)).toBe(false);
      expect(root.classList.contains(VT_DARK_CLASS)).toBe(false);
      expect(vtVars()).toEqual({ x: '', y: '', r: '', duration: '' });
    } finally {
      m.restore();
    }
  });

  test('to light: collapse into the button, old snapshot raised on top', async () => {
    const m = mockVT();
    try {
      let applied = false;
      const h = viewTransitionReveal({
        point: { x: 50, y: 60 },
        goingDark: false,
        apply: () => { applied = true; },
      });
      expect(h).not.toBe(null);
      m.runCallback();
      expect(applied).toBe(true);
      const root = document.documentElement;
      expect(root.classList.contains(VT_LIGHT_CLASS)).toBe(true);
      expect(root.classList.contains(VT_DARK_CLASS)).toBe(false);
      expect(root.classList.contains(VT_OLD_ON_TOP_CLASS)).toBe(true);
      const v = vtVars();
      expect(v.x).toBe('50px');
      expect(v.y).toBe('60px');
      m.resolveFinished();
      await h!.finished;
      await sleep(10);
      expect(root.classList.contains(VT_OLD_ON_TOP_CLASS)).toBe(false);
      expect(root.classList.contains(VT_LIGHT_CLASS)).toBe(false);
      expect(root.classList.contains(VT_NO_DEFAULT_CLASS)).toBe(false);
    } finally {
      m.restore();
    }
  });

  test('cancel interrupts the wave via skipTransition', async () => {
    const m = mockVT();
    try {
      const h = viewTransitionReveal({ point: { x: 1, y: 2 }, goingDark: true, apply: () => {} });
      expect(h).not.toBe(null);
      h!.cancel();
      expect(m.skipTransition).toHaveBeenCalledTimes(1);
      m.resolveFinished();
      await h!.finished;
      await sleep(10);
    } finally {
      m.restore();
    }
  });

  test('starter exception yields null and a clean DOM', () => {
    (document as any).startViewTransition = jest.fn(() => { throw new Error('no vt'); });
    try {
      const h = viewTransitionReveal({ point: { x: 1, y: 2 }, goingDark: true, apply: () => {} });
      expect(h).toBe(null);
      expect(document.documentElement.classList.contains(VT_NO_DEFAULT_CLASS)).toBe(false);
      expect(vtVars()).toEqual({ x: '', y: '', r: '', duration: '' });
    } finally {
      delete (document as any).startViewTransition;
    }
  });
});
