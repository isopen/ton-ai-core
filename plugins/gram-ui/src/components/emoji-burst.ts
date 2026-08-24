/**
 * Emoji/sticker tap-burst effect (Telegram-style "flying emoji").
 *
 * Each tap on a sticker or standalone emoji spawns a layer of particles that
 * fly out of the tap point in an upward fan, rotating and fading. Repeated
 * taps stack layers - more particles, longer flight - up to a hard cap so the
 * effect can never flood the main thread.
 */

import { replayAnimatedCanvas, playStickerFxOverlay } from './animated-sticker.js';

const LAYER_CAP = 4;
const PARTICLES_PER_LAYER_BASE = 7;
const TOTAL_PARTICLE_CAP = 60;
const TAP_SESSION_MS = 2200;

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
        try {
            const tmp = document.createElement('canvas');
            tmp.width = vid.videoWidth;
            tmp.height = vid.videoHeight;
            tmp.getContext('2d')!.drawImage(vid, 0, 0);
            return tmp.toDataURL('image/jpeg', 0.92);
        } catch { /* cross-origin or not ready - fall through */ }
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

function spawnParticle(
    x: number,
    y: number,
    source: { kind: 'image' | 'text'; value: string },
    layer: number,
): void {
    if (liveParticles >= TOTAL_PARTICLE_CAP) return;
    const node = source.kind === 'image'
        ? document.createElement('img')
        : document.createElement('span');
    if (source.kind === 'image') {
        (node as HTMLImageElement).src = source.value;
        node.style.width = '30px';
        node.style.height = '30px';
        node.style.objectFit = 'contain';
    } else {
        node.textContent = source.value;
        node.style.fontSize = '30px';
        node.style.lineHeight = '1';
    }
    node.style.cssText += ';position:fixed;left:' + x + 'px;top:' + y + 'px;width:auto;height:auto;'
        + 'margin-left:-15px;margin-top:-15px;pointer-events:none;will-change:transform,opacity';

    const angleDeg = rand(-155, -25);
    const angle = (angleDeg * Math.PI) / 180;
    const distScale = 0.85 + layer * 0.22;
    const dist = rand(130, 300) * distScale;
    const dx = Math.cos(angle) * dist;
    const dyUp = Math.sin(angle) * dist;
    const drift = rand(-60, 60);
    const rot = rand(-220, 220);
    const duration = rand(900, 1400) + layer * 140;

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
    animation.finished.then(() => {
        node.remove();
        liveParticles--;
    }).catch(() => {
        node.remove();
        liveParticles--;
    });

    layerEl!.appendChild(node);
}

export function spawnEmojiBurst(x: number, y: number, source: { kind: 'image' | 'text'; value: string }, key: object): void {
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

    for (let l = 0; l < layers; l++) {
        const n = Math.ceil(perLayer / layers);
        for (let i = 0; i < n; i++) {
            setTimeout(() => spawnParticle(x + rand(-10, 10), y + rand(-8, 8), source, l), l * 90 + i * 12);
        }
    }
    void layerNode;
}

/** Forward a tap on an animated emoji message to the agent for server-side resolution. */
function dispatchLocalEmojiClick(messageId: string, x?: number, y?: number, slotIndex?: number): void {
    if (!messageId) return;
    window.dispatchEvent(new CustomEvent('tg-local-emoji-click', { detail: { messageId, x, y, slotIndex } }));
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
            const mainCv = stickerEl.querySelector(':scope > .tgui-sticker-preview canvas.tgui-animated-sticker');
            if (mainCv) replayAnimatedCanvas(mainCv);
            const rowId = stickerEl.closest('[id^="msg-"]')?.id || '';
            window.dispatchEvent(new CustomEvent('tg-sticker-fx', { detail: { messageId: rowId.slice(4) } }));
            return;
        }

        const slotEl = (target.closest('.tgui-emoji-slot'))
            ?? ((document.elementFromPoint(x, y) as Element | null)?.closest('.tgui-emoji-slot') ?? null);

        // Animated-emoji taps inside chat messages play the server-provided
        // interaction animation (inputStickerSetAnimatedEmojiAnimations).
        // Only actual emoji elements qualify - photos, videos and plain text
        // bubbles share the same MessageBubble class and must not trigger it.
        const row = bubble.closest('[id^="msg-"]') as HTMLElement | null;
        const rowId = row ? row.id.slice(4) : '';
        const emojiHit = !!target.closest('.tgui-emoji-slot, .tgui-emoji-canvas-wrap')
            || (target instanceof HTMLCanvasElement && target.classList.contains('tgui-animated-sticker'));
        if (rowId && emojiHit && !target.closest('.tgui-reaction')) {
            const slots = Array.from(bubble.querySelectorAll('.tgui-emoji-slot'));
            const slotIdx = slotEl ? slots.indexOf(slotEl) : -1;
            dispatchLocalEmojiClick(rowId, x, y, slotIdx >= 0 ? slotIdx : undefined);
            return;
        }

        if (slotEl) {
            const own = slotEl.querySelector('canvas, img');
            if (own instanceof HTMLCanvasElement) {
                const v = resolveDrawableValue(own, x, y);
                if (v) { spawnEmojiBurst(x, y, { kind: 'image', value: v }, slotEl); return; }
            } else if (own instanceof HTMLImageElement && own.src) {
                spawnEmojiBurst(x, y, { kind: 'image', value: own.src }, slotEl);
                return;
            }

            const sr = slotEl.getBoundingClientRect();
            const scopeForCanvas = slotEl.closest('.tgui-emoji-canvas-wrap') ?? bubble;
            const val = snapshotSlotFromCanvas(sr, scopeForCanvas);
            if (val) { spawnEmojiBurst(x, y, { kind: 'image', value: val }, slotEl); return; }
        }

        let node: Element | null = null;
        const isEmojiDrawable = (n: Element): boolean =>
            (n instanceof HTMLCanvasElement && n.classList.contains('tgui-animated-sticker'))
            || !!n.closest('.tgui-emoji-slot, .tgui-emoji-canvas-wrap, .tgui-sticker-preview');

        if (isEmojiDrawable(target)) {
            node = target;
        }
        if (!node) {
            const under = document.elementFromPoint(x, y);
            if (under && bubble.contains(under) && isEmojiDrawable(under)) {
                node = under;
            }
        }
        if (!node) {
            let bestD = Infinity;
            for (const c of Array.from(bubble.querySelectorAll<HTMLCanvasElement | HTMLImageElement | HTMLVideoElement>('canvas, img, video'))) {
                if (!isEmojiDrawable(c)) continue;
                const d = centerDistance(c, x, y);
                if (d < bestD) { bestD = d; node = c; }
            }
        }
        if (!node) {
            const under = document.elementFromPoint(x, y);
            const glyphEl = (under && bubble.contains(under)) ? under : target;
            const glyphMatch = ((glyphEl.textContent || '') + '')
                .match(/\p{Extended_Pictographic}/u)
                || (bubble.textContent || '').match(/\p{Extended_Pictographic}/u);
            if (!glyphMatch) return;
            spawnEmojiBurst(x, y, { kind: 'text', value: glyphMatch[0] }, bubble);
            return;
        }

        const value = resolveDrawableValue(node, x, y);
        if (!value) {
            const glyphEl = node || target;
            const glyphMatch = ((glyphEl.textContent || '') + '')
                .match(/\p{Extended_Pictographic}/u);
            if (!glyphMatch) return;
            spawnEmojiBurst(x, y, { kind: 'text', value: glyphMatch[0] }, node);
            return;
        }

        spawnEmojiBurst(x, y, { kind: 'image', value }, node);
    }, { passive: true });
}

/**
 * Animated-emoji click effects. The agent resolves the real animation document
 * from Telegram's inputStickerSetAnimatedEmojiAnimations set and hands us a
 * playable URL via `tg-play-emoji-fx` (peer taps arrive as
 * sendMessageEmojiInteraction typing actions, local taps are forwarded too).
 */
function pickEmojiAnchor(bubble: Element, x?: number, y?: number): Element | null {
    const candidates = Array.from(bubble.querySelectorAll<Element>('.tgui-emoji-slot, canvas.tgui-animated-sticker'))
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

/** Old-style local burst used when no server animation exists for an emoji. */
function playBurstFallback(bubble: HTMLElement, x?: number, y?: number): void {
    const el = pickEmojiAnchor(bubble, x, y);
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
    else if (el) node = el.querySelector('canvas, img');
    if (node) {
        const value = resolveDrawableValue(node, px, py);
        if (value) { spawnEmojiBurst(px, py, { kind: 'image', value }, node); return; }
    }
    if (el) {
        const v = snapshotSlotFromCanvas(el.getBoundingClientRect(), el.closest('.tgui-emoji-canvas-wrap') ?? bubble);
        if (v) { spawnEmojiBurst(px, py, { kind: 'image', value: v }, bubble); return; }
    }
    const m = (bubble.textContent || '').match(/\p{Extended_Pictographic}/u);
    if (m) spawnEmojiBurst(px, py, { kind: 'text', value: m[0] }, bubble);
}

export function attachEmojiInteractions(): void {
    if (typeof window === 'undefined' || interactionsAttached) return;
    interactionsAttached = true;
    window.addEventListener('tg-play-emoji-fx', (e: Event) => {
        if (document.hidden) return;
        const detail = ((e as CustomEvent).detail || {}) as { messageId?: string; url?: string; key?: string; x?: number; y?: number };
        if (!detail.url || detail.messageId == null) return;
        const bubble = document.getElementById('msg-' + detail.messageId);
        if (!bubble) return;

        // Anchor the effect to the emoji itself, not the whole bubble.
        const anchorEl = pickEmojiAnchor(bubble, detail.x, detail.y);
        const anchorRect = anchorEl ? anchorEl.getBoundingClientRect() : bubble.getBoundingClientRect();
        playStickerFxOverlay('emoji-fx-' + (detail.key || String(detail.messageId)), detail.url, anchorRect);
    });
    window.addEventListener('tg-emoji-fx-fallback', (e: Event) => {
        if (document.hidden) return;
        const detail = ((e as CustomEvent).detail || {}) as { messageId?: string; x?: number; y?: number };
        if (detail.messageId == null) return;
        const bubble = document.getElementById('msg-' + detail.messageId);
        if (!bubble) return;
        playBurstFallback(bubble, detail.x, detail.y);
    });
}
