// Worker shard for bench-corpus-parallel.mjs. Measures each assigned file at every render
// size using the shared measureFile() from bench-corpus-common.mjs.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workerData, parentPort, isMainThread } from 'node:worker_threads';
import { measureFile, parseSizes, packOf } from './bench-corpus-common.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');

const runs = Math.max(1, Number(process.env.TGS_CORPUS_RUNS || 1));
const loadRuns = Math.max(1, Number(process.env.TGS_CORPUS_LOAD_RUNS || Math.max(3, runs)));
const eqMode = (process.env.TGS_CORPUS_EQ || 'fp').toLowerCase();
const tlFrames = Math.max(1, Number(process.env.TGS_LOTTIE_FRAMES || 30));
const tlTolerance = Number(process.env.TGS_LOTTIE_TOLERANCE || 0.3);
const oursFrames = Math.max(1, Number(process.env.TGS_OURS_FRAMES || tlFrames));
const progressEvery = Number(process.env.TGS_CORPUS_WORKER_PROGRESS || 5);
const sizes = parseSizes(workerData.sizes !== undefined ? workerData.sizes : process.env.TGS_SIZES);

const files = workerData.files;
// Absolute per-file measurement order from the parent, so sharding cannot
// change which backend goes first for a given file (matches bench-corpus.mjs).
const oursFirstOrder = workerData.order;
const counters = { tsOk: 0, wasmOk: 0, eqOk: 0, eqBad: 0, oursOk: 0, oursErr: 0, gunzipFails: 0, readFails: 0 };
const packCounts = new Map();
const rows = [];
let lastPack = '';

async function main() {
    const require = createRequire(import.meta.url);
    const tgs = process.env.TGS_BENCH_TS === '1' ? require(join(PLUGIN_ROOT, 'dist', 'ts', 'index.js')) : null;
    let wasm = null;
    if (process.env.TGS_BENCH_WASM !== '0') {
        try {
            const glueUrl = pathToFileURL(join(PLUGIN_ROOT, 'src', 'rust', 'wasm', 'tgs_wasm.js'));
            wasm = await import(glueUrl.href);
            if (typeof wasm.parse_tgs_json !== 'function') wasm = null;
            if (wasm) await wasm.default(pathToFileURL(join(PLUGIN_ROOT, 'src', 'rust', 'wasm', 'tgs_wasm_bg.wasm')).href);
        } catch { wasm = null; }
    }
    let tl = null;
    if (process.env.TGS_BENCH_TL !== '0') {
        try {
            const buf = readFileSync(join(PLUGIN_ROOT, 'tools', 'vendor', 'tlottie.wasm'));
            const mod = await WebAssembly.instantiate(buf, {});
            const ex = mod.instance.exports;
            if (typeof ex.tlottie_new_with_options === 'function' && ex.memory) tl = ex;
        } catch { tl = null; }
    }
    const warm = '{"v":"5.5.7","fr":30,"ip":0,"op":30,"w":32,"h":32,"layers":[]}';
    if (tl) {
        for (const size of sizes) {
            try {
                const jsonBuf = Buffer.from(warm, 'utf8');
                const p = tl.tlottie_alloc(jsonBuf.length);
                new Uint8Array(tl.memory.buffer).set(jsonBuf, p);
                const id = tl.tlottie_new_with_options(p, jsonBuf.length, 0, 0, 0);
                tl.tlottie_free(p, jsonBuf.length);
                if (id) {
                    for (let f = 0; f < 3; f++) tl.tlottie_render_with_options(id, f, size, size, 1, tlTolerance);
                    tl.tlottie_drop(id);
                }
            } catch { }
        }
    }
    const oursActive = !!(wasm && typeof wasm.TgsRender === 'function');
    if (oursActive) {
        for (const size of sizes) {
            try {
                const r = new wasm.TgsRender(warm, size, size);
                r.render(0, size, size);
                r.free?.();
            } catch { }
        }
    }

    let done = 0;
    for (const file of files) {
        const packName = packOf(file, workerData.packRoot);
        lastPack = packName;
        packCounts.set(packName, (packCounts.get(packName) || 0) + 1);
        try {
            const res = measureFile(file, {
                tgs, wasm, tl, sizes, runs, loadRuns, eqMode, tlFrames, oursFrames, tlTolerance,
                packRoot: workerData.packRoot,
                oursFirst: oursFirstOrder ? oursFirstOrder[done] : (done & 1) === 1
            });
            if (res.gunzipFail) {
                counters.gunzipFails++;
            } else {
                const row = res.row;
                if (row.tsOk) counters.tsOk++;
                if (row.wasmOk) counters.wasmOk++;
                if (row.eq === true) counters.eqOk++; else if (row.eq === false) counters.eqBad++;
                if (sizes.every((s) => row.sizes[s].oursOk)) counters.oursOk++;
                if (sizes.some((s) => row.sizes[s].oursErr)) counters.oursErr++;
                rows.push(row);
            }
        } catch {
            counters.readFails++;
        }
        done++;
        if (progressEvery > 0 && done % progressEvery === 0) {
            parentPort.postMessage({
                type: 'progress', counters, done, lastPack,
                packCounts: Object.fromEntries(packCounts)
            });
        }
    }
    parentPort.postMessage({
        type: 'done', counters, rows, done, total: files.length, lastPack,
        packCounts: Object.fromEntries(packCounts),
        backends: { ts: !!tgs, wasm: !!wasm, ours: oursActive, tl: !!tl }
    });
}

if (!isMainThread) {
    main().catch((e) => {
        parentPort.postMessage({ type: 'fatal', error: String(e?.stack || e) });
        process.exitCode = 1;
    });
}
