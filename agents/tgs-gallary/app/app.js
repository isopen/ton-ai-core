import { BaseAgent } from './vendor/ton-ai-core/agent/index.js';
import { h } from './vendor/atom/jsx-runtime.js';
import { render } from './vendor/atom/render.js';
import { useEffect, useRef, useState } from './vendor/atom/hooks.js';
import initTgs, { TgsRender, getMemory } from './vendor/tgs/tgs_wasm.js';
import { PACKS, COUNT, BYTES, EMPTY, BUILD } from './fixtures/manifest.js';
import {
    FPS_MAX,
    PER_PAGE_MAX,
    PER_PAGE_MIN,
    clampInt,
    clampPage,
    createCellObserver,
    fileLabel,
    filterFiles,
    formatMetrics,
    formatRange,
    fpsLevel,
    frameRate,
    groupByPack,
    isBigCell,
    pageCount,
    pageSlice,
    parseSize,
} from './gallery-core.js';

const FILES = [];
for (const [pack, items] of PACKS) {
    items.forEach(([id, sticker, fr, shard, offset, size], index) => {
        FILES.push({
            pack,
            id,
            fr,
            shard,
            offset,
            size,
            name: fileLabel(pack, sticker, index),
            file: `fixtures/${pack}/${id}.tgs`,
        });
    });
}

function detectBridge() {
    const tg = typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp
        ? window.Telegram.WebApp
        : null;
    if (tg) {
        try { tg.ready(); } catch {}
        try { tg.expand(); } catch {}
    }
    return tg;
}

class GalleryAgent extends BaseAgent {
    constructor() {
        super({ name: 'tgs-gallary' });
        this.bridge = null;
        this.manifest = null;
    }

    async onInitialize() {
        this.bridge = detectBridge();
    }

    async onStart() {
        this.manifest = { count: COUNT, bytes: BYTES, files: FILES };
        this.emit('manifest', this.manifest);
    }

    async onStop() {}

    callSkill(method, params) {
        const tg = this.bridge;
        return new Promise((resolve, reject) => {
            if (!tg || !tg.Serverless || typeof tg.Serverless.call !== 'function') {
                reject(new Error('Mini App bridge unavailable'));
                return;
            }
            try {
                tg.Serverless.call(method, params, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    fixtureStats() {
        return this.callSkill('fixtureStats', {});
    }
}

const agent = new GalleryAgent();
let wasmReady = null;

function ensureWasm() {
    if (wasmReady === null) wasmReady = initTgs();
    return wasmReady;
}

const INV = new Uint32Array(256);
for (let a = 1; a < 256; a++) INV[a] = Math.round((255 * 65536) / a);

function unpremulInto(src, dst) {
    for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        if (a === 255) {
            dst[i] = src[i];
            dst[i + 1] = src[i + 1];
            dst[i + 2] = src[i + 2];
            dst[i + 3] = 255;
        } else if (a === 0) {
            dst[i] = 0;
            dst[i + 1] = 0;
            dst[i + 2] = 0;
            dst[i + 3] = 0;
        } else {
            const f = INV[a];
            const r = (src[i] * f) >> 16;
            const g = (src[i + 1] * f) >> 16;
            const b = (src[i + 2] * f) >> 16;
            dst[i] = r > 255 ? 255 : r;
            dst[i + 1] = g > 255 ? 255 : g;
            dst[i + 2] = b > 255 ? 255 : b;
            dst[i + 3] = a;
        }
    }
}

const SHARD_CACHE_MAX = 16;
const shardCache = new Map();

function loadShard(name) {
    let pending = shardCache.get(name);
    if (!pending) {
        pending = fetch('./fixtures/data/' + name + '?v=' + BUILD, { cache: 'force-cache' })
            .then(async (res) => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return new Uint8Array(await res.arrayBuffer());
            });
        pending.catch(() => shardCache.delete(name));
        shardCache.set(name, pending);
        if (shardCache.size > SHARD_CACHE_MAX) {
            const oldest = shardCache.keys().next().value;
            shardCache.delete(oldest);
        }
    }
    return pending;
}

async function loadFixture(item) {
    const shard = await loadShard(item.shard);
    const buf = shard.subarray(item.offset, item.offset + item.size);
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('DecompressionStream is unavailable');
        }
        const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
        return await new Response(stream).text();
    }
    return new TextDecoder().decode(buf);
}

const cellObserver = createCellObserver((target, visible) => {
    const notify = target.__tgsCellVisible;
    if (notify) notify(visible);
});

function EmojiCell(props) {
    const { item, size, pausedAll } = props;
    const canvasRef = useRef(null);
    const metricsRef = useRef(null);
    const [paused, setPaused] = useState(false);
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState('');
    const pausedRef = useRef(false);
    const pausedAllRef = useRef(false);

    pausedRef.current = paused;
    pausedAllRef.current = pausedAll;

    useEffect(() => {
        let disposed = false;
        let renderer = null;
        let raf = 0;
        let image = null;
        let ctx = null;
        let started = false;
        let animReady = false;
        let visible = !cellObserver;
        let last = 0;
        let time = 0;
        let frame = -1;
        let renderMs = 0;
        let lastMetrics = 0;
        let frames = 1;
        let inFrame = 0;
        let srcFps = 60;
        let loadMs = 0;

        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const metrics = metricsRef.current;
        const show = (text) => {
            if (metrics) metrics.textContent = text;
        };

        const loop = (now) => {
            raf = 0;
            if (disposed || !visible || !animReady) return;
            raf = requestAnimationFrame(loop);
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            if (!pausedRef.current && !pausedAllRef.current) time += dt;
            const want = Math.floor(time * srcFps);
            if (want === frame) return;
            frame = want;

            const t0 = performance.now();
            renderer.render(inFrame + (frame % frames), size, size);
            const src = new Uint8Array(getMemory().buffer, renderer.data_ptr(), renderer.data_len());
            unpremulInto(src, image.data);
            ctx.putImageData(image, 0, 0);
            const cost = performance.now() - t0;
            renderMs = renderMs === 0 ? cost : renderMs * 0.85 + cost * 0.15;
            if (now - lastMetrics >= 500) {
                lastMetrics = now;
                show(formatMetrics(loadMs, renderMs));
            }
        };

        const start = async () => {
            if (started || disposed) return;
            started = true;
            try {
                const startedAt = performance.now();
                const json = await loadFixture(item);
                if (disposed) return;
                renderer = new TgsRender(json, size, size);
                loadMs = performance.now() - startedAt;
                if (disposed) {
                    renderer.free();
                    renderer = null;
                    return;
                }
                frames = Math.max(1, renderer.frame_count());
                inFrame = renderer.in_frame();
                srcFps = item.fr > 0 ? item.fr : 60;
                ctx = canvas.getContext('2d');
                image = ctx.createImageData(size, size);

                let hasPixels = false;
                for (let f = 0; f < Math.min(frames, 8) && !hasPixels; f++) {
                    renderer.render(inFrame + f, size, size);
                    const probe = new Uint8Array(getMemory().buffer, renderer.data_ptr(), renderer.data_len());
                    for (let i = 3; i < probe.length; i += 4) {
                        if (probe[i] !== 0) { hasPixels = true; break; }
                    }
                }
                if (!hasPixels) {
                    if (!disposed) {
                        show(formatMetrics(loadMs, 0));
                        setStatus('empty');
                    }
                    return;
                }
                if (disposed) return;
                animReady = true;
                setStatus('ok');
                if (visible && !raf) {
                    last = performance.now();
                    raf = requestAnimationFrame(loop);
                }
            } catch (e) {
                if (!disposed) {
                    show('load failed');
                    setStatus('error');
                    setError(e && e.message ? e.message : String(e));
                }
            }
        };

        const setCellVisible = (value) => {
            if (disposed) return;
            visible = value;
            if (value) {
                start();
                if (animReady && raf === 0) {
                    last = performance.now();
                    raf = requestAnimationFrame(loop);
                }
            } else if (raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }
        };

        canvas.__tgsCellVisible = setCellVisible;
        if (cellObserver) cellObserver.observe(canvas);
        else setCellVisible(true);

        return () => {
            disposed = true;
            if (cellObserver) cellObserver.unobserve(canvas);
            if (canvas.__tgsCellVisible === setCellVisible) delete canvas.__tgsCellVisible;
            if (raf) cancelAnimationFrame(raf);
            if (renderer) {
                try { renderer.free(); } catch {}
            }
        };
    }, [item.file, size]);

    const classes = ['cell'];
    if (status === 'loading') classes.push('loading');
    if (status === 'error') classes.push('error');
    if (status === 'empty') classes.push('empty-cell');
    if (paused || pausedAll) classes.push('paused');
    if (isBigCell(size)) classes.push('big');

    return h('div', {
        class: classes.join(' '),
        title: item.file,
        onClick: () => {
            if (status === 'ok') setPaused(!paused);
        },
    }, [
        h('canvas', { ref: canvasRef, width: size, height: size }),
        h('div', { class: 'name' }, item.name),
        h('div', { class: 'metrics', ref: metricsRef }),
        status === 'empty' ? h('div', { class: 'note' }, 'no visible layers') : null,
        status === 'error' ? h('div', { class: 'err' }, error) : null,
    ]);
}

let currentFps = 0;

const FPS_WINDOW_MS = 1000;
const MIN_FRAME_MS = 1000 / FPS_MAX;

function FpsMeter() {
    const boxRef = useRef(null);
    const valueRef = useRef(null);

    useEffect(() => {
        const box = boxRef.current;
        const value = valueRef.current;
        if (!box || !value) return undefined;

        value.textContent = currentFps ? String(currentFps) : '—';
        box.className = 'fps ' + fpsLevel(currentFps);

        let raf = 0;
        let frames = 0;
        let totalMs = 0;
        let lastFrame = 0;
        let windowStart = performance.now();

        const tick = (now) => {
            raf = requestAnimationFrame(tick);
            if (lastFrame > 0) {
                const delta = now - lastFrame;
                if (delta > 0 && delta <= 1000) {
                    frames += 1;
                    totalMs += Math.max(delta, MIN_FRAME_MS);
                }
            }
            lastFrame = now;
            if (now - windowStart < FPS_WINDOW_MS) return;
            if (frames > 0) {
                currentFps = frameRate(frames, totalMs);
                value.textContent = String(currentFps);
                box.className = 'fps ' + fpsLevel(currentFps);
                box.title = 'Page frame rate: ' + currentFps + ' FPS';
            }
            frames = 0;
            totalMs = 0;
            windowStart = now;
        };

        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    return h('div', {
        class: 'fps ' + fpsLevel(currentFps),
        ref: boxRef,
        title: currentFps ? 'Page frame rate: ' + currentFps + ' FPS' : 'Measuring page frame rate…',
    }, [
        h('span', { class: 'fps-value', ref: valueRef }),
        h('span', { class: 'fps-unit' }, 'FPS'),
    ]);
}

function Pager(props) {
    const { page, total, perPage, onPage } = props;
    const pages = pageCount(total, perPage);
    const [draft, setDraft] = useState(String(page));

    useEffect(() => {
        setDraft(String(page));
    }, [page]);

    const jump = (value) => {
        const n = parseInt(value, 10);
        onPage(Number.isFinite(n) ? clampPage(n, total, perPage) : page);
    };
    const button = (text, disabled, target) => h('button', {
        type: 'button',
        class: 'pbtn',
        disabled,
        onClick: () => onPage(target),
    }, text);

    return h('div', { class: 'pager' }, [
        button('«', page <= 1, 1),
        button('‹', page <= 1, page - 1),
        h('span', { class: 'muted' }, 'page'),
        h('input', {
            class: 'page-input',
            type: 'text',
            inputMode: 'numeric',
            value: draft,
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => {
                if (e.key === 'Enter') jump(e.target.value);
            },
            onBlur: (e) => jump(e.target.value),
        }),
        h('span', { class: 'muted' }, '/ ' + pages),
        button('›', page >= pages, page + 1),
        button('»', page >= pages, pages),
        h('span', { class: 'range' }, formatRange(page, perPage, total)),
    ]);
}

function App() {
    const [manifest, setManifest] = useState(null);
    const [failure, setFailure] = useState('');
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(50);
    const [cellSize, setCellSize] = useState(64);
    const [query, setQuery] = useState('');
    const [grouped, setGrouped] = useState(false);
    const [pausedAll, setPausedAll] = useState(false);
    const [serverStats, setServerStats] = useState('');

    useEffect(() => {
        let alive = true;
        const onManifest = (m) => {
            if (alive) setManifest(m);
        };
        agent.on('manifest', onManifest);
        (async () => {
            try {
                await ensureWasm();
                await agent.initialize();
                await agent.start();
                if (alive && agent.manifest) onManifest(agent.manifest);
                try {
                    const stats = await agent.fixtureStats();
                    if (alive && stats && typeof stats.count === 'number') {
                        setServerStats('server: ' + stats.count + ' emoji');
                    }
                } catch {}
            } catch (e) {
                if (alive) setFailure(e && e.message ? e.message : String(e));
            }
        })();
        return () => {
            alive = false;
            agent.off('manifest', onManifest);
        };
    }, []);

    const files = manifest && Array.isArray(manifest.files) ? manifest.files : [];
    const filtered = filterFiles(files, query);
    const total = filtered.length;
    const safePage = clampPage(page, total, perPage);
    const visible = pageSlice(filtered, safePage, perPage);
    const packs = new Set(filtered.map((item) => item.pack)).size;

    const cell = (item) => h(EmojiCell, {
        key: item.file,
        item,
        size: cellSize,
        pausedAll,
    });

    let content;
    if (visible.length === 0) {
        content = h('div', { class: 'empty' },
            manifest
                ? (query ? 'nothing found for “' + query + '”' : 'no emoji')
                : 'loading…');
    } else if (grouped) {
        const totals = new Map();
        for (const item of filtered) totals.set(item.pack, (totals.get(item.pack) || 0) + 1);
        content = [];
        for (const group of groupByPack(visible)) {
            content.push(h('div', { class: 'group', key: 'group:' + group.pack }, [
                h('span', { class: 'group-name' }, group.pack),
                h('span', { class: 'group-count' }, (totals.get(group.pack) || group.items.length) + ' emoji'),
            ]));
            for (const item of group.items) content.push(cell(item));
        }
    } else {
        content = visible.map(cell);
    }

    const totalLabel = query ? total + ' / ' + files.length + ' emoji' : total + ' emoji';
    const skipped = EMPTY.length ? ' · ' + EMPTY.length + ' empty skipped' : '';
    const statsLine = manifest
        ? totalLabel + ' · ' + packs + ' packs · ' + pageCount(total, perPage) + ' pages' + skipped + (serverStats ? ' · ' + serverStats : '')
        : 'loading emoji…';

    const commitPerPage = (e) => {
        const n = clampInt(e.target.value, PER_PAGE_MIN, PER_PAGE_MAX, perPage);
        e.target.value = String(n);
        setPerPage(n);
        setPage(1);
    };
    const commitSize = (e) => {
        const n = parseSize(e.target.value, cellSize);
        e.target.value = String(n);
        setCellSize(n);
    };

    return h('div', { class: 'app' }, [
        h('header', { class: 'top' }, [
            h('div', { class: 'titles' }, [
                h('h1', null, 'TGS Gallary'),
                h('div', { class: 'stats' }, failure ? 'error: ' + failure : statsLine),
            ]),
            h('div', { class: 'controls' }, [
                h('input', {
                    class: 'search',
                    type: 'search',
                    placeholder: 'Search emoji…',
                    value: query,
                    onInput: (e) => {
                        setQuery(e.target.value);
                        setPage(1);
                    },
                }),
                h('label', null, [
                    'per page',
                    h('input', {
                        class: 'num',
                        type: 'number',
                        min: PER_PAGE_MIN,
                        max: PER_PAGE_MAX,
                        step: 1,
                        value: String(perPage),
                        onChange: commitPerPage,
                    }),
                ]),
                h('label', null, [
                    'size',
                    h('input', {
                        class: 'num',
                        type: 'number',
                        step: 1,
                        value: String(cellSize),
                        onChange: commitSize,
                    }),
                ]),
                h(FpsMeter),
                h('button', {
                    type: 'button',
                    class: grouped ? 'pbtn active' : 'pbtn',
                    onClick: () => {
                        setGrouped(!grouped);
                    },
                }, grouped ? 'Grouped by pack' : 'Group by pack'),
                h('button', {
                    type: 'button',
                    class: 'pbtn',
                    onClick: () => setPausedAll(!pausedAll),
                }, pausedAll ? 'Resume all' : 'Pause all'),
            ]),
        ]),
        h(Pager, { page: safePage, total, perPage, onPage: setPage }),
        h('main', { class: 'grid', style: { '--cell': cellSize + 'px' } }, content),
        h(Pager, { page: safePage, total, perPage, onPage: setPage }),
        h('footer', { class: 'foot' },
            'Click an emoji to pause/resume. Rust/WASM from @ton-ai/tgs, UI on @ton-ai/atom.'),
    ]);
}

const container = document.getElementById('root');
if (container) render(App, container);
