/**
 * Emoji/sticker tap-burst effect (Telegram-style "flying emoji").
 *
 * Each tap on a sticker or standalone emoji spawns a layer of particles that
 * fly out of the tap point in an upward fan, rotating and fading. Repeated
 * taps stack layers - more particles, longer flight - up to a hard cap so the
 * effect can never flood the main thread.
 */

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
    // Video stickers: snapshot the currently displayed frame.
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
        // Tile size: explicit (mapped slot rect) or the full smaller dimension.
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

    // Upward fan: angle around -90 deg with wide spread; farther layers fly
    // higher and wider.
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
            // Small stagger between layers so consecutive taps read as waves.
            setTimeout(() => spawnParticle(x + rand(-10, 10), y + rand(-8, 8), source, l), l * 90 + i * 12);
        }
    }
    void layerNode;
}

/** Delegated click handler: attach once per app lifetime. */
export function attachEmojiBurst(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('click', (e: MouseEvent) => {
        if (document.hidden) return;
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        const x = e.clientX;
        const y = e.clientY;

        // Scope: the chat bubble that was tapped. Every emoji-bearing drawable
        // lives inside it (animated canvases, custom-emoji slots, webp imgs).
        const bubble = target.closest('.MessageBubble');
        if (!bubble) return;

        // A) Custom-emoji slots: shared-canvas or own-canvas rendering.
        //    The slot reserves inline space; pixels live either in its own
        //    canvas or in one shared canvas overlaying the whole wrap.
        const slotEl = (target.closest('.tgui-emoji-slot'))
            ?? ((document.elementFromPoint(x, y) as Element | null)?.closest('.tgui-emoji-slot') ?? null);
        if (slotEl) {
            const own = slotEl.querySelector('canvas, img');
            if (own instanceof HTMLCanvasElement) {
                const v = resolveDrawableValue(own, x, y);
                if (v) { spawnEmojiBurst(x, y, { kind: 'image', value: v }, slotEl); return; }
            } else if (own instanceof HTMLImageElement && own.src) {
                spawnEmojiBurst(x, y, { kind: 'image', value: own.src }, slotEl);
                return;
            }
            // Shared-canvas mode: locate the overlaying canvas that contains
            // this slot's rect, and crop the tile at the slot's center.
            const sr = slotEl.getBoundingClientRect();
            const scopeForCanvas = slotEl.closest('.tgui-emoji-canvas-wrap') ?? bubble;
            let scv: HTMLCanvasElement | null = null;
            for (const c of Array.from(scopeForCanvas.querySelectorAll<HTMLCanvasElement>('canvas'))) {
                const r = c.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) continue;
                if (sr.left >= r.left - 2 && sr.right <= r.right + 2 && sr.top >= r.top - 2 && sr.bottom <= r.bottom + 2) {
                    scv = c;
                    break;
                }
            }
            if (scv) {
                const cr = scv.getBoundingClientRect();
                // Map the SLOT rect into shared-canvas pixel space and crop
                // exactly that region: the sheet contains every emoji view of
                // the message, so a generic square crop would grab neighbors.
                const scaleX = scv.width / (cr.width || 1);
                const scaleY = scv.height / (cr.height || 1);
                const cxp = (sr.left + sr.width / 2 - cr.left) * scaleX;
                const cyp = (sr.top + sr.height / 2 - cr.top) * scaleY;
                const halfW = Math.max(1, Math.round(sr.width * scaleX / 2));
                const halfH = Math.max(1, Math.round(sr.height * scaleY / 2));
                const tmp = document.createElement('canvas');
                tmp.width = Math.round(sr.width * scaleX);
                tmp.height = Math.round(sr.height * scaleY);
                const tctx = tmp.getContext('2d');
                if (!tctx) return;
                tctx.drawImage(
                    scv,
                    Math.round(cxp - tmp.width / 2), Math.round(cyp - tmp.height / 2),
                    tmp.width, tmp.height,
                    0, 0, tmp.width, tmp.height,
                );
                const val = tmp.toDataURL();
                if (val) { spawnEmojiBurst(x, y, { kind: 'image', value: val }, slotEl); return; }
            }
        }

        // Resolve THE emoji drawable under the finger:
        //   a) the tap target itself when it is an emoji drawable;
        //   b) whatever elementFromPoint resolves to inside the bubble;
        //   c) otherwise the nearest-by-center emoji drawable in the bubble.
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
            // No canvas/img here - this is a plain unicode emoji rendered as
            // text. Use the character itself as the flying content.
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
            // No drawable bytes under the tap: fall back to the glyph itself.
            const glyphEl = node || target;
            const glyphMatch = ((glyphEl.textContent || '') + '')
                .match(/\p{Extended_Pictographic}/u);
            if (!glyphMatch) return;
            spawnEmojiBurst(x, y, { kind: 'text', value: glyphMatch[0] }, node);
            return;
        }

        // Tap session is per-drawable: every emoji counts taps separately and
        // bursts strictly from its own position.
        spawnEmojiBurst(x, y, { kind: 'image', value }, node);
    }, { passive: true });
}
