import { playStickerFxOverlay } from './animated-sticker.js';
import { scheduleStickerClickFx } from './sticker-click-fx.js';
import { isEmojiAtTextOffset } from './emoji-store.js';
import { bindLifetimeListeners } from '@ton-ai/atom';
import { getLogger } from '@ton-ai/gram-debug';
import { readMessageFontSize, MESSAGE_FONT_DEFAULT } from '../utils.js';

export function burstParticleSize(big: boolean): number {
  const base = big ? 56 : 30;
  return Math.round(base * readMessageFontSize() / MESSAGE_FONT_DEFAULT);
}

const log = getLogger('gram-ui:emoji-burst');

const LAYER_CAP = 4;
const PARTICLES_PER_LAYER_BASE = 7;
const TOTAL_PARTICLE_CAP = 50;
const TAP_SESSION_MS = 2200;

function isStandaloneMedia(bubble: HTMLElement): boolean {
    if (bubble.querySelector('.tgui-sticker')) return true;
    const slots = bubble.querySelectorAll('.tgui-emoji-slot').length;
    const textLen = (bubble.textContent || '').trim().length;
    return slots === 1 && textLen <= 4;
}

let layerEl: HTMLDivElement | null = null;
let liveParticles = 0;

const tapSessions = new WeakMap<object, { count: number; last: number }>();

function ensureLayer(): HTMLDivElement {
    if (layerEl && layerEl.isConnected) return layerEl;
    layerEl = document.createElement('div');
    layerEl.className = 'tg-emoji-burst-layer';
    layerEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1200;overflow:hidden';
    document.body.appendChild(layerEl);
    return layerEl;
}

function rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function snapshotVideoTile(vid: HTMLVideoElement): HTMLCanvasElement | null {
    try {
        if (!(vid.videoWidth > 0)) return null;

        const maxSide = 96;
        const scale = Math.min(1, maxSide / Math.max(vid.videoWidth, vid.videoHeight));
        const tmp = document.createElement('canvas');
        tmp.width = Math.max(1, Math.round(vid.videoWidth * scale));
        tmp.height = Math.max(1, Math.round(vid.videoHeight * scale));
        tmp.getContext('2d')!.drawImage(vid, 0, 0, tmp.width, tmp.height);
        return tmp;
    } catch { return null; }
}

function resolveBurstSource(node: Element, px: number, py: number): BurstSource {
    if (node instanceof HTMLCanvasElement && node.width > 0) {
        const tile = snapshotCanvasTile(node, px, py);
        if (tile) return { kind: 'image', value: '', canvas: tile };
        return { kind: 'image', value: '', canvas: node };
    }
    if (node instanceof HTMLImageElement && node.src) {
        return { kind: 'image', value: node.src };
    }

    const vid = node.querySelector('video');
    if (vid instanceof HTMLVideoElement && vid.videoWidth > 0) {
        const frame = snapshotVideoTile(vid);
        if (frame) return { kind: 'video', value: vid.src, canvas: frame };
    }
    return { kind: 'image', value: '' };
}

function centerDistance(el: Element, x: number, y: number): number {
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - x;
    const dy = r.top + r.height / 2 - y;
    return Math.hypot(dx, dy);
}

function snapshotCanvasTile(cv: HTMLCanvasElement, px: number, py: number, tileSize?: number): HTMLCanvasElement | null {
    try {
        const r = cv.getBoundingClientRect();
        const scaleX = cv.width / (r.width || cv.width);
        const scaleY = cv.height / (r.height || cv.height);

        const size = Math.max(1, Math.round(tileSize ?? Math.min(cv.width, cv.height)));
        let sx = Math.round((px - r.left) * scaleX - size / 2);
        let sy = Math.round((py - r.top) * scaleY - size / 2);
        sx = Math.max(0, Math.min(sx, cv.width - size));
        sy = Math.max(0, Math.min(sy, cv.height - size));
        const tmp = document.createElement('canvas');
        tmp.width = size;
        tmp.height = size;
        const tctx = tmp.getContext('2d');
        if (!tctx) return null;
        tctx.drawImage(cv, sx, sy, size, size, 0, 0, size, size);
        return tmp;
    } catch {
        return null;
    }
}

function snapshotSlotTile(slotRect: DOMRect, scopeForCanvas: Element): HTMLCanvasElement | null {
    let scv: HTMLCanvasElement | null = null;
    for (const c of Array.from(scopeForCanvas.querySelectorAll<HTMLCanvasElement>('canvas'))) {
        const r = c.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (slotRect.left >= r.left - 2 && slotRect.right <= r.right + 2 && slotRect.top >= r.top - 2 && slotRect.bottom <= r.bottom + 2) {
            scv = c;
            break;
        }
    }
    if (!scv) return null;
    try {
        const cr = scv.getBoundingClientRect();
        const scaleX = scv.width / (cr.width || 1);
        const scaleY = scv.height / (cr.height || 1);
        const tmp = document.createElement('canvas');
        tmp.width = Math.max(1, Math.round(slotRect.width * scaleX));
        tmp.height = Math.max(1, Math.round(slotRect.height * scaleY));
        const tctx = tmp.getContext('2d');
        if (!tctx) return null;
        tctx.drawImage(
            scv,
            Math.round((slotRect.left + slotRect.width / 2 - cr.left) * scaleX - tmp.width / 2),
            Math.round((slotRect.top + slotRect.height / 2 - cr.top) * scaleY - tmp.height / 2),
            tmp.width, tmp.height,
            0, 0, tmp.width, tmp.height,
        );
        return tmp;
    } catch {
        return null;
    }
}

export type BurstSource = {
    kind: 'image' | 'text' | 'video';
    value: string;
    canvas?: HTMLCanvasElement;
};

const VIDEO_PARTICLE_CAP = 6;
let liveVideoParticles = 0;

function spawnParticle(
    x: number,
    y: number,
    source: BurstSource,
    layer: number,
    staticFrame?: string | HTMLCanvasElement,
    size = 30,
    spread = 1,
    quota?: { video: number },
): void {
    if (liveParticles >= TOTAL_PARTICLE_CAP) return;
    let node: HTMLElement;
    let isVideoParticle = false;
    const canVideo = source.kind === 'video'
        && (!quota || quota.video > 0)
        && liveVideoParticles < VIDEO_PARTICLE_CAP
        && !document.hidden;
    if (canVideo) {
        if (quota) quota.video--;
        const v = document.createElement('video');
        v.src = source.value;
        v.muted = true;
        v.loop = true;
        v.autoplay = true;
        v.playsInline = true;
        node = v;
        isVideoParticle = true;
        liveVideoParticles++;
    } else if (source.kind === 'text') {
        node = document.createElement('span');
        node.textContent = source.value;
    } else {
        const frameCanvas = source.canvas ?? (source.kind === 'video' && staticFrame instanceof HTMLCanvasElement ? staticFrame : null);
        if (frameCanvas instanceof HTMLCanvasElement) {
            const c = document.createElement('canvas');
            c.width = Math.max(1, frameCanvas.width);
            c.height = Math.max(1, frameCanvas.height);
            const ctx = c.getContext('2d');
            if (ctx) ctx.drawImage(frameCanvas, 0, 0);
            node = c;
        } else {
            if (source.kind === 'video') {
                if (typeof staticFrame !== 'string' || !staticFrame) return;
                node = document.createElement('img');
                (node as HTMLImageElement).src = staticFrame;
            } else {
                if (!source.value) return;
                node = document.createElement('img');
                (node as HTMLImageElement).src = source.value;
            }
        }
    }

    const half = Math.round(size / 2);
    const baseCss = 'position:fixed;left:' + x + 'px;top:' + y + 'px;'
        + 'margin-left:-' + half + 'px;margin-top:-' + half + 'px;pointer-events:none;'
        + 'will-change:transform,opacity;'
        + (source.kind === 'text'
            ? 'font-size:' + size + 'px;line-height:1;'
            : 'width:' + size + 'px;height:' + size + 'px;object-fit:contain;');
    node.style.cssText = baseCss;

    const angleDeg = rand(-155, -25);
    const angle = (angleDeg * Math.PI) / 180;
    const distScale = 0.85 + layer * 0.22;
    const dist = rand(130, 300) * distScale * spread;
    const dx = Math.cos(angle) * dist;
    const dyUp = Math.sin(angle) * dist;
    const drift = rand(-60, 60);
    const rot = rand(-220, 220) * spread;
    const duration = (rand(900, 1400) + layer * 140) * (spread > 1 ? 1.15 : 1);

    const animation = node.animate([
        { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.55}px, ${dyUp * 0.75}px) rotate(${rot * 0.6}deg) scale(${rand(0.85, 1.15)})`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dyUp * 0.35 + 90}px) rotate(${rot}deg) scale(0.35)`, opacity: 0 },
    ], {
        duration,
        easing: 'cubic-bezier(.17,.67,.4,1)',
        fill: 'forwards',
    });
    liveParticles++;
    const cleanup = () => {
        node.remove();
        liveParticles--;
        if (isVideoParticle) liveVideoParticles = Math.max(0, liveVideoParticles - 1);
    };
    animation.finished.then(cleanup).catch(cleanup);

    layerEl!.appendChild(node);
    if (isVideoParticle) {
        (node as HTMLVideoElement).play().catch(() => {});
    }
}

let burstSpawnsWindow = 0;

export function getBurstStats(): { particles: number; video: number; spawns: number } {
    const s = { particles: liveParticles, video: liveVideoParticles, spawns: burstSpawnsWindow };
    burstSpawnsWindow = 0;
    return s;
}

function clickFxDisabled(): boolean {
    try {
        const s = typeof location !== 'undefined' ? location.search || '' : '';
        if (/[?&]nofx[=&]/.test(s) || /[?&]nofx$/.test(s)) return true;
        const h = typeof location !== 'undefined' ? location.hash || '' : '';
        return /(^|[#&])nofx/.test(h);
    } catch { return false; }
}

export function isClickFxDisabled(): boolean {
    if (typeof document === 'undefined') return false;
    return clickFxDisabled();
}

export function spawnEmojiBurst(x: number, y: number, source: BurstSource, key: object, staticFrame?: string, big = false): void {
    if (document.hidden || clickFxDisabled()) return;
    const layerNode = ensureLayer();

    const now = Date.now();
    let session = tapSessions.get(key);
    if (!session || now - session.last > TAP_SESSION_MS) session = { count: 0, last: now };
    session.count = Math.min(session.count + 1, LAYER_CAP);
    session.last = now;
    tapSessions.set(key, session);

    const layers = session.count;
    const perLayer = PARTICLES_PER_LAYER_BASE + layers * 2;
    const size = burstParticleSize(big);
    const spread = (big ? 1.35 : 1) * readMessageFontSize() / MESSAGE_FONT_DEFAULT;
    log.info('[emoji-burst] spawn layers=' + layers + ' perLayer=' + perLayer + ' size=' + size + ' live=' + liveParticles);
    burstSpawnsWindow++;

    const clickBudget = liveParticles >= 40 ? 2 : liveParticles >= 25 ? 4 : perLayer;
    const quota = { video: 2 };
    let remaining = clickBudget;
    for (let l = 0; l < layers && remaining > 0; l++) {
        const n = Math.min(Math.ceil(perLayer / layers), remaining);
        for (let i = 0; i < n; i++) {
            remaining--;
            setTimeout(() => spawnParticle(x + rand(-10, 10), y + rand(-8, 8), source, l, staticFrame, size, spread, quota), l * 90 + i * 12);
        }
    }
    void layerNode;
}

function dispatchInteractionRequest(detail: {
    messageId: string;
    mediaType: 'emoji' | 'sticker';
    x?: number;
    y?: number;
    slotIndex?: number;
    docId?: string;
    glyph?: string;
    hasCanvasFx?: boolean;
}): void {
    if (!detail.messageId) return;
    window.dispatchEvent(new CustomEvent('tg-interaction-request', { detail }));
}

function isEmojiTapAtPoint(x: number, y: number): boolean {
  try {
    const d = document as any;
    let node: Node | null = null;
    let offset = -1;
    if (typeof d.caretRangeFromPoint === 'function') {
      const r = d.caretRangeFromPoint(x, y);
      if (r) {
        node = r.startContainer;
        offset = r.startOffset;
      }
    } else if (typeof d.caretPositionFromPoint === 'function') {
      const p = d.caretPositionFromPoint(x, y);
      if (p) {
        node = p.offsetNode;
        offset = p.offset;
      }
    }
    if (!node || offset < 0 || node.nodeType !== 3) return true;
    return isEmojiAtTextOffset(node.textContent || '', offset);
  } catch {
    return true;
  }
}

function popEmojiSlot(el: Element, big = false): void {
    try {
        el.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(' + (big ? 1.6 : 1.35) + ')', offset: 0.4 },
            { transform: 'scale(1)' },
        ], { duration: big ? 380 : 320, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    } catch {}
}

export function playVideoEmojiFx(anchor: Element, vid: HTMLVideoElement, x?: number, y?: number, big = false): void {
    if (document.hidden) return;
    popEmojiSlot(anchor, big);
    const r = anchor.getBoundingClientRect();
    const px = x != null && r.width > 0 ? Math.max(r.left, Math.min(x, r.right)) : r.left + r.width / 2;
    const py = y != null && r.height > 0 ? Math.max(r.top, Math.min(y, r.bottom)) : r.top + r.height / 2;
    spawnEmojiBurst(px, py, { kind: 'video', value: vid.src, canvas: snapshotVideoTile(vid) ?? undefined }, vid, undefined, big);
}

function playStickerTapBurst(stickerEl: HTMLElement, mainCv: Element | null, x: number, y: number): void {
    try {
        const r = stickerEl.getBoundingClientRect();
        const px = r.width > 0 ? Math.max(r.left, Math.min(x, r.right)) : x;
        const py = r.height > 0 ? Math.max(r.top, Math.min(y, r.bottom)) : y;
        let source: BurstSource | null = null;
        if (mainCv instanceof HTMLCanvasElement) source = resolveBurstSource(mainCv, px, py);
        if (!source || (!source.canvas && !source.value)) {
            const still = stickerEl.querySelector('.tgui-sticker-preview img, .tgui-sticker-preview video, img, video');
            if (still instanceof HTMLCanvasElement) source = resolveBurstSource(still, px, py);
            else if (still instanceof HTMLImageElement) source = { kind: 'image', value: still.src || '' };
            else if (still instanceof HTMLVideoElement) source = { kind: 'video', value: still.src, canvas: snapshotVideoTile(still) ?? undefined };
        }
        if (!source || (!source.canvas && !source.value)) return;
        spawnEmojiBurst(px, py, source, stickerEl, undefined, true);
    } catch {}
}

let burstAttached = false;
let interactionsAttached = false;

export function attachEmojiBurst(): void {
    if (typeof document === 'undefined' || burstAttached) return;
    burstAttached = true;
    document.addEventListener('click', (e: MouseEvent) => {
        if (document.hidden) return;
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        const x = e.clientX;
        const y = e.clientY;

        const stickerEl = target.closest('.tgui-sticker') as HTMLElement | null;
        const bubble = target.closest('.MessageBubble') || stickerEl;
        if (!bubble) return;

        if (stickerEl) {
            const rowId0 = stickerEl.closest('[id^="msg-"]')?.id || '';
            const mainCv = stickerEl.querySelector(':scope > .tgui-sticker-preview canvas.tgui-animated-sticker');

            if (!stickerEl.hasAttribute('data-server-fx') && mainCv instanceof HTMLCanvasElement) {
                if (!clickFxDisabled()) {
                    scheduleStickerClickFx(stickerEl, mainCv, rowId0.slice(4), x, y);
                    playStickerTapBurst(stickerEl, mainCv, x, y);
                }
            }

            dispatchInteractionRequest({
                messageId: rowId0.slice(4),
                mediaType: 'sticker',
                x, y,
                hasCanvasFx: mainCv instanceof HTMLCanvasElement,
            });
            return;
        }

        const atPoint = typeof document.elementFromPoint === 'function'
            ? (document.elementFromPoint(x, y) as Element | null)
            : null;
        if (target.closest('button, a')) return;
        const slotEl = (target.closest('.tgui-emoji-slot'))
            ?? (atPoint?.closest('.tgui-emoji-slot') ?? null);
        const staticEl = target.closest('.tgui-emoji-static') as HTMLElement | null;
        const richSelector = '.tgui-emoji-scaled, .TgsPlayer, .tgui-emoji-inline, img.rich-ce-img';
        const richEl = (target.closest(richSelector) ?? atPoint?.closest(richSelector) ?? null) as HTMLElement | null;
        const richDocAnchor = richEl?.closest('[data-doc], [data-doc-id]') as HTMLElement | null;

        const row = bubble.closest('[id^="msg-"]') as HTMLElement | null;
        const rowId = row ? row.id.slice(4) : '';

        const emojiHit = !!slotEl || !!staticEl || !!richEl
            || (target instanceof HTMLCanvasElement && target.classList.contains('tgui-animated-sticker'));
        let glyphHit = false;
        if (!emojiHit) {
            const under = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
            const el = under && bubble.contains(under) ? under : null;
            if (el && el.children.length === 0
                && !(el instanceof HTMLImageElement) && !(el instanceof HTMLCanvasElement) && !(el instanceof HTMLVideoElement)
                && /\p{Extended_Pictographic}/u.test(el.textContent || '')) {
                glyphHit = isEmojiTapAtPoint(x, y);
            }
        }
        if (!rowId || target.closest('.tgui-reaction') || (!emojiHit && !glyphHit)) {
            if (rowId) log.info('[gram-app] tap ignored (not an emoji element): msg=' + rowId + ' target=' + (target.className || target.tagName));
            return;
        }
        {
            const slots = Array.from(bubble.querySelectorAll('.tgui-emoji-slot'));
            const slotIdx = slotEl ? slots.indexOf(slotEl) : -1;
            dispatchInteractionRequest({
                messageId: rowId,
                mediaType: 'emoji',
                x, y,
                slotIndex: slotIdx >= 0 ? slotIdx : undefined,
                docId: slotEl?.getAttribute('data-doc') || richDocAnchor?.getAttribute('data-doc') || richDocAnchor?.getAttribute('data-doc-id') || undefined,
                glyph: staticEl?.getAttribute('data-emoji') || undefined,
            });
        }
    }, { passive: true });
}

export function pickInteractionAnchor(bubble: Element, x?: number, y?: number): Element | null {
    const candidates = Array.from(bubble.querySelectorAll<Element>('.tgui-emoji-slot, .tgui-emoji-static, .tgui-sticker-preview, canvas.tgui-animated-sticker, .tgui-emoji-scaled, .TgsPlayer, .tgui-emoji-inline, img.rich-ce-img'))
        .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < window.innerHeight;
        });
    if (candidates.length === 0) return null;
    if (x != null && y != null) {
        let best = candidates[0];
        let bestD = Infinity;
        for (const el of candidates) {
            const r = el.getBoundingClientRect();
            const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
            if (d < bestD) { bestD = d; best = el; }
        }
        return best;
    }
    return candidates[candidates.length - 1];
}

export function runLocalInteractionFx(messageId: string, x?: number, y?: number): void {
    const bubble = document.getElementById('msg-' + messageId);
    if (!bubble) return;
    if (bubble.querySelector('.tgui-sticker[data-server-fx]')) return;

    if (bubble.querySelector('.tgui-sticker-preview canvas.tgui-animated-sticker')) return;

    const stickerVid = bubble.querySelector('.tgui-sticker-preview video') as HTMLVideoElement | null;
    if (stickerVid && stickerVid.src) {
        playVideoEmojiFx(stickerVid.parentElement ?? stickerVid, stickerVid, x, y, true);
        return;
    }
    playBurstFallback(bubble, x, y);
}

export function attachEmojiInteractions(): void {
    if (typeof window === 'undefined' || interactionsAttached) return;
    interactionsAttached = true;

    const onServerFx = (e: Event) => {
        if (document.hidden) return;
        const detail = ((e as CustomEvent).detail || {}) as { messageId?: string; url?: string; key?: string; x?: number; y?: number; exact?: boolean };
        if (!detail.url || detail.messageId == null) return;
        if (clickFxDisabled()) return;
        const bubble = document.getElementById('msg-' + detail.messageId);
        if (!bubble) return;

        if (detail.exact === true && Number.isFinite(detail.x) && Number.isFinite(detail.y)) {
            const point = { left: detail.x as number, top: detail.y as number, width: 0, height: 0 } as DOMRect;
            playStickerFxOverlay('emoji-fx-' + (detail.key || String(detail.messageId)), detail.url, null, point);
            return;
        }
        const anchorEl = pickInteractionAnchor(bubble, detail.x, detail.y);
        const anchorRect = anchorEl ? anchorEl.getBoundingClientRect() : bubble.getBoundingClientRect();
        playStickerFxOverlay('emoji-fx-' + (detail.key || String(detail.messageId)), detail.url, anchorEl ?? bubble, anchorRect);
    };

    const onLocal = (e: Event) => {
        if (document.hidden) return;
        const detail = ((e as CustomEvent).detail || {}) as { messageId?: string; x?: number; y?: number };
        if (detail.messageId == null) return;
        runLocalInteractionFx(detail.messageId, detail.x, detail.y);
    };

    bindLifetimeListeners(window, {
        'tg-interaction-server-fx': onServerFx,
        'tg-interaction-local': onLocal,
    });
}

function playBurstFallback(bubble: HTMLElement, x?: number, y?: number): void {
    const big = isStandaloneMedia(bubble);
    const el = pickInteractionAnchor(bubble, x, y);
    let px: number;
    let py: number;
    if (el) {
        const r = el.getBoundingClientRect();
        px = r.left + r.width / 2;
        py = r.top + r.height / 2;
    } else {
        const r = bubble.getBoundingClientRect();
        px = r.left + r.width / 2;
        py = r.top + Math.min(r.height / 2, 60);
    }
    const tappedGlyph = el instanceof HTMLElement ? el.getAttribute('data-emoji') : null;
    if (tappedGlyph) {
        spawnEmojiBurst(px, py, { kind: 'text', value: tappedGlyph }, bubble, undefined, big);
        return;
    }
    let node: Element | null = null;
    if (el instanceof HTMLCanvasElement || el instanceof HTMLImageElement || el instanceof HTMLVideoElement) node = el;
    else if (el) node = el.querySelector('canvas, img, video');

    const vid = node instanceof HTMLVideoElement ? node : (node?.querySelector('video') as HTMLVideoElement | null);
    if (vid && vid.src) {
        playVideoEmojiFx(el ?? vid, vid, x, y, big);
        return;
    }
    if (node) {
        const source = resolveBurstSource(node, px, py);
        if (source.canvas || source.value) { spawnEmojiBurst(px, py, source, node, undefined, big); return; }
    }
    if (el) {
        const tile = snapshotSlotTile(el.getBoundingClientRect(), el.closest('.tgui-emoji-canvas-wrap') ?? bubble);
        if (tile) { spawnEmojiBurst(px, py, { kind: 'image', value: '', canvas: tile }, bubble, undefined, big); return; }
    }
    const m = (bubble.textContent || '').match(/\p{Extended_Pictographic}/u);
    if (m) spawnEmojiBurst(px, py, { kind: 'text', value: m[0] }, bubble, undefined, big);
}
