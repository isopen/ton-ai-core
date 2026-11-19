// Corpus benchmark in the style of https://dkaraush.github.io/tlottie/benchmarks/android-fold.html
// Runs the tgs plugin decode across a big .tgs corpus (downloaded by tools/dump-tgs-corpus.js),
// grouped by pack folder, and renders an HTML report + JSON stats.
//
// One pack table is emitted per render size (TGS_SIZES, default 64,320,720), matching the
// three size tables of the tlottie benchmark page.
//
// Usage:
//   node tools/bench-corpus.mjs <corpus-dir>...        (recursive scan for *.tgs)
// Env:
//   TGS_SIZES=64,320,720     render sizes (px, long side) — one report table each
//   TGS_CORPUS_RUNS=1        parse runs per file
//   TGS_CORPUS_LOAD_RUNS=max(3,runs)  load samples per file (min is reported)
//   TGS_CORPUS_MAX=0         stratified cap on number of files (0 = all, default)
//   TGS_CORPUS_EQ=fp         eq-check ts vs wasm: 'fp' fingerprint | 'off' | 'deep'
//   TGS_BENCH_TS=1           also run the TypeScript parser
//   TGS_BENCH_WASM=0         disable wasm backend
//   TGS_BENCH_TL=0           disable the tlottie reference renderer
//   TGS_LOTTIE_FRAMES=30     frames per file
//   TGS_OURS_FRAMES=30       frames per file for the ours renderer
//   TGS_CORPUS_OUT=path      report output (default tmp/tgs-corpus-bench.html)
//   TGS_CORPUS_JSON=path     machine-readable JSON summary (optional)
//   TGS_CORPUS_PROGRESS=250  log a detailed line every N files
//   TGS_CORPUS_STATUS_MS=0   live status refresh interval (0 = 250 on tty, 5000 piped)
//   TGS_CORPUS_STATUS=0      disable the live status line
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCorpus, capFiles, measureFile, parseSizes, packOf, packTotalsOf, createStatusLine } from './bench-corpus-common.mjs';
import { buildReport } from './bench-corpus-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..');

const runs = Math.max(1, Number(process.env.TGS_CORPUS_RUNS || 1));
const loadRuns = Math.max(1, Number(process.env.TGS_CORPUS_LOAD_RUNS || Math.max(3, runs)));
const eqMode = (process.env.TGS_CORPUS_EQ || 'fp').toLowerCase();
const progressEvery = Number(process.env.TGS_CORPUS_PROGRESS || 250);
const statusEvery = Number(process.env.TGS_CORPUS_STATUS_MS || 0);
const statusEnabled = process.env.TGS_CORPUS_STATUS !== '0';
const outHtml = process.env.TGS_CORPUS_OUT !== undefined ? process.env.TGS_CORPUS_OUT : join(REPO_ROOT, 'tmp', 'tgs-corpus-bench.html');
const outJson = process.env.TGS_CORPUS_JSON || '';
const sizes = parseSizes(process.env.TGS_SIZES);
const tlFrames = Math.max(1, Number(process.env.TGS_LOTTIE_FRAMES || 30));
const tlTolerance = Number(process.env.TGS_LOTTIE_TOLERANCE || 0.3);
const oursFrames = Math.max(1, Number(process.env.TGS_OURS_FRAMES || tlFrames));
const label = 'corpus-bench';

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
console.log('[corpus-bench] scanning corpus...');
const { list, emptySkipped, packRoot } = collectCorpus({ args, repoRoot: REPO_ROOT, defaultDir: 'tmp' });
if (list.length === 0) {
    console.error('[corpus-bench] no .tgs files found; pass a corpus dir, e.g. node tools/bench-corpus.mjs ~/tgs-corpus');
    process.exit(1);
}
const maxCap = Number(process.env.TGS_CORPUS_MAX || 0);
const files = capFiles(list, maxCap);
if (files.length < list.length) {
    console.log('[corpus-bench] TGS_CORPUS_MAX=' + maxCap + ' -> stratified sample of ' + files.length + '/' + list.length);
}

async function main() {
    const require = createRequire(import.meta.url);
    const tsBench = process.env.TGS_BENCH_TS === '1';
    const tgs = tsBench ? require(join(PLUGIN_ROOT, 'dist', 'ts', 'index.js')) : null;
    let wasm = null;
    if (process.env.TGS_BENCH_WASM !== '0') {
        try {
            const glue = await import(join(PLUGIN_ROOT, 'src', 'rust', 'wasm', 'tgs_wasm.js'));
            if (typeof glue.parse_tgs_json === 'function') wasm = glue;
        } catch (e) {
            console.log('[corpus-bench] wasm unavailable (' + String(e?.message || e).slice(0, 100) + ') — ts-only');
        }
    }
    let tl = null;
    if (process.env.TGS_BENCH_TL !== '0') {
        try {
            const buf = readFileSync(join(PLUGIN_ROOT, 'tools', 'vendor', 'tlottie.wasm'));
            const mod = await WebAssembly.instantiate(buf, {});
            const ex = mod.instance.exports;
            if (typeof ex.tlottie_new_with_options === 'function' && ex.memory) tl = ex;
        } catch (e) {
            console.log('[corpus-bench] tlottie reference unavailable (' + String(e?.message || e).slice(0, 100) + ')');
        }
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
        console.log('[corpus-bench] tlottie reference active: ' + tlFrames + ' frames/file, sizes ' + sizes.join(',') + 'px, aa=1, curveTolerance=' + tlTolerance);
    }
    const oursActive = !!(wasm && typeof wasm.TgsRender === 'function');
    if (oursActive) {
        for (const size of sizes) {
            try {
                const r = new wasm.TgsRender(warm, size, size);
                r.render(0, size, size);
                r.free?.();
            } catch (e) {
                console.log('[corpus-bench] ours-renderer warmup failed @ ' + size + 'px: ' + String(e?.message || e).slice(0, 100));
            }
        }
        console.log('[corpus-bench] ours renderer active: ' + oursFrames + ' frames/file, sizes ' + sizes.join(',') + 'px');
    }

    const rows = [];
    const counters = { gunzipFails: 0, readFails: 0, oursErr: 0 };
    let liveTsOk = 0, liveWasmOk = 0, liveEqOk = 0, liveEqBad = 0, liveOursOk = 0;
    const status = createStatusLine({
        label,
        total: files.length,
        packs: packTotalsOf(files, packRoot),
        intervalMs: statusEvery,
        enabled: statusEnabled
    });
    const t0all = performance.now();
    let done = 0;
    for (const file of files) {
        const packName = packOf(file, packRoot);
        try {
            const res = measureFile(file, {
                tgs, wasm, tl, sizes, runs, loadRuns, eqMode, tlFrames, oursFrames, tlTolerance,
                packRoot, oursFirst: (done & 1) === 1
            });
            if (res.gunzipFail) {
                counters.gunzipFails++;
            } else {
                const row = res.row;
                if (row.tsOk) liveTsOk++;
                if (row.wasmOk) liveWasmOk++;
                if (row.eq === true) liveEqOk++; else if (row.eq === false) liveEqBad++;
                if (sizes.every((s) => row.sizes[s].oursOk)) liveOursOk++;
                if (sizes.some((s) => row.sizes[s].oursErr)) {
                    counters.oursErr++;
                    status.log('[corpus-bench] ours-error ' + file + ' @ ' + sizes.filter((s) => row.sizes[s].oursErr).join(',') + 'px');
                }
                rows.push(row);
            }
        } catch { counters.readFails++; }
        done++;
        status.bump(packName);
        status.setPack(packName);
        status.tick();
        if (progressEvery > 0 && done % progressEvery === 0 && done < files.length) {
            const el = (performance.now() - t0all) / 1000;
            status.log('[corpus-bench] ' + done + '/' + files.length + ' files, ' + el.toFixed(1) + 's elapsed'
                + ' | ts ok=' + liveTsOk + ' | wasm ok=' + liveWasmOk + ' | eq ok=' + liveEqOk + ' bad=' + liveEqBad
                + ' | ours ok=' + liveOursOk + ' err=' + counters.oursErr
                + ' | empty_skipped=' + emptySkipped
                + ' | gunzip_fails=' + counters.gunzipFails + ' | read_fails=' + counters.readFails);
        }
    }
    const totalMs = performance.now() - t0all;
    status.finish();

    const { html, json } = buildReport({
        rows, sizes, filesTotal: files.length, totalMs, emptySkipped, runs, loadRuns, eqMode,
        tlFrames, oursFrames, tlTolerance, args, scriptName: 'bench-corpus.mjs', label,
        workers: 0, maxCap, fatalCount: 0, tlActive: !!tl, oursActive, tsBench, wasmActive: !!wasm,
        counters, repoRoot: REPO_ROOT
    });

    if (outJson) writeFileSync(outJson, JSON.stringify(json, null, 2));
    if (outHtml) {
        mkdirSync(dirname(outHtml), { recursive: true });
        writeFileSync(outHtml, html);
        console.log('[corpus-bench] report written: ' + outHtml);
    }
}

main().catch((e) => {
    console.error('[corpus-bench] failed:', e);
    process.exit(1);
});
