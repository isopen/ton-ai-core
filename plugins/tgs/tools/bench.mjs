// Corpus benchmark for the tgs plugin: TS parser vs Rust WASM parse backend.
// Uses local .tgs files; WASM side requires src/rust/wasm-node (wasm-pack --target nodejs build).
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
    try {
        for (const name of readdirSync(dir)) {
            if (!name.endsWith('.tgs')) continue;
            const p = join(dir, name);
            const st = statSync(p);
            if (st.isFile() && st.size > 0) files.add(p);
        }
    } catch { }
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
            const glue = await import(join(PLUGIN_ROOT, 'src', 'rust', 'wasm-node', 'tgs_wasm.js'));
            if (typeof glue.parse_tgs_json === 'function') {
                wasm = glue;
                console.log('[tgs-bench] wasm-node active' + (typeof glue.parse_tgs_binary === 'function' ? ' (binary ok)' : ' (NO binary export)'));
            }
        } catch (e) {
            console.log('[tgs-bench] wasm-node unavailable (' + String(e && e.message ? e.message : e).slice(0, 100) + ')');
        }
    }
    if (!bridge) console.log('[tgs-bench] bridge module missing (decode eq-check disabled)');

    console.log('[tgs-bench] runs per point: ' + runs);
    console.log('[tgs-bench] columns: ts | wb (wasm binary=lex-first) | wl (wasm lex explicit) | w (wasm serde json) | wj (wasm+JSON.parse) | eq (wb==serde) | beq (bytes lex==serde)');
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
        console.log(line);
    }
}

main().catch(function (e) {
    console.error('[tgs-bench] failed:', e);
    process.exit(1);
});
