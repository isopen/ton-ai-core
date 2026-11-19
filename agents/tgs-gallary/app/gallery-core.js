export const FPS_OPTIONS = [15, 30, 60];
export const PER_PAGE_MIN = 1;
export const PER_PAGE_MAX = 500;
export const SIZE_MIN = 32;
export const SIZE_MAX = 320;

export function clampInt(value, min, max, fallback) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
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
