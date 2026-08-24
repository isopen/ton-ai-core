// Local click effects for stickers without a server-side animation.
// One effect is picked at random per tap; all are purely visual and
// rendered into a fixed body-level layer (no layout, no reflow).

type Sample = { u: number; v: number; color: string };

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

let layerEl: HTMLDivElement | null = null;
function ensureLayer(): HTMLDivElement {
  if (layerEl && layerEl.isConnected) return layerEl;
  const el = document.createElement('div');
  el.id = 'tgui-sticker-click-fx-layer';
  el.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:1160;overflow:hidden';
  document.body.appendChild(el);
  layerEl = el;
  return el;
}

function rectOf(cv: Element): DOMRect {
  return cv.getBoundingClientRect();
}

function samplePixels(cv: HTMLCanvasElement, maxPoints: number, edgeOnly: boolean): Sample[] {
  const W = 44;
  const H = Math.max(2, Math.round((W * cv.height) / Math.max(1, cv.width)));
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  try {
    ctx.drawImage(cv, 0, 0, W, H);
  } catch {
    return [];
  }
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return [];
  }
  const alphaAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + 3];
  const pts: Sample[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] <= 140) continue;
      if (edgeOnly) {
        if (
          alphaAt(x - 1, y) > 140 && alphaAt(x + 1, y) > 140 &&
          alphaAt(x, y - 1) > 140 && alphaAt(x, y + 1) > 140
        ) continue;
      }
      pts.push({ u: (x + 0.5) / W, v: (y + 0.5) / H, color: 'rgb(' + data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ')' });
    }
  }
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pts[i]; pts[i] = pts[j]; pts[j] = t;
  }
  return pts.slice(0, maxPoints);
}

function removeOnFinish(el: HTMLElement, anim: Animation, fallbackMs: number): void {
  let done = false;
  const cleanup = () => { if (!done) { done = true; el.remove(); } };
  anim.finished.then(cleanup).catch(cleanup);
  window.setTimeout(cleanup, fallbackMs);
}

// Effects that mutate the sticker canvas itself (hide/morph it) must be
// exclusive: a new tap force-finishes the previous effect with a proper
// restore, otherwise overlapping cleanups can leave the canvas hidden.
const activeCleanups = new WeakMap<HTMLCanvasElement, () => void>();
function takeover(cv: HTMLCanvasElement, cleanup: () => void): void {
  const prev = activeCleanups.get(cv);
  if (prev && prev !== cleanup) prev();
  activeCleanups.set(cv, cleanup);
}
function releaseTakeover(cv: HTMLCanvasElement, cleanup: () => void): void {
  if (activeCleanups.get(cv) === cleanup) activeCleanups.delete(cv);
}

function spawnParticle(
  layer: HTMLElement,
  sx: number,
  sy: number,
  s: Sample,
  rw: number,
  opts: { confetti: boolean; upBias: number },
): void {
  const el = document.createElement(opts.confetti ? 'div' : 'div');
  const w = opts.confetti ? rand(3, 5) : rand(3, 6);
  const h = opts.confetti ? w * 2.1 : w;
  el.style.cssText =
    'position:absolute;left:' + (sx + s.u * rw) + 'px;top:' + (sy + s.v * rw) + 'px;' +
    'width:' + w.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;background:' + s.color + ';' +
    'border-radius:' + (opts.confetti ? '1px' : '50%') + ';will-change:transform,opacity;pointer-events:none';
  const dirX = s.u < 0.45 ? -1 : s.u > 0.55 ? 1 : rand(-1, 1);
  const vx = dirX * rand(70, 260) + rand(-60, 60);
  const vy = -rand(90, 330) * opts.upBias - rand(40, 170);
  const g = 980;
  const dur = opts.confetti ? rand(1150, 1750) : rand(950, 1500);
  const spin = rand(-420, 420);
  const kf: Keyframe[] = [];
  for (let k = 0; k <= 4; k++) {
    const t = k / 4;
    const px = vx * t * (dur / 1000);
    const py = vy * t * (dur / 1000) + 0.5 * g * t * t * (dur / 1000) * (dur / 1000);
    kf.push({
      transform: 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px) rotate(' + (spin * t).toFixed(0) + 'deg)' +
        (opts.confetti ? ' scaleY(' + (k % 2 === 1 ? 0.35 : 1).toFixed(2) + ')' : ''),
      opacity: k < 3 ? 1 : 0,
      offset: t,
    });
  }
  const anim = el.animate(kf, { duration: dur, easing: 'linear', fill: 'both' });
  layer.appendChild(el);
  removeOnFinish(el, anim, dur + 200);
}

function fxPixelBurst(cv: HTMLCanvasElement, x: number, y: number): boolean {
  const r = rectOf(cv);
  const samples = samplePixels(cv, 74, false);
  if (samples.length === 0) return false;
  const layer = ensureLayer();
  for (const s of samples) spawnParticle(layer, r.left, r.top, s, r.width, { confetti: false, upBias: 1 });
  return true;
}

function fxConfetti(cv: HTMLCanvasElement, x: number, y: number): boolean {
  const r = rectOf(cv);
  const samples = samplePixels(cv, 46, true);
  if (samples.length === 0) return false;
  const layer = ensureLayer();
  for (const s of samples) spawnParticle(layer, r.left, r.top, s, r.width, { confetti: true, upBias: 1.25 });
  return true;
}

function fxWave(cv: HTMLCanvasElement, x: number, y: number): boolean {
  const r = rectOf(cv);
  const layer = ensureLayer();
  const size = Math.max(210, Math.max(r.width, r.height) * 2.0);
  for (let i = 0; i < 2; i++) {
    const ring = document.createElement('div');
    ring.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + size + 'px;height:' + size + 'px;' +
      'margin:' + (-size / 2) + 'px 0 0 ' + (-size / 2) + 'px;border-radius:50%;' +
      'border:3px solid rgba(255,255,255,.85);box-shadow:0 0 16px rgba(255,255,255,.55), inset 0 0 10px rgba(255,255,255,.35);' +
      'will-change:transform,opacity;pointer-events:none';
    const anim = ring.animate([
      { transform: 'scale(.12)', opacity: 1 },
      { transform: 'scale(.7)', opacity: 0.65, offset: 0.45 },
      { transform: 'scale(1)', opacity: 0 },
    ], { duration: 720, delay: i * 120, easing: 'cubic-bezier(.2,.75,.3,1)', fill: 'both' });
    layer.appendChild(ring);
    removeOnFinish(ring, anim, 1050);
  }
  const stars = 6;
  for (let i = 0; i < stars; i++) {
    const ang = rand(0, Math.PI * 2);
    const dist = rand(0.42, 0.72) * (r.width / 2);
    const sp = document.createElement('div');
    const ss = rand(12, 20);
    sp.style.cssText =
      'position:absolute;left:' + (x + Math.cos(ang) * dist) + 'px;top:' + (y + Math.sin(ang) * dist) + 'px;' +
      'width:' + ss + 'px;height:' + ss + 'px;margin:' + (-ss / 2) + 'px 0 0 ' + (-ss / 2) + 'px;' +
      'background:#fff;clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);' +
      'will-change:transform,opacity;pointer-events:none';
    const anim = sp.animate([
      { transform: 'scale(0) rotate(0deg)', opacity: 1 },
      { transform: 'scale(1) rotate(90deg)', opacity: 1, offset: 0.5 },
      { transform: 'scale(0) rotate(180deg)', opacity: 0 },
    ], { duration: rand(560, 800), easing: 'ease-out', fill: 'both', delay: rand(0, 90) });
    layer.appendChild(sp);
    removeOnFinish(sp, anim, 950);
  }
  return true;
}

function fxPop(cv: HTMLCanvasElement, x: number, y: number): boolean {
  const r = rectOf(cv);
  const ox = ((x - r.left) / Math.max(1, r.width)) * 100;
  const oy = ((y - r.top) / Math.max(1, r.height)) * 100;
  const prevOrigin = cv.style.transformOrigin;
  cv.style.transformOrigin = ox.toFixed(1) + '% ' + oy.toFixed(1) + '%';
  const anim = cv.animate([
    { transform: 'scale(1,1)' },
    { transform: 'scale(1.34,.74)', offset: 0.3 },
    { transform: 'scale(.84,1.16)', offset: 0.58 },
    { transform: 'scale(1.08,.95)', offset: 0.8 },
    { transform: 'scale(1,1)' },
  ], { duration: 860, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    anim.cancel();
    cv.style.transformOrigin = prevOrigin;
    releaseTakeover(cv, cleanup);
  };
  takeover(cv, cleanup);
  anim.finished.then(cleanup).catch(() => {});
  return true;
}

function snapshotUrl(cv: HTMLCanvasElement): string | null {
  try {
    const snap = document.createElement('canvas');
    snap.width = Math.max(1, cv.width);
    snap.height = Math.max(1, cv.height);
    const sctx = snap.getContext('2d');
    if (!sctx) return null;
    sctx.drawImage(cv, 0, 0);
    const url = snap.toDataURL();
    return url || null;
  } catch {
    return null;
  }
}

function fxJelly(cv: HTMLCanvasElement, x: number, y: number): boolean {
  const r = rectOf(cv);
  if (r.width < 24 || r.height < 24) return false;
  const url = snapshotUrl(cv);
  if (!url) return false;
  const host = document.createElement('div');
  host.style.cssText =
    'position:absolute;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;' +
    'will-change:transform;pointer-events:none';
  const N = 14;
  const sw = r.width / N;
  const clickX = x - r.left;
  const strips: HTMLElement[] = [];
  const anims: Animation[] = [];
  for (let i = 0; i < N; i++) {
    const st = document.createElement('div');
    st.style.cssText =
      'position:absolute;left:' + (i * sw).toFixed(2) + 'px;top:0;width:' + (sw + 0.6).toFixed(2) + 'px;height:100%;' +
      'background-image:url(' + url + ');background-size:' + r.width.toFixed(1) + 'px ' + r.height.toFixed(1) + 'px;' +
      'background-position:' + (-i * sw).toFixed(2) + 'px 0;will-change:transform;pointer-events:none';
    const dist = Math.abs((i + 0.5) * sw - clickX);
    const amp = 18 * Math.exp(-dist / (r.width * 0.42)) + 3.5;
    const anim = st.animate([
      { transform: 'translateY(0px)' },
      { transform: 'translateY(' + (-amp).toFixed(1) + 'px)', offset: 0.2 },
      { transform: 'translateY(' + (amp * 0.6).toFixed(1) + 'px)', offset: 0.45 },
      { transform: 'translateY(' + (-amp * 0.32).toFixed(1) + 'px)', offset: 0.7 },
      { transform: 'translateY(0px)' },
    ], { duration: 980 + i * 14, easing: 'ease-out' });
    host.appendChild(st);
    strips.push(st);
    anims.push(anim);
  }
  const layer = ensureLayer();
  layer.appendChild(host);
  const prevVis = cv.style.visibility;
  cv.style.visibility = 'hidden';
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    for (const a of anims) a.cancel();
    cv.style.visibility = prevVis;
    host.remove();
    releaseTakeover(cv, cleanup);
  };
  takeover(cv, cleanup);
  Promise.allSettled(anims.map((a) => a.finished)).then(cleanup).catch(cleanup);
  window.setTimeout(cleanup, 1700);
  return true;
}

function tintedCopy(cv: HTMLCanvasElement, color: string): HTMLCanvasElement | null {
  try {
    const c2 = document.createElement('canvas');
    c2.width = Math.max(1, cv.width);
    c2.height = Math.max(1, cv.height);
    const ctx = c2.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(cv, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c2.width, c2.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(cv, 0, 0);
    return c2;
  } catch {
    return null;
  }
}

function fxChroma(cv: HTMLCanvasElement): boolean {
  const r = rectOf(cv);
  if (r.width < 24) return false;
  const red = tintedCopy(cv, '#ff3040');
  const blue = tintedCopy(cv, '#2060ff');
  if (!red || !blue) return false;
  const layer = ensureLayer();
  const mk = (c: HTMLCanvasElement, dx: number): void => {
    c.style.cssText =
      'position:absolute;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;' +
      'mix-blend-mode:screen;opacity:.9;will-change:transform,opacity;pointer-events:none';
    const anim = c.animate([
      { transform: 'translateX(' + dx + 'px)', opacity: 1 },
      { transform: 'translateX(' + (dx * 0.3) + 'px)', opacity: 0.5, offset: 0.55 },
      { transform: 'translateX(0px)', opacity: 0 },
    ], { duration: 380, easing: 'ease-out', fill: 'both' });
    layer.appendChild(c);
    removeOnFinish(c, anim, 550);
  };
  mk(red, -8);
  mk(blue, 8);
  return true;
}

function fxJump(cv: HTMLCanvasElement): boolean {
  const r = rectOf(cv);
  if (r.height < 24) return false;
  const shadow = document.createElement('div');
  shadow.style.cssText =
    'position:absolute;left:' + (r.left + r.width * 0.15) + 'px;top:' + (r.bottom - 6) + 'px;' +
    'width:' + r.width * 0.7 + 'px;height:' + Math.max(6, r.height * 0.09) + 'px;border-radius:50%;' +
    'background:rgba(0,0,0,.28);filter:blur(3px);will-change:transform,opacity;pointer-events:none';
  const layer = ensureLayer();
  layer.appendChild(shadow);
  const shAnim = shadow.animate([
    { transform: 'scaleX(1)', opacity: 0.32 },
    { transform: 'scaleX(.5)', opacity: 0.12, offset: 0.45 },
    { transform: 'scaleX(1.12)', opacity: 0.42, offset: 0.78 },
    { transform: 'scaleX(1)', opacity: 0.32 },
  ], { duration: 900, easing: 'ease-in-out', fill: 'both' });
  removeOnFinish(shadow, shAnim, 1150);

  const prevOrigin = cv.style.transformOrigin;
  cv.style.transformOrigin = '50% 100%';
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    anim.cancel();
    shAnim.cancel();
    shadow.remove();
    cv.style.transformOrigin = prevOrigin;
    releaseTakeover(cv, cleanup);
  };
  takeover(cv, cleanup);
  const anim = cv.animate([
    { transform: 'translateY(0px) rotate(0deg) scale(1,1)' },
    { transform: 'translateY(' + (-Math.min(48, r.height * 0.34)).toFixed(1) + 'px) rotate(-9deg) scale(1.03,.97)', offset: 0.45 },
    { transform: 'translateY(0px) rotate(0deg) scale(1.08,.86)', offset: 0.78 },
    { transform: 'translateY(0px) rotate(0deg) scale(1,1)' },
  ], { duration: 900, easing: 'ease-in-out' });
  anim.finished.then(cleanup).catch(() => {});
  return true;
}

const HEART_CLIP = 'polygon(50% 100%, 22% 82%, 4% 52%, 8% 22%, 26% 8%, 44% 14%, 50% 28%, 56% 14%, 74% 8%, 92% 22%, 96% 52%, 78% 82%)';
const SPARK_CLIP = 'polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%)';

function starPolygon(spikes: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const ang = (Math.PI * i) / spikes - Math.PI / 2;
    pts.push((50 + Math.cos(ang) * rad).toFixed(1) + '% ' + (50 + Math.sin(ang) * rad).toFixed(1) + '%');
  }
  return 'polygon(' + pts.join(',') + ')';
}

function fxTiles(cv: HTMLCanvasElement, x: number, y: number): boolean {
  const r = rectOf(cv);
  if (r.width < 40 || r.height < 40) return false;
  const url = snapshotUrl(cv);
  if (!url) return false;
  const host = document.createElement('div');
  host.style.cssText =
    'position:absolute;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;pointer-events:none';
  const N = 4;
  const tw = r.width / N, th = r.height / N;
  const cxn = Math.min(1, Math.max(0, (x - r.left) / r.width));
  const cyn = Math.min(1, Math.max(0, (y - r.top) / r.height));
  const anims: Animation[] = [];
  let maxDur = 0;
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const tile = document.createElement('div');
      tile.style.cssText =
        'position:absolute;left:' + (gx * tw).toFixed(1) + 'px;top:' + (gy * th).toFixed(1) + 'px;' +
        'width:' + (tw + 0.6).toFixed(1) + 'px;height:' + (th + 0.6).toFixed(1) + 'px;' +
        'background-image:url(' + url + ');background-size:' + r.width.toFixed(1) + 'px ' + r.height.toFixed(1) + 'px;' +
        'background-position:' + (-gx * tw).toFixed(1) + 'px ' + (-gy * th).toFixed(1) + 'px;' +
        'will-change:transform,opacity;pointer-events:none';
      const dx = (gx + 0.5) / N - cxn, dy = (gy + 0.5) / N - cyn;
      const dist = Math.hypot(dx, dy) || 0.001;
      const vx = (dx / dist) * rand(90, 170) + rand(-25, 25);
      const vy = (dy / dist) * rand(70, 140) - rand(50, 130);
      const g = 1150;
      const rot = rand(-170, 170);
      const dur = rand(650, 900) + dist * 260;
      maxDur = Math.max(maxDur, dur);
      const kf: Keyframe[] = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4, tt = (t * dur) / 1000;
        kf.push({
          transform: 'translate(' + (vx * tt).toFixed(1) + 'px,' + (vy * tt + 0.5 * g * tt * tt).toFixed(1) + 'px) rotate(' + (rot * t).toFixed(0) + 'deg)',
          opacity: k < 3 ? 1 : 0,
          offset: t,
        });
      }
      host.appendChild(tile);
      anims.push(tile.animate(kf, { duration: dur, easing: 'linear', fill: 'both' }));
    }
  }
  const layer = ensureLayer();
  layer.appendChild(host);
  const prevVis = cv.style.visibility;
  cv.style.visibility = 'hidden';
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    for (const a of anims) a.cancel();
    cv.style.visibility = prevVis;
    host.remove();
    releaseTakeover(cv, cleanup);
  };
  takeover(cv, cleanup);
  Promise.allSettled(anims.map((a) => a.finished)).then(cleanup).catch(cleanup);
  window.setTimeout(cleanup, maxDur + 350);
  return true;
}

function fxImplode(cv: HTMLCanvasElement, x: number, y: number): boolean {
  const r = rectOf(cv);
  const layer = ensureLayer();
  const samples = samplePixels(cv, 34, false);
  const R = Math.max(r.width, r.height) * rand(0.85, 1.1);
  const count = Math.max(samples.length, 26);
  const dur = 470;
  const els: HTMLElement[] = [];
  const anims: Animation[] = [];
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rand(-0.25, 0.25);
    const sx = x + Math.cos(ang) * R * rand(0.7, 1.05);
    const sy = y + Math.sin(ang) * R * rand(0.7, 1.05);
    const s = samples.length ? samples[i % samples.length] : null;
    const el = document.createElement('div');
    const sz = rand(4, 7);
    el.style.cssText =
      'position:absolute;left:' + sx.toFixed(1) + 'px;top:' + sy.toFixed(1) + 'px;width:' + sz + 'px;height:' + sz + 'px;' +
      'border-radius:50%;background:' + (s ? s.color : '#fff') + ';mix-blend-mode:screen;will-change:transform,opacity;pointer-events:none';
    layer.appendChild(el);
    els.push(el);
    anims.push(el.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 0.9 },
      { transform: 'translate(' + (x - sx).toFixed(1) + 'px,' + (y - sy).toFixed(1) + 'px) scale(0.35)', opacity: 1 },
    ], { duration: dur, easing: 'cubic-bezier(.5,0,.85,.4)', fill: 'both', delay: rand(0, 60) }));
  }
  let flashEl: HTMLElement | null = null;
  let flashAnim: Animation | null = null;
  const flashT = window.setTimeout(() => {
    flashEl = document.createElement('div');
    const fs = Math.max(r.width, r.height) * 0.8;
    flashEl.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + fs + 'px;height:' + fs + 'px;' +
      'margin:' + (-fs / 2) + 'px 0 0 ' + (-fs / 2) + 'px;border-radius:50%;' +
      'background:radial-gradient(circle,rgba(255,255,255,.95) 0%,rgba(255,255,255,.25) 45%,transparent 70%);' +
      'will-change:transform,opacity;pointer-events:none';
    layer.appendChild(flashEl);
    flashAnim = flashEl.animate([
      { transform: 'scale(.2)', opacity: 1 },
      { transform: 'scale(1)', opacity: 0 },
    ], { duration: 340, easing: 'cubic-bezier(.2,.75,.3,1)', fill: 'both' });
    removeOnFinish(flashEl, flashAnim, 450);
  }, dur + 40);
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    window.clearTimeout(flashT);
    for (const a of anims) a.cancel();
    for (const e of els) e.remove();
    if (flashAnim && flashEl) { flashAnim.cancel(); flashEl.remove(); }
  };
  Promise.all(anims.map((a) => a.finished)).then(cleanup).catch(() => {});
  window.setTimeout(cleanup, dur + 700);
  void cv;
  return true;
}

function fxBam(cv: HTMLCanvasElement): boolean {
  const r = rectOf(cv);
  const layer = ensureLayer();
  const size = Math.max(r.width, r.height) * rand(1.8, 2.1);
  const star = document.createElement('div');
  star.style.cssText =
    'position:absolute;left:' + (r.left + r.width / 2) + 'px;top:' + (r.top + r.height / 2) + 'px;' +
    'width:' + size + 'px;height:' + size + 'px;margin:' + (-size / 2) + 'px 0 0 ' + (-size / 2) + 'px;' +
    'background:#ffd94a;clip-path:' + starPolygon(12, 50, 34) + ';' +
    'will-change:transform,opacity;pointer-events:none';
  layer.appendChild(star);
  star.animate([
    { transform: 'scale(.25) rotate(-20deg)', opacity: 0 },
    { transform: 'scale(1.06) rotate(6deg)', opacity: 1, offset: 0.45 },
    { transform: 'scale(1) rotate(10deg)', opacity: 1, offset: 0.75 },
    { transform: 'scale(1.15) rotate(14deg)', opacity: 0 },
  ], { duration: 560, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'both' });
  removeOnFinish(star, star.animate([], { duration: 560 }), 750);
  const bub = cv.closest('.MessageBubble');
  if (bub) {
    bub.animate([
      { transform: 'translate(0,0)' },
      { transform: 'translate(-3px,2px)', offset: 0.25 },
      { transform: 'translate(3px,-2px)', offset: 0.5 },
      { transform: 'translate(-2px,1px)', offset: 0.75 },
      { transform: 'translate(0,0)' },
    ], { duration: 280, easing: 'ease-out' });
  }
  return true;
}

function fxBolt(cv: HTMLCanvasElement, x: number, y: number): boolean {
  const r = rectOf(cv);
  const pad = 70;
  const lx = r.left - pad, ly = r.top - pad;
  const lw = r.width + pad * 2, lh = r.height + pad * 2;
  const cnv = document.createElement('canvas');
  cnv.width = Math.round(lw); cnv.height = Math.round(lh);
  cnv.style.cssText =
    'position:absolute;left:' + lx + 'px;top:' + ly + 'px;width:' + lw + 'px;height:' + lh + 'px;pointer-events:none';
  const ctx = cnv.getContext('2d');
  if (!ctx) return false;
  const drawBolt = (x0: number, y0: number, x1: number, y1: number, w: number, color: string) => {
    const segs = 9;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const jx = rand(-16, 16), jy = rand(-8, 8);
      ctx.lineTo(x0 + (x1 - x0) * t + jx, y0 + (y1 - y0) * t + jy);
    }
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const lcx = x - lx, lcy = y - ly;
  drawBolt(lcx + rand(-40, 40), 0, lcx, lcy, 3, 'rgba(160,210,255,.95)');
  drawBolt(lcx, lcy, lcx + rand(-70, 70), lh, 2, 'rgba(160,210,255,.8)');
  drawBolt(lcx, lcy, lcx > lw / 2 ? 0 : lw, lcy + rand(-30, 30), 1.4, 'rgba(200,235,255,.7)');
  const layer = ensureLayer();
  layer.appendChild(cnv);
  cnv.animate([{ opacity: 1 }, { opacity: 0.4, offset: 0.5 }, { opacity: 0 }], { duration: 430, fill: 'both' });
  removeOnFinish(cnv, cnv.animate([], { duration: 430 }), 600);
  const filterAnim = cv.animate([
    { filter: 'brightness(1)' },
    { filter: 'brightness(1.9) saturate(1.3)', offset: 0.12 },
    { filter: 'brightness(1)', offset: 0.3 },
    { filter: 'brightness(1.5)', offset: 0.42 },
    { filter: 'brightness(1)' },
  ], { duration: 360 });
  filterAnim.finished.catch(() => {});
  for (let i = 0; i < 8; i++) {
    const sp = document.createElement('div');
    const ss = rand(4, 7);
    const ang = rand(0, Math.PI * 2);
    sp.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + ss + 'px;height:' + ss + 'px;margin:' + (-ss / 2) + 'px 0 0 ' + (-ss / 2) + 'px;' +
      'background:#bfe0ff;border-radius:50%;mix-blend-mode:screen;will-change:transform,opacity;pointer-events:none';
    const dist = rand(30, 80);
    layer.appendChild(sp);
    removeOnFinish(sp, sp.animate([
      { transform: 'translate(0,0)', opacity: 1 },
      { transform: 'translate(' + (Math.cos(ang) * dist).toFixed(0) + 'px,' + (Math.sin(ang) * dist).toFixed(0) + 'px)', opacity: 0 },
    ], { duration: rand(280, 420), easing: 'ease-out', fill: 'both' }), 550);
  }
  return true;
}

function fxSpin(cv: HTMLCanvasElement, x: number, y: number): boolean {
  const r = rectOf(cv);
  const prevOrigin = cv.style.transformOrigin;
  cv.style.transformOrigin = '50% 50%';
  const anim = cv.animate([
    { transform: 'rotate(0deg) scale(1,1)' },
    { transform: 'rotate(300deg) scale(.86,1.1)', offset: 0.6 },
    { transform: 'rotate(540deg) scale(1,1)' },
  ], { duration: 950, easing: 'cubic-bezier(.2,.7,.3,1)' });
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    anim.cancel();
    cv.style.transformOrigin = prevOrigin;
    releaseTakeover(cv, cleanup);
  };
  takeover(cv, cleanup);
  anim.finished.then(cleanup).catch(() => {});
  const layer = ensureLayer();
  for (let i = 0; i < 8; i++) {
    const sp = document.createElement('div');
    const ss = rand(6, 10);
    sp.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + ss + 'px;height:' + ss + 'px;margin:' + (-ss / 2) + 'px 0 0 ' + (-ss / 2) + 'px;' +
      'background:#fff;clip-path:' + SPARK_CLIP + ';will-change:transform,opacity;pointer-events:none';
    const baseAng = (i / 8) * Math.PI * 2;
    const dist = r.width * 0.85;
    const sweep = rand(1.6, 2.4);
    const kf: Keyframe[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const ang = baseAng + sweep * t;
      const dd = dist * t;
      kf.push({
        transform: 'translate(' + (Math.cos(ang) * dd).toFixed(1) + 'px,' + (Math.sin(ang) * dd * 0.6).toFixed(1) + 'px) rotate(' + (360 * t) + 'deg)',
        opacity: k === 0 ? 0 : k === 1 ? 1 : t < 0.85 ? 0.9 : 0,
        offset: t,
      });
    }
    layer.appendChild(sp);
    removeOnFinish(sp, sp.animate(kf, { duration: 800, easing: 'ease-out', fill: 'both', delay: 60 }), 1000);
  }
  return true;
}

function fxBounce(cv: HTMLCanvasElement): boolean {
  const r = rectOf(cv);
  const prevOrigin = cv.style.transformOrigin;
  cv.style.transformOrigin = '50% 100%';
  const drop = Math.min(54, r.height * 0.38);
  const anim = cv.animate([
    { transform: 'translateY(0) scale(1,1)' },
    { transform: 'translateY(' + drop + 'px) scale(1.08,.84)', offset: 0.32 },
    { transform: 'translateY(' + (-drop * 0.55) + 'px) scale(.97,1.04)', offset: 0.55 },
    { transform: 'translateY(' + drop * 0.35 + 'px) scale(1.05,.9)', offset: 0.74 },
    { transform: 'translateY(' + (-drop * 0.16) + 'px)', offset: 0.88 },
    { transform: 'translateY(0) scale(1,1)' },
  ], { duration: 980, easing: 'ease-in-out' });
  let done = false;
  const dustTimes: number[] = [Math.round(980 * 0.32), Math.round(980 * 0.74)];
  const timers: number[] = [];
  const cleanup = () => {
    if (done) return;
    done = true;
    anim.cancel();
    for (const t of timers) window.clearTimeout(t);
    cv.style.transformOrigin = prevOrigin;
    releaseTakeover(cv, cleanup);
  };
  takeover(cv, cleanup);
  anim.finished.then(cleanup).catch(() => {});
  const layer = ensureLayer();
  const puff = (side: number) => {
    for (let i = 0; i < 3; i++) {
      const p = document.createElement('div');
      const ps = rand(6, 11);
      const px = side < 0 ? r.left + rand(4, 18) : r.right - rand(4, 18);
      p.style.cssText =
        'position:absolute;left:' + px + 'px;top:' + (r.bottom - 4) + 'px;width:' + ps + 'px;height:' + ps + 'px;' +
        'margin:' + (-ps / 2) + 'px 0 0 ' + (-ps / 2) + 'px;border-radius:50%;background:rgba(160,160,160,.5);' +
        'will-change:transform,opacity;pointer-events:none';
      layer.appendChild(p);
      removeOnFinish(p, p.animate([
        { transform: 'translate(0,0) scale(.6)', opacity: 0.7 },
        { transform: 'translate(' + (side * rand(10, 26)).toFixed(0) + 'px,' + (-rand(4, 12)).toFixed(0) + 'px) scale(1.4)', opacity: 0 },
      ], { duration: rand(280, 380), easing: 'ease-out', fill: 'both' }), 480);
    }
  };
  timers.push(window.setTimeout(() => puff(-1), dustTimes[0]));
  timers.push(window.setTimeout(() => puff(1), dustTimes[0] + 40));
  timers.push(window.setTimeout(() => puff(-1), dustTimes[1]));
  return true;
}

function fxTeleport(cv: HTMLCanvasElement, x: number, y: number): boolean {
  const r = rectOf(cv);
  if (r.width < 40) return false;
  const url = snapshotUrl(cv);
  if (!url) return false;
  const layer = ensureLayer();
  const mkHost = (): HTMLElement => {
    const h = document.createElement('div');
    h.style.cssText =
      'position:absolute;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;' +
      'background-image:url(' + url + ');background-size:100% 100%;will-change:transform,opacity;pointer-events:none';
    layer.appendChild(h);
    return h;
  };
  const prevVis = cv.style.visibility;
  cv.style.visibility = 'hidden';
  const h1 = mkHost();
  const dot = document.createElement('div');
  const ds = 14;
  dot.style.cssText =
    'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + ds + 'px;height:' + ds + 'px;margin:' + (-ds / 2) + 'px 0 0 ' + (-ds / 2) + 'px;' +
    'border-radius:50%;background:#fff;box-shadow:0 0 12px 4px rgba(255,255,255,.8);will-change:transform,opacity;pointer-events:none';
  layer.appendChild(dot);
  const anims: Animation[] = [];
  const timers: number[] = [];
  anims.push(h1.animate([
    { transform: 'scale(1)', opacity: 1 },
    { transform: 'scale(.04)', opacity: 0.9 },
  ], { duration: 230, easing: 'cubic-bezier(.6,0,.9,.4)', fill: 'both' }));
  anims.push(dot.animate([
    { transform: 'scale(.4)', opacity: 0 },
    { transform: 'scale(1.15)', opacity: 1, offset: 0.4 },
    { transform: 'scale(.2)', opacity: 0 },
  ], { duration: 420, delay: 200, fill: 'both' }));
  let h2: HTMLElement | null = null;
  timers.push(window.setTimeout(() => {
    if (done) return;
    h2 = mkHost();
    h2.style.top = (r.top - 22) + 'px';
    anims.push(h2.animate([
      { transform: 'scale(.06)', opacity: 0 },
      { transform: 'scale(1.07)', opacity: 1, offset: 0.75 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 260, easing: 'cubic-bezier(.25,1.2,.4,1)', fill: 'both' }));
    const ring = document.createElement('div');
    const rs = Math.max(r.width, r.height) * 1.35;
    ring.style.cssText =
      'position:absolute;left:' + x + 'px;top:' + (y - 22) + 'px;width:' + rs + 'px;height:' + rs + 'px;' +
      'margin:' + (-rs / 2) + 'px 0 0 ' + (-rs / 2) + 'px;border-radius:50%;border:2px solid rgba(255,255,255,.8);' +
      'will-change:transform,opacity;pointer-events:none';
    layer.appendChild(ring);
    removeOnFinish(ring, ring.animate([
      { transform: 'scale(.3)', opacity: 0.9 },
      { transform: 'scale(1)', opacity: 0 },
    ], { duration: 380, easing: 'ease-out', fill: 'both' }), 500);
  }, 330));
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    for (const t of timers) window.clearTimeout(t);
    for (const a of anims) a.cancel();
    h1.remove();
    if (h2) h2.remove();
    dot.remove();
    cv.style.visibility = prevVis;
    releaseTakeover(cv, cleanup);
  };
  takeover(cv, cleanup);
  window.setTimeout(() => { if (!done) cleanup(); }, 1050);
  return true;
}

function fxPendulum(cv: HTMLCanvasElement): boolean {
  const prevOrigin = cv.style.transformOrigin;
  cv.style.transformOrigin = '50% 0%';
  const anim = cv.animate([
    { transform: 'rotate(0deg)' },
    { transform: 'rotate(13deg)', offset: 0.2 },
    { transform: 'rotate(-10deg)', offset: 0.42 },
    { transform: 'rotate(7deg)', offset: 0.62 },
    { transform: 'rotate(-4deg)', offset: 0.8 },
    { transform: 'rotate(0deg)' },
  ], { duration: 980, easing: 'ease-in-out' });
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    anim.cancel();
    cv.style.transformOrigin = prevOrigin;
    releaseTakeover(cv, cleanup);
  };
  takeover(cv, cleanup);
  anim.finished.then(cleanup).catch(() => {});
  return true;
}

function fxFlame(cv: HTMLCanvasElement): boolean {
  const r = rectOf(cv);
  const layer = ensureLayer();
  for (let i = 0; i < 16; i++) {
    const f = document.createElement('div');
    const fs = rand(9, 18);
    const fx = r.left + rand(r.width * 0.12, r.width * 0.88);
    const fy = r.bottom - rand(0, 14);
    f.style.cssText =
      'position:absolute;left:' + fx + 'px;top:' + fy + 'px;width:' + fs + 'px;height:' + fs * 1.5 + 'px;' +
      'margin:-' + fs * 0.75 + 'px 0 0 ' + (-fs / 2) + 'px;border-radius:50% 50% 45% 45%;' +
      'background:radial-gradient(circle at 50% 70%,#ffe08a 0%,#ff9a2a 45%,rgba(255,60,10,.65) 75%,transparent 100%);' +
      'mix-blend-mode:screen;will-change:transform,opacity;pointer-events:none';
    const rise = r.height * rand(0.75, 1.15);
    const wob = rand(-10, 10);
    layer.appendChild(f);
    removeOnFinish(f, f.animate([
      { transform: 'translate(0,0) scale(.5)', opacity: 0 },
      { transform: 'translate(' + (wob * 0.5).toFixed(1) + 'px,' + (-rise * 0.35).toFixed(1) + 'px) scale(1)', opacity: 0.95, offset: 0.35 },
      { transform: 'translate(' + wob.toFixed(1) + 'px,' + (-rise * 0.75).toFixed(1) + 'px) scale(.7)', opacity: 0.7, offset: 0.7 },
      { transform: 'translate(' + (wob * 1.4).toFixed(1) + 'px,' + (-rise).toFixed(1) + 'px) scale(.3)', opacity: 0 },
    ], { duration: rand(720, 1020), delay: i * 34, easing: 'ease-out', fill: 'both' }), 1450);
  }
  return true;
}

function fxBubbles(cv: HTMLCanvasElement): boolean {
  const r = rectOf(cv);
  const layer = ensureLayer();
  for (let i = 0; i < 9; i++) {
    const b = document.createElement('div');
    const bs = rand(7, 16);
    const bx = r.left + rand(6, r.width - bs - 6);
    const rise = r.height + rand(20, 60);
    b.style.cssText =
      'position:absolute;left:' + bx + 'px;top:' + (r.bottom - 10) + 'px;width:' + bs + 'px;height:' + bs + 'px;' +
      'border-radius:50%;border:1.5px solid rgba(255,255,255,.65);' +
      'background:radial-gradient(circle at 32% 30%,rgba(255,255,255,.55) 0%,rgba(180,220,255,.12) 45%,transparent 70%);' +
      'will-change:transform,opacity;pointer-events:none';
    const sway = rand(6, 14) * (i % 2 === 0 ? 1 : -1);
    layer.appendChild(b);
    removeOnFinish(b, b.animate([
      { transform: 'translate(0,0) scale(.55)', opacity: 0 },
      { transform: 'translate(' + sway + 'px,' + (-rise * 0.4).toFixed(1) + 'px) scale(1)', opacity: 0.85, offset: 0.4 },
      { transform: 'translate(' + (-sway).toFixed(1) + 'px,' + (-rise * 0.8).toFixed(1) + 'px) scale(1.08)', opacity: 0.6, offset: 0.78 },
      { transform: 'translate(' + sway + 'px,' + (-rise).toFixed(1) + 'px) scale(1.15)', opacity: 0 },
    ], { duration: rand(900, 1300), delay: i * 62, easing: 'ease-out', fill: 'both' }), 1650);
  }
  return true;
}

function fxHearts(cv: HTMLCanvasElement): boolean {
  const r = rectOf(cv);
  const layer = ensureLayer();
  const colors = ['#ff4d6d', '#ff7a9e', '#ff2d55', '#ff9ab3'];
  for (let i = 0; i < 7; i++) {
    const h = document.createElement('div');
    const hs = rand(12, 22);
    const hx = r.left + rand(8, Math.max(9, r.width - hs - 8));
    const hy = r.top + rand(r.height * 0.25, r.height * 0.7);
    h.style.cssText =
      'position:absolute;left:' + hx + 'px;top:' + hy + 'px;width:' + hs + 'px;height:' + hs + 'px;' +
      'background:' + colors[i % colors.length] + ';clip-path:' + HEART_CLIP + ';' +
      'will-change:transform,opacity;pointer-events:none';
    const rise = rand(70, 130);
    const sway = rand(10, 22) * (i % 2 === 0 ? 1 : -1);
    layer.appendChild(h);
    removeOnFinish(h, h.animate([
      { transform: 'translate(0,0) scale(.3) rotate(0deg)', opacity: 0 },
      { transform: 'translate(' + sway * 0.5 + 'px,' + (-rise * 0.4).toFixed(1) + 'px) scale(1) rotate(' + rand(-14, 14).toFixed(0) + 'deg)', opacity: 1, offset: 0.35 },
      { transform: 'translate(' + -sway + 'px,' + (-rise * 0.8).toFixed(1) + 'px) scale(.9) rotate(' + rand(-14, 14).toFixed(0) + 'deg)', opacity: 0.85, offset: 0.72 },
      { transform: 'translate(' + sway * 0.7 + 'px,' + (-rise).toFixed(1) + 'px) scale(.55) rotate(0deg)', opacity: 0 },
    ], { duration: rand(880, 1260), delay: i * 68, easing: 'ease-out', fill: 'both' }), 1750);
  }
  return true;
}

function fxOrbit(cv: HTMLCanvasElement): boolean {
  const r = rectOf(cv);
  const layer = ensureLayer();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const Rx = Math.max(r.width, r.height) * 0.78;
  const Ry = Rx * 0.36;
  for (let i = 0; i < 4; i++) {
    const st = document.createElement('div');
    const ss = rand(10, 15);
    st.style.cssText =
      'position:absolute;left:0;top:0;width:' + ss + 'px;height:' + ss + 'px;margin:' + (-ss / 2) + 'px 0 0 ' + (-ss / 2) + 'px;' +
      'background:' + (i % 2 === 0 ? '#fff' : '#ffd94a') + ';clip-path:' + SPARK_CLIP + ';' +
      'will-change:transform,opacity;pointer-events:none';
    const phase = (i / 4) * Math.PI * 2;
    const sweeps = 1 + (i % 2);
    const kf: Keyframe[] = [];
    const STEPS = 12;
    for (let k = 0; k <= STEPS; k++) {
      const t = k / STEPS;
      const ang = phase + t * Math.PI * 2 * sweeps;
      const depth = (Math.sin(ang) + 1) / 2;
      kf.push({
        transform: 'translate(' + (cx + Math.cos(ang) * Rx).toFixed(1) + 'px,' + (cy + Math.sin(ang) * Ry).toFixed(1) + 'px) scale(' + (0.55 + depth * 0.6).toFixed(2) + ') rotate(' + (t * 360 * sweeps).toFixed(0) + 'deg)',
        opacity: t < 0.08 ? t / 0.08 : t > 0.9 ? (1 - t) / 0.1 : 1,
        offset: t,
      });
    }
    layer.appendChild(st);
    removeOnFinish(st, st.animate(kf, { duration: 1150, easing: 'linear', fill: 'both', delay: i * 45 }), 1500);
  }
  return true;
}

function fxHyper(cv: HTMLCanvasElement): boolean {
  const r = rectOf(cv);
  const layer = ensureLayer();
  const pad = 90;
  const zx = r.left - pad, zy = r.top, zw = r.width + pad * 2;
  for (let wave = 0; wave < 2; wave++) {
    for (let i = 0; i < 5; i++) {
      const ln = document.createElement('div');
      const lw = rand(60, 140);
      ln.style.cssText =
        'position:absolute;left:' + zx + 'px;top:' + (zy + rand(6, r.height - 6)) + 'px;width:' + lw + 'px;height:2px;' +
        'background:linear-gradient(90deg,transparent,#fff 50%,transparent);opacity:0;will-change:transform,opacity;pointer-events:none';
      const dir = i % 2 === 0 ? 1 : -1;
      const startX = dir === 1 ? 0 : zw - lw;
      ln.style.transform = 'translateX(' + startX + 'px)';
      layer.appendChild(ln);
      removeOnFinish(ln, ln.animate([
        { transform: 'translateX(' + startX + 'px)', opacity: 0 },
        { opacity: 0.8, offset: 0.2 },
        { transform: 'translateX(' + (dir === 1 ? zw - lw : -lw) + 'px)', opacity: 0 },
      ], { duration: rand(190, 290), delay: wave * 160 + i * 26, easing: 'ease-out', fill: 'both' }), 750);
    }
  }
  const prevOrigin = cv.style.transformOrigin;
  cv.style.transformOrigin = '50% 50%';
  const anim = cv.animate([
    { transform: 'scaleX(1) scaleY(1)' },
    { transform: 'scaleX(1.3) scaleY(.93)', offset: 0.4 },
    { transform: 'scaleX(1) scaleY(1)' },
  ], { duration: 420, easing: 'cubic-bezier(.3,.8,.4,1)' });
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    anim.cancel();
    cv.style.transformOrigin = prevOrigin;
    releaseTakeover(cv, cleanup);
  };
  takeover(cv, cleanup);
  anim.finished.then(cleanup).catch(() => {});
  return true;
}

function fxNeon(cv: HTMLCanvasElement): boolean {
  const anim = cv.animate([
    { filter: 'drop-shadow(0 0 5px rgba(0,255,238,.95)) drop-shadow(0 0 14px rgba(0,255,238,.5))' },
    { filter: 'drop-shadow(0 0 8px rgba(255,0,238,.95)) drop-shadow(0 0 18px rgba(255,0,238,.5))', offset: 0.35 },
    { filter: 'drop-shadow(0 0 8px rgba(186,255,0,.95)) drop-shadow(0 0 18px rgba(186,255,0,.5))', offset: 0.7 },
    { filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))' },
  ], { duration: 950, easing: 'ease-in-out' });
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    anim.cancel();
    releaseTakeover(cv, cleanup);
  };
  takeover(cv, cleanup);
  anim.finished.then(cleanup).catch(() => {});
  return true;
}


const KINDS = [
  'pop', 'pixels', 'wave', 'jelly', 'confetti', 'chroma', 'jump',
  'tiles', 'implode', 'bam', 'bolt', 'spin', 'bounce', 'teleport',
  'pendulum', 'flame', 'bubbles', 'hearts', 'orbit', 'hyper', 'neon',
] as const;
type Kind = typeof KINDS[number];
let lastKind: Kind | '' = '';

interface PendingFx { timer: number; messageId: string }
const pending = new Set<PendingFx>();

function cancelPending(messageId?: string): void {
  for (const p of [...pending]) {
    if (messageId === undefined || !p.messageId || p.messageId === messageId) {
      window.clearTimeout(p.timer);
      pending.delete(p);
    }
  }
}

export function notifyStickerFxOverlayStarted(): void {
  cancelPending(undefined);
}

// A premium server-driven overlay starting means the sticker HAS an fx
// animation: drop any scheduled local effect for it.
if (typeof window !== 'undefined') {
  window.addEventListener('tg-sticker-fx-overlay-started', notifyStickerFxOverlayStarted);
}

/** Schedule a random local effect shortly after the tap; cancelled when a
 *  server-driven premium fx overlay starts for this sticker instead. */
export function scheduleStickerClickFx(stickerEl: HTMLElement, cv: HTMLCanvasElement, messageId: string, x: number, y: number): void {
  if (typeof document === 'undefined' || document.hidden) return;
  cancelPending(messageId);
  const entry: PendingFx = {
    messageId,
    timer: window.setTimeout(() => {
      pending.delete(entry);
      runRandomEffect(stickerEl, cv, x, y);
    }, 130),
  };
  pending.add(entry);
}

function runRandomEffect(stickerEl: HTMLElement, cv: HTMLCanvasElement, x: number, y: number): void {
  try {
    if (!cv.isConnected) return;
    let kind = pick([...KINDS]);
    if (kind === lastKind) kind = pick([...KINDS]);
    lastKind = kind;
    let ok = true;
    switch (kind) {
      case 'pop': ok = fxPop(cv, x, y); break;
      case 'pixels': ok = fxPixelBurst(cv, x, y); break;
      case 'wave': ok = fxWave(cv, x, y); break;
      case 'jelly': ok = fxJelly(cv, x, y); break;
      case 'confetti': ok = fxConfetti(cv, x, y); break;
      case 'chroma': ok = fxChroma(cv); break;
      case 'jump': ok = fxJump(cv); break;
      case 'tiles': ok = fxTiles(cv, x, y); break;
      case 'implode': ok = fxImplode(cv, x, y); break;
      case 'bam': ok = fxBam(cv); break;
      case 'bolt': ok = fxBolt(cv, x, y); break;
      case 'spin': ok = fxSpin(cv, x, y); break;
      case 'bounce': ok = fxBounce(cv); break;
      case 'teleport': ok = fxTeleport(cv, x, y); break;
      case 'pendulum': ok = fxPendulum(cv); break;
      case 'flame': ok = fxFlame(cv); break;
      case 'bubbles': ok = fxBubbles(cv); break;
      case 'hearts': ok = fxHearts(cv); break;
      case 'orbit': ok = fxOrbit(cv); break;
      case 'hyper': ok = fxHyper(cv); break;
      case 'neon': ok = fxNeon(cv); break;
    }
    if (!ok) {
      const fb = pick(['wave', 'pop', 'pixels'] as Kind[]);
      if (fb === 'wave') fxWave(cv, x, y);
      else if (fb === 'pixels') fxPixelBurst(cv, x, y);
      else fxPop(cv, x, y);
    }
    void stickerEl;
  } catch {
    /* effects must never break the chat */
  }
}
