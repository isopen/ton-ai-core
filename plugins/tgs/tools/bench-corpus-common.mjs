// Shared corpus-benchmark plumbing: size list, per-file measurement across render sizes.
// Used by bench-corpus.mjs (sequential) and bench-corpus-worker.mjs (parallel shards).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isAbsolute, join, relative } from 'node:path';
import { deepStrictEqual } from 'node:assert';

export const DEFAULT_SIZES = [64, 320, 720];

export function collectCorpus({ args, repoRoot, defaultDir }) {
    const files = new Set();
    let emptySkipped = 0;
    const scanDir = (dir) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.isDirectory()) { scanDir(join(dir, e.name)); continue; }
            if (!e.name.endsWith('.tgs')) continue;
            const p = join(dir, e.name);
            try {
                const st = statSync(p);
                if (!st.isFile()) continue;
                if (st.size === 0) { emptySkipped++; continue; }
                files.add(p);
            } catch { }
        }
    };
    if (args.length > 0) {
        for (const a of args) {
            const p = isAbsolute(a) ? a : join(repoRoot, a);
            const st = statSync(p);
            if (st.isDirectory()) scanDir(p); else files.add(p);
        }
    } else {
        scanDir(join(repoRoot, defaultDir));
    }
    const list = [...files].sort();
    const packRoot = list.length ? list[0].split(/[\\/]/).slice(0, -2).join('/') : repoRoot;
    return { list, emptySkipped, packRoot };
}

export function capFiles(list, maxCap) {
    if (!(maxCap > 0) || list.length <= maxCap) return list.slice();
    const step = list.length / maxCap;
    const keep = [];
    for (let i = 0; i < maxCap; i++) keep.push(list[Math.min(list.length - 1, Math.floor(i * step))]);
    return keep;
}

export function parseSizes(raw) {
    const list = String(raw === undefined || raw === null || raw === '' ? DEFAULT_SIZES.join(',') : raw)
        .split(/[,\s]+/)
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v >= 8)
        .map((v) => Math.round(v));
    const uniq = [...new Set(list)].sort((a, b) => a - b);
    return uniq.length ? uniq : DEFAULT_SIZES.slice();
}

export function toText(data) {
    if (data[0] === 0x1f && data[1] === 0x8b) return gunzipSync(data).toString('utf8');
    return data.toString('utf8');
}

export function fingerprint(obj) {
    try { return JSON.stringify([obj.v, obj.fr, obj.ip, obj.op, obj.w, obj.h, obj?.layers?.length]); } catch { return String(obj); }
}

export function eqCheck(tsAnim, wasmAnim, eqMode) {
    if (tsAnim === null || wasmAnim === null) return false;
    if (eqMode === 'deep') { try { deepStrictEqual(tsAnim, wasmAnim); return true; } catch { return false; } }
    return fingerprint(tsAnim) === fingerprint(wasmAnim);
}

export function packOf(file, rootDir) {
    const rel = relative(rootDir, file).split(/[\\/]/);
    return rel.length >= 2 ? rel[rel.length - 2] : '(root)';
}

export function packTotalsOf(list, packRoot) {
    const totals = new Map();
    for (const f of list) {
        const p = packOf(f, packRoot);
        totals.set(p, (totals.get(p) || 0) + 1);
    }
    return totals;
}

export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '?';
    if (ms < 1000) return Math.round(ms) + 'ms';
    const total = Math.round(ms / 1000);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
    return s + 's';
}

function progressBar(done, total, width) {
    const filled = total > 0 ? Math.min(width, Math.round((done / total) * width)) : 0;
    return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
}

export function createStatusLine(opts = {}) {
    const stream = opts.stream || process.stdout;
    const label = opts.label || 'bench';
    const total = opts.total || 0;
    const packs = opts.packs || null;
    const packsTotal = packs ? packs.size : 0;
    const enabled = opts.enabled !== false;
    const tty = opts.tty !== undefined ? !!opts.tty : !!stream.isTTY;
    const intervalMs = opts.intervalMs > 0 ? opts.intervalMs : (tty ? 250 : 5000);
    const counts = new Map();
    const t0 = performance.now();
    let done = 0;
    let current = '';
    let lastRender = 0;
    let active = false;

    const line = () => {
        const el = performance.now() - t0;
        const rate = done > 0 && el > 0 ? done / (el / 1000) : 0;
        const eta = rate > 0 && done < total ? (total - done) / rate : 0;
        const pct = total > 0 ? (done / total) * 100 : 0;
        let packsDone = 0;
        if (packsTotal > 0) {
            for (const [name, n] of counts) if (n >= (packs.get(name) || 0)) packsDone++;
        }
        const parts = [];
        if (packsTotal > 0) parts.push('packs ' + packsDone + '/' + packsTotal + ' ' + progressBar(packsDone, packsTotal, 20));
        parts.push('files ' + done + '/' + total + ' ' + pct.toFixed(1) + '%');
        if (rate > 0) parts.push(rate.toFixed(1) + ' f/s');
        parts.push(formatDuration(el) + ' elapsed');
        if (eta > 0) parts.push('eta ' + formatDuration(eta * 1000));
        if (current) {
            const pn = counts.get(current) || 0;
            const pt = packs ? (packs.get(current) || 0) : 0;
            parts.push('pack ' + current + (pt > 0 ? ' ' + pn + '/' + pt : ''));
        }
        return '[' + label + '] ' + parts.join(' | ');
    };

    const render = (final) => {
        const text = line();
        if (tty) {
            stream.write('\r\u001b[K' + text);
            active = true;
            if (final) {
                stream.write('\n');
                active = false;
            }
        } else {
            stream.write(text + '\n');
        }
        lastRender = performance.now();
    };

    const clear = () => {
        if (tty && active) {
            stream.write('\r\u001b[K');
            active = false;
        }
    };

    return {
        bump(pack, n = 1) {
            done += n;
            if (pack) counts.set(pack, (counts.get(pack) || 0) + n);
        },
        setDone(v) {
            done = v;
        },
        setPack(pack) {
            current = pack || '';
        },
        get done() {
            return done;
        },
        tick() {
            if (!enabled) return;
            if (performance.now() - lastRender >= intervalMs) render(false);
        },
        log(text) {
            if (!enabled) {
                stream.write(text + '\n');
                return;
            }
            clear();
            stream.write(text + '\n');
            lastRender = 0;
        },
        newline() {
            clear();
        },
        finish() {
            if (!enabled) return;
            render(true);
        }
    };
}

export function validAnim(a) {
    return !!a && typeof a === 'object' && Array.isArray(a.layers);
}

export function fitSize(cw, ch, size) {
    const long = Math.max(cw, ch) || 1;
    const w = cw >= ch ? size : Math.max(1, Math.round(cw * size / long));
    const h = ch > cw ? size : Math.max(1, Math.round(ch * size / long));
    return { w, h };
}

export function emptySizeEntry() {
    return {
        tlOk: false, tlLoadMs: 0, tlRenderMs: 0, tlFramesRendered: 0, tlDims: '',
        oursOk: false, oursLoadMs: 0, oursRenderMs: 0, oursFramesRendered: 0, oursErr: false
    };
}

// Measures one file at every render size. Load is measured once per file for tlottie
// (its load path does not depend on the output size) and per size for ours (the render
// instance owns the size-dependent pixel buffer).
//
// ctx: { tgs, wasm, tl, sizes, runs, loadRuns, eqMode, tlFrames, oursFrames, tlTolerance,
//        packRoot, oursFirst }
// Returns { row } | { gunzipFail: true }.
export function measureFile(file, ctx) {
    const { tgs, wasm, tl, sizes, runs, loadRuns, eqMode, tlFrames, oursFrames, tlTolerance, packRoot, oursFirst } = ctx;
    const data = readFileSync(file);
    let json;
    try { json = toText(data); } catch { return { gunzipFail: true }; }

    let tsAnim = null, tsOk = false, tsMs = 0;
    let wasmAnim = null, wasmOk = false, wasmMs = 0;
    if (tgs) {
        for (let i = 0; i < runs; i++) {
            const a = performance.now();
            try {
                const anim = tgs.parseTgs(json);
                if (validAnim(anim)) { tsOk = true; tsAnim = anim; }
            } catch { }
            tsMs += performance.now() - a;
        }
        tsMs /= runs;
    }
    if (wasm) {
        for (let i = 0; i < runs; i++) {
            const a = performance.now();
            try {
                const raw = wasm.parse_tgs_json(json, null, false);
                const anim = JSON.parse(raw);
                if (validAnim(anim)) { wasmOk = true; wasmAnim = anim; }
            } catch { }
            wasmMs += performance.now() - a;
        }
        wasmMs /= runs;
    }
    const eq = (tgs && wasm && (tsOk || wasmOk)) ? eqCheck(tsAnim, wasmAnim, eqMode) : null;
    let animObj = wasmAnim || tsAnim;
    if (!animObj) { try { animObj = JSON.parse(json); } catch { } }

    const row = {
        file, pack: packOf(file, packRoot), bytes: data.length,
        tsMs, tsOk, wasmMs, wasmOk, eq, sizes: {}
    };
    for (const size of sizes) row.sizes[size] = emptySizeEntry();

    const runTl = () => {
        if (!tl) return;
        let inst = null, loadMs = 0;
        try {
            const jsonBuf = Buffer.from(json, 'utf8');
            let loadBest = Infinity;
            for (let i = 0; i < loadRuns; i++) {
                const a = performance.now();
                const ptr = tl.tlottie_alloc(jsonBuf.length);
                if (!ptr) break;
                new Uint8Array(tl.memory.buffer).set(jsonBuf, ptr);
                const id = tl.tlottie_new_with_options(ptr, jsonBuf.length, 0, 0, 0);
                tl.tlottie_free(ptr, jsonBuf.length);
                const b = performance.now();
                if (!id) break;
                loadBest = Math.min(loadBest, b - a);
                if (inst) tl.tlottie_drop(inst);
                inst = id;
            }
            loadMs = isFinite(loadBest) ? loadBest : 0;
            if (!inst) return;
            const cw = tl.tlottie_width(inst), ch = tl.tlottie_height(inst);
            const fc = Math.max(1, tl.tlottie_frame_count(inst));
            const dims = cw + 'x' + ch + '@' + fc;
            const n = Math.min(fc, tlFrames);
            for (const size of sizes) {
                const e = row.sizes[size];
                e.tlLoadMs = loadMs;
                e.tlDims = dims;
                const { w, h } = fitSize(cw, ch, size);
                const r0 = performance.now();
                let rendered = 0;
                for (let f = 0; f < n; f++) {
                    const px = tl.tlottie_render_with_options(inst, f, w, h, 1, tlTolerance);
                    if (!px) break;
                    new Uint8Array(tl.memory.buffer, px, w * h * 4)[0];
                    rendered++;
                }
                e.tlRenderMs = performance.now() - r0;
                e.tlFramesRendered = rendered;
                e.tlOk = rendered === n;
            }
        } catch { } finally {
            if (inst) tl.tlottie_drop(inst);
        }
    };

    const runOurs = () => {
        if (!wasm || typeof wasm.TgsRender !== 'function') return;
        const cw = animObj?.w || 512, ch = animObj?.h || 512;
        for (const size of sizes) {
            const e = row.sizes[size];
            try {
                const { w, h } = fitSize(cw, ch, size);
                let inst = null, loadBest = Infinity;
                for (let i = 0; i < loadRuns; i++) {
                    const a = performance.now();
                    const r = new wasm.TgsRender(json, w, h);
                    loadBest = Math.min(loadBest, performance.now() - a);
                    if (inst === null) inst = r; else r.free?.();
                }
                e.oursLoadMs = isFinite(loadBest) ? loadBest : 0;
                if (!inst) continue;
                const ip = inst.in_frame();
                const fc = Math.max(1, inst.frame_count());
                const n = Math.min(fc, oursFrames);
                let rendered = 0;
                const t0 = performance.now();
                for (let f = 0; f < n; f++) {
                    inst.render(ip + f, w, h);
                    rendered++;
                }
                e.oursRenderMs = performance.now() - t0;
                e.oursFramesRendered = rendered;
                e.oursOk = rendered === n;
                inst.free?.();
            } catch {
                e.oursErr = true;
            }
        }
    };

    if (oursFirst) { runOurs(); runTl(); } else { runTl(); runOurs(); }
    return { row };
}
