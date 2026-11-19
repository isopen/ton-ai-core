// Shared corpus-benchmark report: per-size aggregation, console summary, HTML + JSON.
// Both bench-corpus.mjs (sequential) and bench-corpus-parallel.mjs render through this,
// so the two reports stay identical apart from the run banner.
import { relative } from 'node:path';

export const MB = (b) => b / (1024 * 1024);
export const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
export const msPerFrame = (ms, frames) => (frames > 0 && ms > 0 ? ms / frames : 0);
export const deltaPct = (a, b) => (a > 0 && b > 0 ? ((a - b) / b) * 100 : null);
export const deltaText = (v) => (v === null || !isFinite(v) ? '-' : (v > 0 ? '+' : '') + v.toFixed(1) + '%' + (v > 0 ? ' slower' : ' faster'));
export const pcts = (arr) => {
    const a = [...arr].sort((x, y) => x - y);
    return { p50: a[Math.floor(a.length * 0.5)] || 0, p95: a[Math.floor(a.length * 0.95)] || 0, max: a[a.length - 1] || 0 };
};

const TOP_PACKS = 8;
const TOP_FILES = 12;

function aggregateSize(rows, size, opts) {
    const entries = [];
    for (const r of rows) {
        const m = r.sizes?.[size];
        if (m) entries.push({ r, m });
    }
    const tlLoadRows = entries.filter((e) => e.m.tlLoadMs > 0);
    const tlRenderRows = entries.filter((e) => e.m.tlFramesRendered > 0 && e.m.tlRenderMs > 0);
    const tlFramesTotal = tlRenderRows.reduce((s, e) => s + e.m.tlFramesRendered, 0);
    const tlRenderMsTotal = tlRenderRows.reduce((s, e) => s + e.m.tlRenderMs, 0);
    const oursLoadRows = entries.filter((e) => e.m.oursLoadMs > 0);
    const oursRenderRows = entries.filter((e) => e.m.oursFramesRendered > 0 && e.m.oursRenderMs > 0);
    const oursFramesTotal = oursRenderRows.reduce((s, e) => s + e.m.oursFramesRendered, 0);
    const oursRenderMsTotal = oursRenderRows.reduce((s, e) => s + e.m.oursRenderMs, 0);

    const tlLoadP = pcts(tlLoadRows.map((e) => e.m.tlLoadMs));
    const oursLoadP = pcts(oursLoadRows.map((e) => e.m.oursLoadMs));
    const tlLoadAvg = mean(tlLoadRows.map((e) => e.m.tlLoadMs));
    const oursLoadAvg = mean(oursLoadRows.map((e) => e.m.oursLoadMs));
    const tlPerFrame = msPerFrame(tlRenderMsTotal, tlFramesTotal);
    const oursPerFrame = msPerFrame(oursRenderMsTotal, oursFramesTotal);

    const primaryOk = (e) => (opts.oursActive ? e.m.oursOk : (opts.tlActive ? e.m.tlOk : e.r.tsOk));
    const packs = new Map();
    for (const e of entries) {
        const { r, m } = e;
        let p = packs.get(r.pack);
        if (!p) {
            p = {
                pack: r.pack, files: 0, ok: 0, bad: 0, bytes: 0, tsMs: 0, wasmMs: 0, eq: [],
                tlLoadMs: 0, tlLoadN: 0, tlFrames: 0, tlRenderMs: 0, tlRenderN: 0,
                oursLoadMs: 0, oursLoadN: 0, oursFrames: 0, oursRenderMs: 0, oursRenderN: 0
            };
            packs.set(r.pack, p);
        }
        p.files++; p.bytes += r.bytes;
        p.tsMs += r.tsMs; p.wasmMs += r.wasmMs;
        if (primaryOk(e)) p.ok++; else p.bad++;
        if (r.eq !== null && r.eq !== undefined) p.eq.push(r.eq);
        if (m.tlLoadMs > 0) { p.tlLoadMs += m.tlLoadMs; p.tlLoadN++; }
        if (m.tlFramesRendered > 0) {
            p.tlFrames += m.tlFramesRendered;
            if (m.tlRenderMs > 0) { p.tlRenderMs += m.tlRenderMs; p.tlRenderN++; }
        }
        if (m.oursLoadMs > 0) { p.oursLoadMs += m.oursLoadMs; p.oursLoadN++; }
        if (m.oursFramesRendered > 0) {
            p.oursFrames += m.oursFramesRendered;
            if (m.oursRenderMs > 0) { p.oursRenderMs += m.oursRenderMs; p.oursRenderN++; }
        }
    }
    const packRows = [...packs.values()].map((p) => {
        const tlLoadAvgP = p.tlLoadN ? p.tlLoadMs / p.tlLoadN : null;
        const oursLoadAvgP = p.oursLoadN ? p.oursLoadMs / p.oursLoadN : null;
        const tlMsPerFrame = p.tlRenderMs > 0 ? p.tlRenderMs / p.tlFrames : null;
        const oursMsPerFrame = p.oursRenderMs > 0 ? p.oursRenderMs / p.oursFrames : null;
        return {
            ...p,
            bytesMiB: MB(p.bytes),
            avgKB: p.bytes / p.files / 1024,
            tsThr: p.tsMs > 0 ? MB(p.bytes) / (p.tsMs / 1000) : 0,
            wasmThr: p.wasmMs > 0 ? MB(p.bytes) / (p.wasmMs / 1000) : 0,
            diff: (p.tsMs > 0 && p.wasmMs > 0) ? ((p.wasmMs - p.tsMs) / p.tsMs) * 100 : null,
            tlLoadAvg: tlLoadAvgP,
            tlFms: p.tlRenderMs > 0 ? p.tlFrames / p.tlRenderMs : null,
            tlMsPerFrame,
            oursLoadAvg: oursLoadAvgP,
            oursFms: p.oursRenderMs > 0 ? p.oursFrames / p.oursRenderMs : null,
            oursMsPerFrame,
            loadVsTl: (tlLoadAvgP && oursLoadAvgP) ? ((oursLoadAvgP - tlLoadAvgP) / tlLoadAvgP) * 100 : null,
            oursFVsTl: (tlMsPerFrame && oursMsPerFrame) ? ((oursMsPerFrame - tlMsPerFrame) / tlMsPerFrame) * 100 : null
        };
    }).sort((a, b) => a.pack.localeCompare(b.pack));

    const tlOkCount = entries.filter((e) => e.m.tlOk).length;
    const oursOkCount = entries.filter((e) => e.m.oursOk).length;
    const slowFiles = entries
        .filter((e) => e.m.oursFramesRendered > 0 && e.m.oursRenderMs > 0)
        .sort((a, b) => msPerFrame(b.m.oursRenderMs, b.m.oursFramesRendered) - msPerFrame(a.m.oursRenderMs, a.m.oursFramesRendered))
        .slice(0, TOP_FILES);
    const slowPacks = [...packRows]
        .filter((p) => p.loadVsTl !== null)
        .sort((a, b) => b.loadVsTl - a.loadVsTl)
        .slice(0, TOP_PACKS);

    return {
        size, entries: entries.length,
        tlOkCount, oursOkCount,
        tlLoadRows: tlLoadRows.length, oursLoadRows: oursLoadRows.length,
        tlLoadAvg, oursLoadAvg, tlLoadP, oursLoadP,
        tlFramesTotal, oursFramesTotal, tlRenderMsTotal, oursRenderMsTotal,
        tlFms: tlRenderMsTotal > 0 ? tlFramesTotal / tlRenderMsTotal : 0,
        oursFms: oursRenderMsTotal > 0 ? oursFramesTotal / oursRenderMsTotal : 0,
        tlPerFrame, oursPerFrame,
        loadDelta: deltaPct(oursLoadAvg, tlLoadAvg),
        renderDelta: deltaPct(oursPerFrame, tlPerFrame),
        packRows, slowFiles, slowPacks
    };
}

const SORT_SCRIPT = '<script>document.querySelectorAll("th").forEach(t=>t.addEventListener("click",()=>{const tb=t.closest("table").querySelector("tbody");const i=[...t.parentNode.children].indexOf(t);const asc=!(tb.dataset.asc==="1");tb.dataset.asc=asc?"1":"0";[...tb.querySelectorAll("tr")].sort((a,b)=>{const x=a.children[i]?.innerText??"",y=b.children[i]?.innerText??"";const nx=parseFloat(x),ny=parseFloat(y);const c=(!isNaN(nx)&&!isNaN(ny))?nx-ny:(isNaN(nx)?1:0)-(isNaN(ny)?1:0)||x.localeCompare(y);return asc?c:-c;}).forEach((r)=>tb.appendChild(r));}));</script>';

const STYLE = '' +
    'body{font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#1c1e21;background:#fff}' +
    'h1{font-size:20px;margin:0 0 12px}h2{font-size:16px;margin:22px 0 6px}' +
    '.meta{color:#555;margin-bottom:14px;white-space:pre-wrap;word-break:break-all}' +
    '.summary{background:#f4f6f8;border:1px solid #dde3ea;border-radius:8px;padding:10px 14px;margin:10px 0 16px}' +
    '.summary>div{padding:2px 0}' +
    '.note{color:#555;font-size:12px;margin-top:6px;white-space:normal}' +
    '.warn{color:#b26b00;font-size:12px;margin-top:6px}' +
    'table{border-collapse:collapse;width:100%;font-size:13px}' +
    'th,td{border-bottom:1px solid #eceef1;padding:4px 8px;text-align:right;white-space:nowrap}' +
    'th:first-child,td:first-child{text-align:left;max-width:340px;overflow:hidden;text-overflow:ellipsis}' +
    'th{cursor:pointer;background:#fafbfc;user-select:none}' +
    '.good{color:#12813d;font-weight:600}.warnc{color:#b26b00}.bad{color:#c4291d;font-weight:600}' +
    'details{margin:10px 0}summary{cursor:pointer}' +
    '.pkd table{font-size:12px}' +
    '.sizetag{display:inline-block;font-size:11px;font-weight:600;color:#555;background:#eef2f5;border-radius:4px;padding:1px 6px;margin-left:6px}';

export function buildReport(opts) {
    const {
        rows, sizes, filesTotal, totalMs, emptySkipped, runs, loadRuns, eqMode,
        tlFrames, oursFrames, tlTolerance, args, scriptName, label, workers,
        maxCap, fatalCount, tlActive, oursActive, tsBench, wasmActive, counters, repoRoot
    } = opts;

    const totalBytes = rows.reduce((s, r) => s + r.bytes, 0);
    const tsTotal = rows.reduce((s, r) => s + r.tsMs, 0);
    const wasmTotal = rows.reduce((s, r) => s + r.wasmMs, 0);
    const tsOkCount = rows.filter((r) => r.tsOk).length;
    const wasmOkCount = rows.filter((r) => r.wasmOk).length;
    const eqOkCount = rows.filter((r) => r.eq === true).length;
    const eqBadCount = rows.filter((r) => r.eq === false).length;
    const tsThr = tsTotal > 0 ? MB(totalBytes) / (tsTotal / 1000) : 0;
    const wasmThr = wasmTotal > 0 ? MB(totalBytes) / (wasmTotal / 1000) : 0;
    const tsP = pcts(rows.map((r) => r.tsMs));
    const wasmP = pcts(rows.map((r) => r.wasmMs));
    const packCount = new Set(rows.map((r) => r.pack)).size;
    const eqMismatchFiles = rows.filter((r) => r.eq === false).slice(0, 20);

    const perSize = sizes.map((size) => aggregateSize(rows, size, { tlActive, oursActive }));

    // ------------------------------------------------------------ console
    const tag = '[' + label + ']';
    console.log(tag + ' files=' + rows.length + ' | total=' + MB(totalBytes).toFixed(1) + ' MiB | packs=' + packCount
        + ' | gunzip_fails=' + counters.gunzipFails + ' | read_fails=' + counters.readFails + ' | empty_skipped=' + emptySkipped
        + ' | runs=' + runs + ' | load_runs=' + loadRuns + ' | eq=' + eqMode + ' | sizes=' + sizes.join(',')
        + ' | frames=' + tlFrames + ' | total_time=' + (totalMs / 1000).toFixed(1) + 's'
        + (workers ? ' | workers=' + workers : ''));
    if (tsBench) {
        console.log(tag + ' ts   : ' + tsThr.toFixed(2) + ' MB/s | avg ' + (rows.length ? (tsTotal / rows.length).toFixed(2) : '0')
            + 'ms | p50 ' + tsP.p50.toFixed(2) + 'ms | p95 ' + tsP.p95.toFixed(2) + 'ms | max ' + tsP.max.toFixed(2) + 'ms | ok=' + tsOkCount + '/' + rows.length);
    }
    if (wasmActive) {
        console.log(tag + ' wasm : ' + wasmThr.toFixed(2) + ' MB/s | avg ' + (rows.length ? (wasmTotal / rows.length).toFixed(2) : '0')
            + 'ms | p50 ' + wasmP.p50.toFixed(2) + 'ms | p95 ' + wasmP.p95.toFixed(2) + 'ms | max ' + wasmP.max.toFixed(2) + 'ms | ok=' + wasmOkCount + '/' + rows.length
            + ' | eq ok=' + eqOkCount + ' bad=' + eqBadCount);
    }
    for (const s of perSize) {
        if (tlActive) {
            console.log(tag + ' ' + String(s.size).padStart(3) + 'px: tl load avg ' + s.tlLoadAvg.toFixed(2) + 'ms (' + s.tlLoadRows + ' samples) | p50 ' + s.tlLoadP.p50.toFixed(2)
                + 'ms | ok=' + s.tlOkCount + '/' + s.entries + ' | render ' + s.tlPerFrame.toFixed(3) + ' ms/frame fms=' + s.tlFms.toFixed(2)
                + ' (' + s.tlFramesTotal + ' frames)');
        }
        if (oursActive) {
            console.log(tag + ' ' + String(s.size).padStart(3) + 'px: ours load avg ' + s.oursLoadAvg.toFixed(2) + 'ms (' + s.oursLoadRows + ' samples) | p50 ' + s.oursLoadP.p50.toFixed(2)
                + 'ms | ok=' + s.oursOkCount + '/' + s.entries + ' | render ' + s.oursPerFrame.toFixed(3) + ' ms/frame fms=' + s.oursFms.toFixed(2)
                + ' (' + s.oursFramesTotal + ' frames)'
                + (tlActive ? ' | load vs tl ' + deltaText(s.loadDelta) + ' | render vs tl ' + deltaText(s.renderDelta) : ''));
        }
    }
    if (tlActive && oursActive) {
        for (const s of perSize) {
            console.log(tag + ' top slow packs @ ' + s.size + 'px (ours load vs tl):');
            for (const p of s.slowPacks) {
                console.log('  ' + deltaText(p.loadVsTl) + '  ours ' + (p.oursLoadAvg === null ? '-' : p.oursLoadAvg.toFixed(2))
                    + 'ms / tl ' + (p.tlLoadAvg === null ? '-' : p.tlLoadAvg.toFixed(2)) + 'ms  ' + p.files + ' files  '
                    + p.bytesMiB.toFixed(2) + ' MiB  ' + p.pack);
            }
        }
    }
    if (oursActive) {
        for (const s of perSize) {
            console.log(tag + ' top slow files @ ' + s.size + 'px (ours render ms/frame):');
            for (const e of s.slowFiles) {
                console.log('  ' + msPerFrame(e.m.oursRenderMs, e.m.oursFramesRendered).toFixed(3) + 'ms/frame  fms '
                    + (e.m.oursRenderMs > 0 ? (e.m.oursFramesRendered / e.m.oursRenderMs).toFixed(2) : '-')
                    + '  vs tl ' + deltaText(deltaPct(msPerFrame(e.m.oursRenderMs, e.m.oursFramesRendered), msPerFrame(e.m.tlRenderMs, e.m.tlFramesRendered)))
                    + '  ' + (e.r.bytes / 1024).toFixed(0) + 'KB  ' + relative(repoRoot, e.r.file));
            }
        }
    }
    if (workers) console.log(tag + ' NOTE: parallel timings are inflated by CPU contention — use this run for ok/eq/err counters; run bench-corpus.mjs sequentially for perf numbers.');
    if (fatalCount > 0) console.log(tag + ' WARNING: ' + fatalCount + ' worker failures (partial results).');

    // ------------------------------------------------------------ html
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const f2 = (v, d = 2) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : '-';
    const renderCell = (v) => v === null || !isFinite(v) ? '-' : '<span class="' + (v < 0 ? 'good' : 'warnc') + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '</span>';
    const ratioTitle = 'positive = ours slower, negative = ours faster';

    const cmdline = 'node tools/' + scriptName + ' ' + args.map((a) => '"' + a + '"').join(' ') +
        '  [env: TGS_CORPUS_RUNS=' + runs + ' TGS_CORPUS_LOAD_RUNS=' + loadRuns + ' TGS_CORPUS_MAX=' + maxCap + ' TGS_CORPUS_EQ=' + eqMode +
        ' TGS_BENCH_WASM=' + (process.env.TGS_BENCH_WASM || '1') + ' TGS_BENCH_TL=' + (process.env.TGS_BENCH_TL || '1') +
        (tsBench ? ' TGS_BENCH_TS=1' : '') +
        ' TGS_SIZES=' + sizes.join(',') + ' TGS_LOTTIE_FRAMES=' + tlFrames + ' TGS_LOTTIE_TOLERANCE=' + tlTolerance +
        ' TGS_OURS_FRAMES=' + oursFrames + ']';
    const env = 'node ' + process.version + '; ' + process.platform + '/' + process.arch + (workers ? '; workers=' + workers : '');
    const tlBadge = tlActive
        ? 'tlottie reference active (dkaraush/tlottie wasm; ' + tlFrames + ' frames/file per size, aa on, curveTolerance ' + tlTolerance + '; load = uploaded bytes→model)'
        : 'tlottie reference unavailable';
    const oursBadge = oursActive
        ? 'ours renderer active (rust wasm; ' + oursFrames + ' frames/file per size; load = UTF-8 encode→JSON→model+instance+pixbuf)'
        : 'ours renderer unavailable';

    const globalSummary = '' +
        '<div class="summary">' +
        '<div><b>files</b> ' + rows.length + ' of ' + filesTotal + (maxCap > 0 ? ' (capped at ' + maxCap + ')' : '')
        + ' · <b>corpus</b> ' + MB(totalBytes).toFixed(1) + ' MiB · ' + packCount + ' packs · <b>sizes</b> '
        + sizes.map((s) => s + 'px').join(' / ') + (workers ? ' · <b>workers</b> ' + workers : '')
        + ' · wall ' + (totalMs / 1000).toFixed(1) + 's</div>' +
        (tsBench ? '<div><b>ts</b> ' + f2(tsThr) + ' MB/s · avg ' + f2(rows.length ? tsTotal / rows.length : 0) + ' ms · ok ' + tsOkCount + '/' + rows.length + '</div>' : '') +
        (wasmActive ? '<div><b>wasm parse</b> ' + f2(wasmThr) + ' MB/s · avg ' + f2(rows.length ? wasmTotal / rows.length : 0) + ' ms · ok ' + wasmOkCount + '/' + rows.length + '</div>' : '') +
        (tsBench && wasmActive ? '<div><b>eq</b> (ts≡wasm, ' + eqMode + '): ' + eqOkCount + ' ok / ' + eqBadCount + ' bad · gunzip fails ' + counters.gunzipFails + '</div>' : '') +
        (workers ? '<div class="warn">parallel timings are inflated by CPU contention — compare ratios, and use bench-corpus.mjs for absolute numbers</div>' : '') +
        '<div class="note">load is not the same operation: ours = UTF-8 encode + JSON→model + render instance + pixbuf; tlottie = uploaded bytes→model. Load is min of ' + loadRuns + ' samples per file, measurement order alternates per file. tlottie load does not depend on the output size, so it is measured once per file and shared across the size tables. Δ% is wall time for the same operation only when both backends do it; positive = ours slower.</div>' +
        '</div>';

    const sizeSummary = (s) => '<div class="summary">' +
        (tlActive ? '<div><b>tlottie</b> load avg ' + f2(s.tlLoadAvg) + ' ms (' + s.tlLoadRows + ' samples) · p50 ' + f2(s.tlLoadP.p50) + ' ms · p95 ' + f2(s.tlLoadP.p95)
            + ' ms · ok ' + s.tlOkCount + '/' + s.entries + ' · render ' + f2(s.tlPerFrame, 3) + ' ms/frame · fms ' + f2(s.tlFms) + ' · ' + s.tlFramesTotal + ' frames</div>' : '') +
        (oursActive ? '<div><b>ours (rust wasm)</b> load avg ' + f2(s.oursLoadAvg) + ' ms (' + s.oursLoadRows + ' samples) · p50 ' + f2(s.oursLoadP.p50) + ' ms · p95 ' + f2(s.oursLoadP.p95)
            + ' ms · ok ' + s.oursOkCount + '/' + s.entries + ' · render ' + f2(s.oursPerFrame, 3) + ' ms/frame · fms ' + f2(s.oursFms) + ' · ' + s.oursFramesTotal + ' frames</div>' : '') +
        (tlActive && oursActive ? '<div><b>deltas</b> load ' + deltaText(s.loadDelta) + ' · render ' + f2(s.oursPerFrame, 3) + ' ms/frame vs ' + f2(s.tlPerFrame, 3) + ' ms/frame = ' + deltaText(s.renderDelta) + '</div>' : '') +
        '</div>';

    const packTable = (s) => '<table id="packs-' + s.size + '">' +
        '<thead><tr>' +
        '<th>pack</th><th>files</th><th title="failed loads of the primary backend">fail</th><th>MiB</th><th>avg&nbsp;KB</th>' +
        (tsBench ? '<th>ts&nbsp;ms</th><th>ts&nbsp;MB/s</th>' : '') +
        (tsBench && wasmActive ? '<th>wasm&nbsp;ms</th><th>wasm&nbsp;MB/s</th>' : '') +
        (tlActive ? '<th>tlot&nbsp;load&nbsp;ms</th><th>tlot&nbsp;ms/frame</th><th>tlot&nbsp;fms</th>' : '') +
        (oursActive ? '<th>ours&nbsp;load&nbsp;ms</th><th>ours&nbsp;ms/frame</th><th>ours&nbsp;fms</th>' : '') +
        (tlActive && oursActive ? '<th title="' + ratioTitle + '">load&nbsp;Δ%&nbsp;(ours/tlot)</th><th title="' + ratioTitle + '">render&nbsp;Δ%&nbsp;(ours/tlot)</th>' : '') +
        (tsBench && wasmActive ? '<th title="negative = wasm faster">wasm&nbsp;vs&nbsp;ts&nbsp;Δ%</th><th>eq&nbsp;ok</th><th>eq&nbsp;bad</th>' : '') +
        '</tr></thead><tbody>' +
        s.packRows.map((p) => '<tr>' +
            '<td class="pk"><a href="https://t.me/addstickers/' + encodeURIComponent(p.pack) + '">' + esc(p.pack) + '</a></td>' +
            '<td>' + p.files + '</td>' +
            '<td class="' + (p.bad ? 'bad' : '') + '">' + p.bad + '</td>' +
            '<td>' + f2(p.bytesMiB, p.bytesMiB < 0.1 ? 3 : 2) + '</td>' +
            '<td>' + f2(p.avgKB, 0) + '</td>' +
            (tsBench ? '<td>' + f2(p.tsMs / p.files) + '</td><td>' + f2(p.tsThr) + '</td>' : '') +
            (tsBench && wasmActive ? '<td>' + f2(p.wasmMs / p.files) + '</td><td>' + f2(p.wasmThr) + '</td>' : '') +
            (tlActive ? '<td>' + f2(p.tlLoadAvg) + '</td><td>' + f2(p.tlMsPerFrame, 3) + '</td><td>' + f2(p.tlFms) + '</td>' : '') +
            (oursActive ? '<td>' + f2(p.oursLoadAvg) + '</td><td>' + f2(p.oursMsPerFrame, 3) + '</td><td>' + f2(p.oursFms) + '</td>' : '') +
            (tlActive && oursActive ? '<td>' + renderCell(p.loadVsTl) + '</td><td>' + renderCell(p.oursFVsTl) + '</td>' : '') +
            (tsBench && wasmActive ? '<td class="' + (p.diff !== null && p.diff < 0 ? 'good' : 'warnc') + '">' + (p.diff !== null ? (p.diff > 0 ? '+' : '') + p.diff.toFixed(1) : '-') + '</td>' +
                '<td class="pk">' + p.eq.filter((e) => e === true).length + '</td>' +
                '<td class="' + (p.eq.some((e) => e === false) ? 'bad' : '') + '">' + p.eq.filter((e) => e === false).length + '</td>' : '') +
            '</tr>').join('') +
        '</tbody></table>';

    const fileTable = (s) => s.packRows.map((p) => {
        const files = rows.filter((r) => r.pack === p.pack && r.sizes?.[s.size]);
        return '<details class="pkd"><summary>' + esc(p.pack) + ' (' + files.length + ')</summary>' +
            '<table><thead><tr><th>file</th><th>size&nbsp;KB</th>' +
            (tsBench ? '<th>ts&nbsp;ms</th>' : '') +
            (tlActive ? '<th>tlot&nbsp;load&nbsp;ms</th><th>tlot&nbsp;frames</th><th>tlot&nbsp;ms/frame</th><th>tlot&nbsp;dims</th>' : '') +
            (oursActive ? '<th>ours&nbsp;load&nbsp;ms</th><th>ours&nbsp;frames</th><th>ours&nbsp;ms/frame</th>' : '') +
            (tlActive && oursActive ? '<th title="' + ratioTitle + '">load&nbsp;Δ%</th><th title="' + ratioTitle + '">render&nbsp;Δ%</th>' : '') +
            (tsBench && wasmActive ? '<th>eq</th>' : '') +
            '</tr></thead><tbody>' +
            files.map((r) => {
                const m = r.sizes[s.size];
                return '<tr><td class="pk">' + esc(r.file.split(/[\\/]/).pop()) + '</td>' +
                    '<td>' + f2(r.bytes / 1024, 0) + '</td>' +
                    (tsBench ? '<td>' + f2(r.tsMs) + '</td>' : '') +
                    (tlActive ? '<td>' + (m.tlLoadMs > 0 ? f2(m.tlLoadMs, 3) : '&#10007;') + '</td><td>' + (m.tlFramesRendered || 0) + '</td><td>'
                        + f2(msPerFrame(m.tlRenderMs, m.tlFramesRendered), 3) + '</td><td class="pk">' + esc(m.tlDims || '') + '</td>' : '') +
                    (oursActive ? '<td>' + (m.oursLoadMs > 0 ? f2(m.oursLoadMs, 3) : '&#10007;') + '</td><td>' + (m.oursFramesRendered || 0) + '</td><td>'
                        + f2(msPerFrame(m.oursRenderMs, m.oursFramesRendered), 3) + '</td>' : '') +
                    (tlActive && oursActive ? '<td>' + renderCell(deltaPct(m.oursLoadMs, m.tlLoadMs)) + '</td><td>'
                        + renderCell(deltaPct(msPerFrame(m.oursRenderMs, m.oursFramesRendered), msPerFrame(m.tlRenderMs, m.tlFramesRendered))) + '</td>' : '') +
                    (tsBench && wasmActive ? '<td>' + (r.eq === null || r.eq === undefined ? '-' : (r.eq ? '=' : '!')) + '</td>' : '') +
                    '</tr>';
            }).join('') +
            '</tbody></table></details>';
    }).join('');

    const details = '<h2>per-pack details</h2>' +
        perSize.map((s) => '<details><summary><span class="sizetag">' + s.size + 'px</span> ' + s.packRows.length + ' packs</summary>' + fileTable(s) + '</details>').join('');

    const slowLists = perSize.map((s) => '<h2>top slowest files<span class="sizetag">' + s.size + 'px</span></h2><ol>' +
        s.slowFiles.map((e) => '<li>' + f2(msPerFrame(e.m.oursRenderMs, e.m.oursFramesRendered), 3) + ' ms/frame · fms '
            + (e.m.oursRenderMs > 0 ? f2(e.m.oursFramesRendered / e.m.oursRenderMs) : '-') + ' · vs tl '
            + deltaText(deltaPct(msPerFrame(e.m.oursRenderMs, e.m.oursFramesRendered), msPerFrame(e.m.tlRenderMs, e.m.tlFramesRendered)))
            + ' · ' + f2(e.r.bytes / 1024, 0) + ' KB · ' + esc(relative(repoRoot, e.r.file) || e.r.file) + '</li>').join('') +
        '</ol>').join('');

    const html = '' +
        '<!doctype html><html><head><meta charset="utf-8"><title>tgs corpus benchmark' + (workers ? ' (parallel)' : '') + '</title>' +
        '<style>' + STYLE + '</style></head><body>' +
        '<h1>tgs corpus benchmark' + (workers ? ' (parallel)' : '') + '</h1>' +
        '<div class="meta">' + esc(cmdline) + '\n' + env + '\n' + tlBadge + '\n' + oursBadge + '</div>' +
        globalSummary +
        perSize.map((s) => '<h2>' + s.size + 'px</h2>' + sizeSummary(s) + packTable(s)).join('') +
        details +
        slowLists +
        (eqBadCount ? '<h2>eq mismatches</h2><ol>' + eqMismatchFiles.map((r) => '<li>' + esc(relative(repoRoot, r.file) || r.file) + '</li>').join('') + '</ol>' : '') +
        SORT_SCRIPT +
        '</body></html>';

    const json = {
        generatedAt: new Date().toISOString(),
        runs, loadRuns, eqMode, files: rows.length, totalBytes, sizes,
        env: { workers: workers || null, wallMs: totalMs, emptySkipped, maxCap, tlFrames, tlTolerance, oursFrames },
        counters,
        ts: tsBench ? { thr: tsThr, ...tsP, ok: tsOkCount } : null,
        wasm: wasmActive ? { thr: wasmThr, ...wasmP, ok: wasmOkCount, eqOk: eqOkCount, eqBad: eqBadCount } : null,
        perSize: Object.fromEntries(perSize.map((s) => [String(s.size), {
            tlottie: tlActive ? {
                loadAvgMs: s.tlLoadAvg, loadSamples: s.tlLoadRows, ...s.tlLoadP, ok: s.tlOkCount,
                renderFms: s.tlFms, msPerFrame: s.tlPerFrame, frames: s.tlFramesTotal
            } : null,
            ours: oursActive ? {
                loadAvgMs: s.oursLoadAvg, loadSamples: s.oursLoadRows, ...s.oursLoadP, ok: s.oursOkCount,
                renderFms: s.oursFms, msPerFrame: s.oursPerFrame, frames: s.oursFramesTotal
            } : null,
            deltas: { loadPct: s.loadDelta, renderPct: s.renderDelta },
            packs: s.packRows
        }])),
        fileRows: rows.map((r) => ({
            file: relative(repoRoot, r.file), pack: r.pack, bytes: r.bytes,
            ts: { ok: r.tsOk, ms: r.tsMs }, wasm: { ok: r.wasmOk, ms: r.wasmMs }, eq: r.eq,
            sizes: Object.fromEntries(sizes.map((size) => [String(size), r.sizes[size]]))
        }))
    };

    return { perSize, html, json };
}
