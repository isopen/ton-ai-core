/**
 * Emoji/sticker tap-burst effect (Telegram-style "flying emoji").
 *
 * Each tap on a sticker or standalone emoji spawns a layer of particles that
 * fly out of the tap point in an upward fan, rotating and fading. Repeated
 * taps stack layers - more particles, longer flight - up to a hard cap so the
 * effect can never flood the main thread.
 */

import { playStickerFxOverlay } from './animated-sticker.js';
import { scheduleStickerClickFx } from './sticker-click-fx.js';
import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('gram-ui:emoji-burst');

const LAYER_CAP = 4;
const PARTICLES_PER_LAYER_BASE = 7;
const TOTAL_PARTICLE_CAP = 60;
const TAP_SESSION_MS = 2200;

/** Standalone media (a lone sticker or a single-emoji message) gets a
 *  proportionally larger click effect than inline text emoji particles. */
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

/**
 * Extract the particle image from any emoji drawable: canvas (crop the tile
 * under the tap for shared multi-emoji canvases), img src, or descend into
 * wrappers (slot/span/div) that merely contain a drawable.
 */
function snapshotVideoFrame(vid: HTMLVideoElement): string {
    try {
        if (!(vid.videoWidth > 0)) return '';
        // Cap the snapshot size: these are tiny flying particles, and PNG
        // keeps the alpha channel (JPEG would bake a black frame around
        // transparent video emoji).
        const maxSide = 96;
        const scale = Math.min(1, maxSide / Math.max(vid.videoWidth, vid.videoHeight));
        const tmp = document.createElement('canvas');
        tmp.width = Math.max(1, Math.round(vid.videoWidth * scale));
        tmp.height = Math.max(1, Math.round(vid.videoHeight * scale));
        tmp.getContext('2d')!.drawImage(vid, 0, 0, tmp.width, tmp.height);
        return tmp.toDataURL();
    } catch { /* cross-origin or not ready */ return ''; }
}

function resolveDrawableValue(node: Element, px: number, py: number): string {
    if (node instanceof HTMLCanvasElement && node.width > 0) {
        const cropped = snapshotCanvasAt(node, px, py);
        if (cropped) return cropped;
        try { return node.toDataURL(); } catch { return ''; }
    }
    if (node instanceof HTMLImageElement && node.src) {
        return node.src;
    }

    const vid = node.querySelector('video');
    if (vid instanceof HTMLVideoElement && vid.videoWidth > 0) {
        const frame = snapshotVideoFrame(vid);
        if (frame) return frame;
    }
    return '';
}

function centerDistance(el: Element, x: number, y: number): number {
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - x;
    const dy = r.top + r.height / 2 - y;
    return Math.hypot(dx, dy);
}

function snapshotCanvasAt(cv: HTMLCanvasElement, px: number, py: number, tileSize?: number): string | null {
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
        return tmp.toDataURL();
    } catch {
        return null;
    }
}

/** Crop a canvas region matching a slot rect (shared multi-emoji canvases). */
export function snapshotSlotFromCanvas(slotRect: DOMRect, scopeForCanvas: Element): string {
    let scv: HTMLCanvasElement | null = null;
    for (const c of Array.from(scopeForCanvas.querySelectorAll<HTMLCanvasElement>('canvas'))) {
        const r = c.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (slotRect.left >= r.left - 2 && slotRect.right <= r.right + 2 && slotRect.top >= r.top - 2 && slotRect.bottom <= r.bottom + 2) {
            scv = c;
            break;
        }
    }
    if (!scv) return '';
    try {
        const cr = scv.getBoundingClientRect();
        const scaleX = scv.width / (cr.width || 1);
        const scaleY = scv.height / (cr.height || 1);
        const tmp = document.createElement('canvas');
        tmp.width = Math.max(1, Math.round(slotRect.width * scaleX));
        tmp.height = Math.max(1, Math.round(slotRect.height * scaleY));
        const tctx = tmp.getContext('2d');
        if (!tctx) return '';
        tctx.drawImage(
            scv,
            Math.round((slotRect.left + slotRect.width / 2 - cr.left) * scaleX - tmp.width / 2),
            Math.round((slotRect.top + slotRect.height / 2 - cr.top) * scaleY - tmp.height / 2),
            tmp.width, tmp.height,
            0, 0, tmp.width, tmp.height,
        );
        return tmp.toDataURL();
    } catch {
        return '';
    }
}

export type BurstSource = { kind: 'image' | 'text' | 'video'; value: string };

const VIDEO_PARTICLE_CAP = 6;
let liveVideoParticles = 0;

function spawnParticle(
    x: number,
    y: number,
    source: BurstSource,
    layer: number,
    staticFrame?: string,
    size = 30,
    spread = 1,
): void {
    if (liveParticles >= TOTAL_PARTICLE_CAP) return;
    let node: HTMLElement;
    let isVideoParticle = false;
    if (source.kind === 'video' && liveVideoParticles < VIDEO_PARTICLE_CAP && !document.hidden) {
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
        if (source.kind === 'video' && !staticFrame) return;
        node = document.createElement('img');
        (node as HTMLImageElement).src = source.kind === 'video'
            ? staticFrame!
            : source.value;
    }
    // Single cssText assignment: appending later would silently override
    // the particle box (width:auto made video particles render at their
    // native size, detaching the burst from the tapped emoji).
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

export function spawnEmojiBurst(x: number, y: number, source: BurstSource, key: object, staticFrame?: string, big = false): void {
    if (document.hidden) return;
    const layerNode = ensureLayer();

    const now = Date.now();
    let session = tapSessions.get(key);
    if (!session || now - session.last > TAP_SESSION_MS) session = { count: 0, last: now };
    session.count = Math.min(session.count + 1, LAYER_CAP);
    session.last = now;
    tapSessions.set(key, session);

    const layers = session.count;
    const perLayer = PARTICLES_PER_LAYER_BASE + layers * 2;
    const size = big ? 56 : 30;
    const spread = big ? 1.35 : 1;

    for (let l = 0; l < layers; l++) {
        const n = Math.ceil(perLayer / layers);
        for (let i = 0; i < n; i++) {
            setTimeout(() => spawnParticle(x + rand(-10, 10), y + rand(-8, 8), source, l, staticFrame, size, spread), l * 90 + i * 12);
        }
    }
    void layerNode;
}

/**
 * Unified interaction pipeline: every tap on an emoji / sticker / video
 * emits exactly one request; resolvers (agent for emoji, chat-area sticker
 * effect thumbs) answer with either a server fx or an explicit local
 * hand-off. The local renderer runs ONLY from that hand-off branch, which
 * structurally guarantees a single animation per click.
 */
function dispatchInteractionRequest(detail: {
    messageId: string;
    mediaType: 'emoji' | 'sticker';
    x?: number;
    y?: number;
    slotIndex?: number;
    hasCanvasFx?: boolean;
}): void {
    if (!detail.messageId) return;
    window.dispatchEvent(new CustomEvent('tg-interaction-request', { detail }));
}

/** Short scale-pop of the tapped emoji itself (Telegram-style bounce). */
function popEmojiSlot(el: Element, big = false): void {
    try {
        el.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(' + (big ? 1.6 : 1.35) + ')', offset: 0.4 },
            { transform: 'scale(1)' },
        ], { duration: big ? 380 : 320, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    } catch { /* animate() unsupported */ }
}

/**
 * Fully local animated click effect for video custom emoji: live video
 * particles fly out of the tap point while the emoji itself pops. Runs only
 * after the server answered that it has no interaction animation for this
 * after the resolver answered that there is no server animation for it.
 */
export function playVideoEmojiFx(anchor: Element, vid: HTMLVideoElement, x?: number, y?: number, big = false): void {
    if (document.hidden) return;
    popEmojiSlot(anchor, big);
    const r = anchor.getBoundingClientRect();
    const px = x != null && r.width > 0 ? Math.max(r.left, Math.min(x, r.right)) : r.left + r.width / 2;
    const py = y != null && r.height > 0 ? Math.max(r.top, Math.min(y, r.bottom)) : r.top + r.height / 2;
    spawnEmojiBurst(px, py, { kind: 'video', value: vid.src }, vid, snapshotVideoFrame(vid), big);
}

let burstAttached = false;
let interactionsAttached = false;

/** Delegated click handler: attach once per app lifetime. */
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

            // Schedule the local canvas fx BEFORE the request: the server
            // overlay (when one exists) synchronously fires
            // tg-sticker-fx-overlay-started, which cancels this pending
            // effect. Reversed order would let the local fx survive and run
            // alongside the server animation.
            if (mainCv instanceof HTMLCanvasElement) {
                scheduleStickerClickFx(stickerEl, mainCv, rowId0.slice(4), x, y);
            }

            dispatchInteractionRequest({
                messageId: rowId0.slice(4),
                mediaType: 'sticker',
                x, y,
                hasCanvasFx: mainCv instanceof HTMLCanvasElement,
            });
            return;
        }

        const slotEl = (target.closest('.tgui-emoji-slot'))
            ?? ((document.elementFromPoint(x, y) as Element | null)?.closest('.tgui-emoji-slot') ?? null);

        // Animated-emoji taps inside chat messages play the server-provided
        // interaction animation (inputStickerSetAnimatedEmojiAnimations).
        const row = bubble.closest('[id^="msg-"]') as HTMLElement | null;
        const rowId = row ? row.id.slice(4) : '';
        // Dispatch only when the pointer actually hit an emoji: a slot/wrap,
        // an animated canvas, or a text leaf containing an emoji glyph.
        // Clicks on photos/videos (TelegramImage__img etc.) stay inert even
        // when the message has a caption with emojis.
        const emojiHit = !!target.closest('.tgui-emoji-slot, .tgui-emoji-canvas-wrap')
            || (target instanceof HTMLCanvasElement && target.classList.contains('tgui-animated-sticker'));
        let glyphHit = false;
        if (!emojiHit) {
            const under = document.elementFromPoint(x, y);
            const el = under && bubble.contains(under) ? under : null;
            if (el && el.children.length === 0
                && !(el instanceof HTMLImageElement) && !(el instanceof HTMLCanvasElement) && !(el instanceof HTMLVideoElement)) {
                glyphHit = /\p{Extended_Pictographic}/u.test(el.textContent || '');
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
            });
        }
    }, { passive: true });
}

/**
 * Animated-emoji click effects. The agent resolves the real animation document
 * from Telegram's inputStickerSetAnimatedEmojiAnimations set and answers the
 * unified request with either a server fx (tg-interaction-server-fx) or a
 * local hand-off (tg-interaction-local). Peer taps arrive as
 * sendMessageEmojiInteraction typing actions and reuse the same response
 * events without a request.
 */
function pickInteractionAnchor(bubble: Element, x?: number, y?: number): Element | null {
    const candidates = Array.from(bubble.querySelectorAll<Element>('.tgui-emoji-slot, .tgui-sticker-preview, canvas.tgui-animated-sticker'))
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

/**
 * Sole entry point of the local animation. Runs only from the
 * tg-interaction-local hand-off (the resolver answered "no server fx").
 */function runLocalInteractionFx(messageId: string, x?: number, y?: number): void {
    const bubble = document.getElementById('msg-' + messageId);
    if (!bubble) return;

    // Canvas TGS stickers: their pixel fx was already scheduled at click
    // time and is the sole local animation for them - nothing to add.
    if (bubble.querySelector('.tgui-sticker-preview canvas.tgui-animated-sticker')) return;

    // Video stickers: live video burst anchored to the preview box itself
    // (they have neither emoji slots nor canvases).
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

    window.addEventListener('tg-interaction-server-fx', (e: Event) => {
        if (document.hidden) return;
        const detail = ((e as CustomEvent).detail || {}) as { messageId?: string; url?: string; key?: string; x?: number; y?: number };
        if (!detail.url || detail.messageId == null) return;
        const bubble = document.getElementById('msg-' + detail.messageId);
        if (!bubble) return;

        // Anchor the effect to the emoji/sticker itself, not the whole bubble.
        const anchorEl = pickInteractionAnchor(bubble, detail.x, detail.y);
        const anchorRect = anchorEl ? anchorEl.getBoundingClientRect() : bubble.getBoundingClientRect();
        playStickerFxOverlay('emoji-fx-' + (detail.key || String(detail.messageId)), detail.url, anchorRect);
    });

    window.addEventListener('tg-interaction-local', (e: Event) => {
        if (document.hidden) return;
        const detail = ((e as CustomEvent).detail || {}) as { messageId?: string; x?: number; y?: number };
        if (detail.messageId == null) return;
        runLocalInteractionFx(detail.messageId, detail.x, detail.y);
    });
}

/** Old-style local burst used when no server animation exists for an emoji. */
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
    let node: Element | null = null;
    if (el instanceof HTMLCanvasElement || el instanceof HTMLImageElement || el instanceof HTMLVideoElement) node = el;
    else if (el) node = el.querySelector('canvas, img, video');

    const vid = node instanceof HTMLVideoElement ? node : (node?.querySelector('video') as HTMLVideoElement | null);
    if (vid && vid.src) {
        playVideoEmojiFx(el ?? vid, vid, x, y, big);
        return;
    }
    if (node) {
        const value = resolveDrawableValue(node, px, py);
        if (value) { spawnEmojiBurst(px, py, { kind: 'image', value }, node, undefined, big); return; }
    }
    if (el) {
        const v = snapshotSlotFromCanvas(el.getBoundingClientRect(), el.closest('.tgui-emoji-canvas-wrap') ?? bubble);
        if (v) { spawnEmojiBurst(px, py, { kind: 'image', value: v }, bubble, undefined, big); return; }
    }
    const m = (bubble.textContent || '').match(/\p{Extended_Pictographic}/u);
    if (m) spawnEmojiBurst(px, py, { kind: 'text', value: m[0] }, bubble, undefined, big);
}
