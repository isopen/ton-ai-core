export const PER_PAGE_MIN = 1;
export const PER_PAGE_MAX = 500;
export const FPS_GOOD = 50;
export const FPS_MID = 30;
export const FPS_MAX = 240;
export const BIG_CELL_SIZE = 160;
export const CELL_ROOT_MARGIN = '80px';
export const MAX_CELL_DPR = 2;
export const MAX_RENDER_PX = 320;

export function renderSize(size, devicePixelRatio) {
    const logical = Math.max(1, Math.floor(Number(size)) || 1);
    const dpr = Number(devicePixelRatio);
    const scale = Number.isFinite(dpr) && dpr > 1
        ? Math.min(MAX_CELL_DPR, dpr, Math.max(1, MAX_RENDER_PX / logical))
        : 1;
    return Math.max(logical, Math.round(logical * scale));
}

export function createCellObserver(onChange) {
    const IO = typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function'
        ? window.IntersectionObserver
        : null;
    if (!IO) return null;
    return new IO((entries) => {
        for (const entry of entries) onChange(entry.target, entry.isIntersecting);
    }, { rootMargin: CELL_ROOT_MARGIN });
}

export function isBigCell(size) {
    return Number(size) >= BIG_CELL_SIZE;
}

export function fpsLevel(fps) {
    const value = Number(fps);
    if (!Number.isFinite(value) || value <= 0) return 'idle';
    if (value >= FPS_GOOD) return 'good';
    if (value >= FPS_MID) return 'mid';
    return 'low';
}

export function frameRate(frames, totalMs) {
    const count = Number(frames) || 0;
    const ms = Number(totalMs) || 0;
    if (count <= 0 || ms <= 0) return 0;
    return Math.min(FPS_MAX, Math.round((count * 1000) / ms));
}

export function clampInt(value, min, max, fallback) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

export function parseSize(value, fallback) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return fallback;
    return n;
}

export function fileLabel(pack, sticker, index) {
    if (sticker) return sticker;
    return pack + ' ' + String(index + 1).padStart(2, '0');
}

export function formatMetrics(loadMs, renderMs) {
    const load = Number.isFinite(loadMs) ? Math.max(0, Math.round(loadMs)) : 0;
    const render = Number.isFinite(renderMs) && renderMs > 0 ? renderMs.toFixed(2) + ' ms' : '—';
    return 'load ' + load + ' ms\nrender ' + render;
}

export function filterFiles(files, query) {
    const list = Array.isArray(files) ? files : [];
    const q = String(query || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => {
        const hay = [item.name, item.pack, item.id, item.sticker].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
    });
}

export function groupByPack(files) {
    const list = Array.isArray(files) ? files : [];
    const groups = [];
    const index = new Map();
    for (const item of list) {
        const pack = item.pack || '';
        let group = index.get(pack);
        if (!group) {
            group = { pack, items: [] };
            index.set(pack, group);
            groups.push(group);
        }
        group.items.push(item);
    }
    return groups;
}

export function pageCount(total, perPage) {
    const t = Math.max(0, Number(total) || 0);
    const p = Math.max(1, Number(perPage) || 1);
    return Math.max(1, Math.ceil(t / p));
}

export function clampPage(page, total, perPage) {
    const n = pageCount(total, perPage);
    const p = Math.floor(Number(page) || 1);
    return Math.min(n, Math.max(1, p));
}

export function pageSlice(files, page, perPage) {
    const list = Array.isArray(files) ? files : [];
    const size = Math.max(1, Math.floor(Number(perPage) || 1));
    const p = clampPage(page, list.length, size);
    const from = (p - 1) * size;
    return list.slice(from, from + size);
}

export function formatRange(page, perPage, total) {
    const t = Math.max(0, Number(total) || 0);
    if (t === 0) return '0 of 0';
    const size = Math.max(1, Math.floor(Number(perPage) || 1));
    const p = clampPage(page, t, size);
    const from = (p - 1) * size + 1;
    const to = Math.min(t, p * size);
    return `${from}–${to} of ${t}`;
}
