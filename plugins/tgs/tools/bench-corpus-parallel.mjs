// Parallel corpus benchmark: same measurement and report as bench-corpus.mjs, split across
// worker threads. Use it for ok/eq/err counters and full-corpus coverage; absolute timings
// are inflated by CPU contention.
//
// Usage:
//   node tools/bench-corpus-parallel.mjs <corpus-dir>...   (recursive scan for *.tgs)
// Env:
//   TGS_SIZES=64,320,720     render sizes (px, long side) — one report table each
//   TGS_CORPUS_WORKERS=0     worker count (0 = auto: min(8, cpus-1))
//   TGS_CORPUS_RUNS=1        parse runs per file
//   TGS_CORPUS_LOAD_RUNS=max(3,runs)  load samples per file (min is reported)
//   TGS_CORPUS_MAX=0         stratified cap on number of files (0 = all)
//   TGS_CORPUS_EQ=fp         eq-check ts vs wasm: 'fp' | 'off' | 'deep'
//   TGS_BENCH_WASM=0         disable wasm backend
//   TGS_BENCH_TL=0           disable the tlottie reference renderer
//   TGS_BENCH_TS=1           also run the TypeScript parser (ts/wasm/eq columns)
//   TGS_LOTTIE_FRAMES=30     frames per file
//   TGS_OURS_FRAMES=30       frames per file for the ours renderer
//   TGS_CORPUS_OUT=path      report output (default tmp/tgs-corpus-bench-parallel.html)
//   TGS_CORPUS_JSON=path     machine-readable JSON summary (optional)
//   TGS_CORPUS_PROGRESS=250  log a detailed line every N files
//   TGS_CORPUS_STATUS_MS=0   live status refresh interval (0 = 250 on tty, 5000 piped)
//   TGS_CORPUS_STATUS=0      disable the live status line
//   TGS_CORPUS_WORKER_PROGRESS=5  files between worker progress messages
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { collectCorpus, capFiles, parseSizes, packTotalsOf, createStatusLine } from './bench-corpus-common.mjs';
import { buildReport } from './bench-corpus-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..');

const runs = Math.max(1, Number(process.env.TGS_CORPUS_RUNS || 1));
const loadRuns = Math.max(1, Number(process.env.TGS_CORPUS_LOAD_RUNS || Math.max(3, runs)));
const eqMode = (process.env.TGS_CORPUS_EQ || 'fp').toLowerCase();
const sizes = parseSizes(process.env.TGS_SIZES);
const tlFrames = Math.max(1, Number(process.env.TGS_LOTTIE_FRAMES || 30));
const tlTolerance = Number(process.env.TGS_LOTTIE_TOLERANCE || 0.3);
const oursFrames = Math.max(1, Number(process.env.TGS_OURS_FRAMES || tlFrames));
const progressEvery = Number(process.env.TGS_CORPUS_PROGRESS || 250);
const statusEvery = Number(process.env.TGS_CORPUS_STATUS_MS || 0);
const statusEnabled = process.env.TGS_CORPUS_STATUS !== '0';
const envWorkers = Number(process.env.TGS_CORPUS_WORKERS || 0);
const outJson = process.env.TGS_CORPUS_JSON || '';
const outHtml = process.env.TGS_CORPUS_OUT !== undefined
    ? process.env.TGS_CORPUS_OUT
    : join(REPO_ROOT, 'tmp', 'tgs-corpus-bench-parallel.html');
const maxCap = Number(process.env.TGS_CORPUS_MAX || 0);
const label = 'corpus-parallel';
const tsBench = process.env.TGS_BENCH_TS === '1';

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
console.log('[corpus-parallel] scanning corpus...');
const { list: allFiles, emptySkipped, packRoot } = collectCorpus({ args, repoRoot: REPO_ROOT, defaultDir: 'tmp' });
if (allFiles.length === 0) {
    console.error('[corpus-parallel] no .tgs files found; pass a corpus dir, e.g. node tools/bench-corpus-parallel.mjs ~/tgs-corpus');
    process.exit(1);
}
const list = capFiles(allFiles, maxCap);
const maxWorkers = Math.max(1, Math.min(32, cpus().length - 1));
const workers = envWorkers > 0 ? Math.min(envWorkers, list.length) : Math.max(1, Math.min(8, maxWorkers, list.length));
console.log('[corpus-parallel] workers=' + workers + ' (cpu=' + cpus().length + ') | files=' + list.length + ' | sizes=' + sizes.join(',') + ' | empty_skipped=' + emptySkipped);

const workerPath = join(HERE, 'bench-corpus-worker.mjs');
const rows = [];
const stMap = new Map();
let fatalCount = 0;
let doneTotal = 0;
let lastPrinted = 0;
const status = createStatusLine({
    label,
    total: list.length,
    packs: packTotalsOf(list, packRoot),
    intervalMs: statusEvery,
    enabled: statusEnabled
});
const t0all = performance.now();

const sumCounters = () => {
    const acc = { tsOk: 0, wasmOk: 0, eqOk: 0, eqBad: 0, oursOk: 0, oursErr: 0, gunzipFails: 0, readFails: 0 };
    for (const st of stMap.values()) {
        const c = st.counters;
        if (!c) continue;
        acc.tsOk += c.tsOk; acc.wasmOk += c.wasmOk; acc.eqOk += c.eqOk; acc.eqBad += c.eqBad;
        acc.oursOk += c.oursOk; acc.oursErr += c.oursErr; acc.gunzipFails += c.gunzipFails; acc.readFails += c.readFails;
    }
    return acc;
};
const printProgress = () => {
    const el = (performance.now() - t0all) / 1000;
    const c = sumCounters();
    let active = 0;
    for (const st of stMap.values()) if (!st.finished) active++;
    status.log('[corpus-parallel] ' + doneTotal + '/' + list.length + ' files, ' + el.toFixed(1) + 's elapsed'
        + ' | ts ok=' + c.tsOk + ' | wasm ok=' + c.wasmOk + ' | eq ok=' + c.eqOk + ' bad=' + c.eqBad
        + ' | ours ok=' + c.oursOk + ' err=' + c.oursErr
        + ' | empty_skipped=' + emptySkipped
        + ' | gunzip_fails=' + c.gunzipFails + ' | read_fails=' + c.readFails
        + ' | workers active ' + active + '/' + workers);
};

const spawnOne = (shard, order) => new Promise((resolve) => {
    const w = new Worker(workerPath, { workerData: { files: shard, order, packRoot, sizes } });
    const st = { counters: null, finished: false, lastDone: 0, backends: null, packCounts: new Map() };
    stMap.set(w.threadId, st);
    w.on('message', (m) => {
        if (m === null || typeof m !== 'object') return;
        if (m.type === 'progress' || m.type === 'done') {
            doneTotal += m.done - st.lastDone;
            st.lastDone = m.done;
            st.counters = m.counters;
            if (m.backends) st.backends = m.backends;
            if (m.packCounts) {
                for (const [name, n] of Object.entries(m.packCounts)) {
                    const prev = st.packCounts.get(name) || 0;
                    if (n > prev) {
                        status.bump(name, n - prev);
                        st.packCounts.set(name, n);
                    }
                }
            }
            if (m.lastPack) status.setPack(m.lastPack);
            status.setDone(doneTotal);
            status.tick();
            if (m.type === 'done') {
                st.finished = true;
                rows.push(...m.rows);
                if (progressEvery > 0 && doneTotal - lastPrinted >= progressEvery && doneTotal < list.length) { printProgress(); lastPrinted = doneTotal; }
                resolve();
            } else if (progressEvery > 0 && doneTotal - lastPrinted >= progressEvery) {
                printProgress();
                lastPrinted = doneTotal;
            }
        } else if (m.type === 'fatal') {
            fatalCount++;
            status.log('[corpus-parallel] WORKER FATAL: ' + m.error);
        }
    });
    w.on('error', (e) => {
        fatalCount++;
        status.log('[corpus-parallel] worker error: ' + String(e?.message || e));
        resolve();
    });
    w.on('exit', (code) => {
        if (!st.finished) {
            // A clean exit without a `done` message still loses rows: never
            // report that as a successful full-corpus run.
            fatalCount++;
            status.log('[corpus-parallel] worker exited without done (code=' + code + '): results incomplete');
            resolve();
        }
    });
});

const shardList = [];
const orderList = [];
for (let i = 0; i < list.length; i++) {
    const slot = i % workers;
    if (!shardList[slot]) { shardList[slot] = []; orderList[slot] = []; }
    shardList[slot].push(list[i]);
    // Keep the sequential script's per-file alternation exactly: deriving it
    // from a worker-local counter would flip ~33-50% of files when sharded.
    orderList[slot].push((i & 1) === 1);
}

await Promise.all(shardList.map((s, i) => (s && s.length > 0 ? spawnOne(s, orderList[i]) : null)).filter(Boolean));
const totalMs = performance.now() - t0all;
status.finish();

const counters = sumCounters();
const anyBackend = (k) => [...stMap.values()].some((st) => st.backends && st.backends[k]);
const wasmActive = anyBackend('wasm') || rows.some((r) => r.wasmOk || r.wasmMs > 0);
const oursActive = anyBackend('ours') || rows.some((r) => Object.values(r.sizes).some((m) => m.oursLoadMs > 0 || m.oursFramesRendered > 0));
const tlActive = anyBackend('tl') || rows.some((r) => Object.values(r.sizes).some((m) => m.tlLoadMs > 0 || m.tlFramesRendered > 0));

const { html, json } = buildReport({
    rows, sizes, filesTotal: list.length, totalMs, emptySkipped, runs, loadRuns, eqMode,
    tlFrames, oursFrames, tlTolerance, args, scriptName: 'bench-corpus-parallel.mjs', label,
    workers, maxCap, fatalCount, tlActive, oursActive, tsBench, wasmActive,
    counters, repoRoot: REPO_ROOT
});

if (outJson) {
    writeFileSync(outJson, JSON.stringify(json, null, 2));
    console.log('[corpus-parallel] json report: ' + outJson);
}
if (outHtml) {
    mkdirSync(dirname(outHtml), { recursive: true });
    writeFileSync(outHtml, html);
    console.log('[corpus-parallel] html report: ' + outHtml);
}
process.exitCode = fatalCount > 0 ? 1 : 0;
