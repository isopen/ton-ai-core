// Corpus benchmark for the tgs plugin: TS parser vs Rust WASM parse backend.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..');

const runs = Number(process.env.TGS_BENCH_RUNS || 7);
const corpusArgs = process.argv.slice(2).filter(a => !a.startsWith('-'));
const files = new Set();

import { deepStrictEqual } from 'node:assert';
function deepStrictEq(a, b) {
    try { deepStrictEqual(a, b); return true; } catch { return false; }
}
function bytesEq(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

const scanDir = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (e.isDirectory()) { scanDir(join(dir, e.name)); continue; }
        if (!e.name.endsWith('.tgs')) continue;
        const p = join(dir, e.name);
        try { const st = statSync(p); if (st.isFile() && st.size > 0) files.add(p); } catch { }
    }
};
if (corpusArgs.length > 0) {
    for (const a of corpusArgs) {
        const p = isAbsolute(a) ? a : join(REPO_ROOT, a);
        const st = statSync(p);
        if (st.isDirectory()) scanDir(p); else files.add(p);
    }
} else {
    scanDir(join(REPO_ROOT, 'tmp'));
    scanDir(join(REPO_ROOT, '.opencode', 'repro'));
}

if (files.size === 0) {
    console.error('[tgs-bench] no .tgs files found (pass paths or put files into tmp/)');
    process.exit(1);
}
const maxCap = Number(process.env.TGS_BENCH_MAX || 0);
if (maxCap > 0 && files.size > maxCap) {
    const arr = [...files].sort();
    const step = arr.length / maxCap;
    const keep = [];
    for (let i = 0; i < maxCap; i++) keep.push(arr[Math.min(arr.length - 1, Math.floor(i * step))]);
    files.clear();
    keep.forEach((f) => files.add(f));
    console.log('[tgs-bench] TGS_BENCH_MAX=' + maxCap + ' -> stratified sample of ' + files.size + '/' + arr.length);
}
const quiet = process.env.TGS_BENCH_QUIET === '1';
if (files.size > 2000 && runs > 3) console.log('[tgs-bench] hint: big corpus, consider TGS_BENCH_RUNS=1 TGS_BENCH_QUIET=1');

function toText(data) {
    if (data[0] === 0x1f && data[1] === 0x8b) return gunzipSync(data).toString('utf8');
    return data.toString('utf8');
}

class Stats {
    constructor() { this.samples = []; }
    push(v) { this.samples.push(v); }
    sorted() { return [...this.samples].sort((a, b) => a - b); }
    median() { const s = this.sorted(); const m = s.length >> 1; return s.length ? s[m] : 0; }
    min() { return this.samples.length ? this.sorted()[0] : 0; }
}

const fmt = (ms) => ms.toFixed(2).padStart(9);

async function main() {
    const require = createRequire(import.meta.url);
    const tgs = require(join(PLUGIN_ROOT, 'dist', 'ts', 'index.js'));
    let bridge = null;
    try { bridge = require(join(PLUGIN_ROOT, 'dist', 'ts', 'bridge.js')); } catch { }

    let wasm = null;
    if (process.env.TGS_BENCH_WASM !== '0') {
        try {
            const glue = await import(join(PLUGIN_ROOT, 'src', 'rust', 'wasm', 'tgs_wasm.js'));
            if (typeof glue.parse_tgs_json === 'function') {
                wasm = glue;
                console.log('[tgs-bench] wasm active' + (typeof glue.parse_tgs_binary === 'function' ? ' (binary ok)' : ' (NO binary export)'));
            }
        } catch (e) {
            console.log('[tgs-bench] wasm unavailable (' + String(e && e.message ? e.message : e).slice(0, 100) + ')');
        }
    }
    if (!bridge) console.log('[tgs-bench] bridge module missing (decode eq-check disabled)');

    console.log('[tgs-bench] runs per point: ' + runs);
    console.log('[tgs-bench] columns: ts | wb (wasm binary=lex-first) | wl (wasm lex explicit) | w (wasm serde json) | wj (wasm+JSON.parse) | eq (wb==serde) | beq (bytes lex==serde)');
    const agg = { rows: [] };
    for (const file of [...files].sort()) {
        const data = readFileSync(file);
        let json;
        try { json = toText(data); } catch (e) { console.log(join(file) + ' skip (gzip fail)'); continue; }
        const st = new Stats(); const sw = new Stats(); const swj = new Stats();
        let swb = null;
        let swl = null;
        let okTs = false, okW = false, okBin = false, eq = '-', eqL = '-', byteEqOut = '-', outLen = 0;
        for (let i = 0; i < runs; i++) {
            let t0 = performance.now();
            const anim = tgs.parseTgs(json);
            let t1 = performance.now();
            st.push(t1 - t0);
            if (anim && anim.layers && anim.layers.length >= 0) okTs = true;
        }
        if (wasm) {
            for (let i = 0; i < runs; i++) {
                let t0 = performance.now();
                const raw = wasm.parse_tgs_json(json, null, false);
                let t1 = performance.now();
                sw.push(t1 - t0);
                const anim = JSON.parse(raw);
                let t2 = performance.now();
                swj.push(t2 - t0);
                if (anim && anim.layers && anim.layers.length >= 0) { okW = true; outLen = raw.length; }
                if (i === 0 && typeof wasm.parse_tgs_binary === 'function' && bridge) {
                    try {
                        const arb = new Stats();
                        let anb = null;
                        for (let k = 0; k < runs; k++) {
                            const b0 = performance.now();
                            const bytes = wasm.parse_tgs_binary(json, null, false);
                            const b1 = performance.now();
                            anb = bridge.decodeAnimation(bytes);
                            arb.push(b1 - b0);
                        }
                        swb = arb;
                        okBin = Array.isArray(anb?.layers);
                        if (anb !== null && okBin) {
                            eq = deepStrictEq(anb, anim);
                        }
                        if (typeof wasm.parse_tgs_binary_lex === 'function') {
                            const arl = new Stats();
                            let anl = null;
                            let beq = '-';
                            for (let k = 0; k < runs; k++) {
                                const l0 = performance.now();
                                const lexBytes = wasm.parse_tgs_binary_lex(json, null, false);
                                const l1 = performance.now();
                                anl = bridge.decodeAnimation(lexBytes);
                                arl.push(l1 - l0);
                                if (k === 0 && typeof wasm.parse_tgs_binary_serde === 'function') {
                                    beq = bytesEq(new Uint8Array(wasm.parse_tgs_binary_serde(json, null, false)), lexBytes) ? '=' : '!';
                                }
                            }
                            swl = arl;
                            eqL = anl ? deepStrictEq(anl, anim) : '-';
                            byteEqOut = beq;
                        }
                    } catch (e) {
                        okBin = false;
                        console.log('[tgs-bench] binary path error (' + file + '): ' + String(e && e.message ? e.message : e).slice(0, 140));
                    }
                }
            }
            if (typeof wasm.measure_parse_parts === 'function') {
                const parts = String(wasm.measure_parse_parts(json)).split(',').map(Number);
                console.log('[tgs-bench] parts(name) serdeMs/buildMs/serMs/ljsonMs: ' + parts.join(' / '));
            }
        }
        const name = file.slice(REPO_ROOT.length + 1);
        const gzKB = (data.length / 1024).toFixed(0);
        const jsonKB = (outLen / 1024).toFixed(0);
        const wbStr = swb && swb.samples.length ? fmt(swb.min()) : '-';
        const wlStr = swl && swl.samples.length ? fmt(swl.min()) : '-';
        const line = [name, 'sizeKB=' + gzKB, 'ts=' + fmt(st.min()), 'w=' + (wasm ? fmt(sw.min()) : '-'), 'wb=' + wbStr, 'wl=' + wlStr, 'wj=' + (wasm ? fmt(swj.min()) : '-'), 'okTs=' + okTs, 'okW=' + okW, 'eq=' + eq, 'eqL=' + eqL, 'beq=' + byteEqOut, 'jsonKB=' + jsonKB].join(' | ');
        if (quiet) {
            agg.rows.push({ name, size: data.length, tsMin: st.min(), wMin: wasm && sw.samples.length ? sw.min() : null, okTs, okW, eq, eqL });
        } else {
            console.log(line);
        }
    }

    if (quiet && agg.rows.length > 0) {
        const mb = (b) => b / (1024 * 1024);
        const total = agg.rows.reduce((s, r) => s + r.size, 0);
        const pcts = (arr) => { const a = [...arr].sort((x, y) => x - y); return { p50: a[Math.floor(a.length * 0.5)] || 0, p95: a[Math.floor(a.length * 0.95)] || 0 }; };
        const tsM = pcts(agg.rows.map((r) => r.tsMin));
        const tsThroughput = agg.rows.reduce((s, r) => s + r.tsMin, 0) > 0 ? mb(total) / (agg.rows.reduce((s, r) => s + r.tsMin, 0) / 1000) : 0;
        console.log('[tgs-bench] ===== corpus summary (' + agg.rows.length + ' files, ' + mb(total).toFixed(1) + ' MB) =====');
        console.log('[tgs-bench] ts    : ' + tsThroughput.toFixed(2) + ' MB/s | p50 ' + tsM.p50.toFixed(2) + 'ms | p95 ' + tsM.p95.toFixed(2) + 'ms | ok=' + agg.rows.filter((r) => r.okTs).length + '/fail=' + agg.rows.filter((r) => !r.okTs).length);
        if (agg.rows.some((r) => r.wMin != null)) {
            const wM = pcts(agg.rows.filter((r) => r.wMin != null).map((r) => r.wMin));
            const wTotal = agg.rows.filter((r) => r.wMin != null).reduce((s, r) => s + r.wMin, 0);
            const wThroughput = wTotal > 0 ? mb(total) / (wTotal / 1000) : 0;
            const eqOk = agg.rows.filter((r) => r.eq === true).length;
            const eqBad = agg.rows.filter((r) => r.eq === false).length;
            console.log('[tgs-bench] wasm  : ' + wThroughput.toFixed(2) + ' MB/s | p50 ' + wM.p50.toFixed(2) + 'ms | p95 ' + wM.p95.toFixed(2) + 'ms | ok=' + agg.rows.filter((r) => r.okW).length + '/fail=' + agg.rows.filter((r) => !r.okW).length + ' (eq wb==json: = ' + eqOk + ', ! ' + eqBad + ')');
        }
        const slow = [...agg.rows].sort((a, b) => b.tsMin - a.tsMin).slice(0, 20);
        console.log('[tgs-bench] top slow (ts):');
        for (const r of slow) console.log('  ' + r.tsMin.toFixed(2) + 'ms  ' + (r.size / 1024).toFixed(0) + 'KB  ' + r.name);
    }
}

main().catch(function (e) {
    console.error('[tgs-bench] failed:', e);
    process.exit(1);
});
