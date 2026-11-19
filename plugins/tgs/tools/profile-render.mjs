import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..');
const glueDir = process.env.TGS_PROFILE_GLUE || join(process.env.HOME || REPO_ROOT, '.cache', 'tgs-wasm-prof');

const glue = await import(glueDir + '/tgs_wasm.js');
await glue.default(new URL(glueDir + '/tgs_wasm_bg.wasm', 'file:///'));
if (typeof glue.profReset !== 'function' || typeof glue.profStats !== 'function') {
    console.error('[tgs-profile] prof exports missing: rebuild wasm (build.sh)');
    process.exit(1);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const corpus = args[0] ? (isAbsolute(args[0]) ? args[0] : join(REPO_ROOT, args[0])) : '/home/user/Documents/tgs_data';
const packFilter = (process.env.TGS_PROFILE_PACKS || 'MatrixFont,SlimeFontEmoji,SocialEmojis,GlowingFont,EmojiStatus,WallyOwl,CupidKitty,TenYearsOfTelegram,StaticEmoji')
    .split(',').map((s) => s.trim()).filter(Boolean);
const perPack = Math.max(1, Number(process.env.TGS_PROFILE_PER_PACK || 10));
const framesN = Math.max(1, Number(process.env.TGS_PROFILE_FRAMES || 30));
const sizePx = Math.max(8, Number(process.env.TGS_PROFILE_SIZE || 64));

const PHASES = ['blitn', 'blitd', 'interp', 'shape', 'trim', 'paint', 'blit', 'clone', 'pcmd', 'pstyle', 'fill', 'stroke', 'prep', 'sprep', 'sras', 'fprep', 'fras', 'frow', 'rc', 'rs', 'rw', 'scalls', 'sstable', 'ract', 'rinit', 'rzc', 'frowm', 'frowg', 'frowx', 'frowu', 'frowul', 'frowur', 'covrow', 'srasdl', 'srassw', 'frowus', 'adl', 'asw', 'ssort', 'repc', 'xfrm', 'keys', 'spts', 'sinp', 'fpts', 'covhit', 'srchit'];
const OVERLAP = new Set(['paint', 'stroke', 'fill', 'rc', 'rs', 'rw', 'scalls', 'sstable', 'ract', 'rinit', 'rzc', 'frowm', 'frowg', 'frowx', 'frowu', 'frowul', 'frowur', 'covrow', 'srasdl', 'srassw', 'frowus', 'adl', 'asw', 'ssort', 'repc', 'xfrm', 'keys', 'spts', 'sinp', 'fpts', 'covhit', 'srchit']);
const byPack = new Map();
for (const p of packFilter) byPack.set(p, { files: [], wasm: null });

const scan = (dir, packName) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { scan(p, packName); continue; }
        if (!e.name.endsWith('.tgs')) continue;
        const st = statSync(p);
        if (st.size === 0) continue;
        const rel = relative(corpus, p).split(/[\\/]/);
        const pk = rel.length >= 2 ? rel[rel.length - 2] : '(root)';
        if (!byPack.has(pk)) continue;
        const bucket = byPack.get(pk);
        if (bucket.files.length < perPack) bucket.files.push(p);
    }
};
scan(corpus, null);

const toText = (data) => {
    if (data[0] === 0x1f && data[1] === 0x8b) return gunzipSync(data).toString('utf8');
    return data.toString('utf8');
};

console.log('[tgs-profile] corpus=' + corpus + ' | packs=' + packFilter.length + ' | per_pack=' + perPack + ' | frames=' + framesN + ' @ ' + sizePx + 'px | glue=' + relative(REPO_ROOT, glueDir));

const results = [];
for (const [pack, bucket] of byPack) {
    if (bucket.files.length === 0) {
        console.log('[tgs-profile] pack ' + pack + ': no files found');
        continue;
    }
    let packRenderMs = 0, packLoadMs = 0, packFrames = 0, packFiles = 0, packErrs = 0;
    const packPhases = {};
    for (const ph of PHASES) packPhases[ph] = 0;
    for (const file of bucket.files) {
        try {
            const data = readFileSync(file);
            const json = toText(data);
            glue.profReset();
            const t0 = performance.now();
            const r = new glue.TgsRender(json, sizePx, sizePx);
            const ip = r.in_frame();
            const fc = Math.max(1, r.frame_count());
            const t1 = performance.now();
            const n = Math.min(fc, framesN);
            const t2 = performance.now();
            for (let f = 0; f < n; f++) r.render(ip + f, sizePx, sizePx);
            const t3 = performance.now();
            r.free();
            const stats = JSON.parse(glue.profStats());
            packLoadMs += t1 - t0;
            packRenderMs += t3 - t2;
            packFrames += n;
            packFiles++;
            for (const ph of PHASES) packPhases[ph] += stats[ph] || 0;
        } catch (e) {
            packErrs++;
            if (packErrs <= 2) console.log('[tgs-profile] ' + pack + ' error: ' + String(e?.message || e).slice(0, 90));
        }
    }
    const phaseSum = PHASES.reduce((s, ph) => s + packPhases[ph], 0);
    const baseSum = PHASES.reduce((s, ph) => s + (OVERLAP.has(ph) ? 0 : packPhases[ph]), 0);
    const pct = (v) => (baseSum > 0 ? (v / baseSum * 100).toFixed(1).padStart(5) : '    -');
    const fms = packRenderMs > 0 ? packFrames / packRenderMs : 0;
    results.push({ pack, packFiles, packFrames, packRenderMs, packLoadMs, fms, packPhases, phaseSum });
    console.log('[tgs-profile] ' + pack.padEnd(22)
        + ' files=' + packFiles + '/' + bucket.files.length
        + ' frames=' + packFrames
        + ' loadMs=' + packLoadMs.toFixed(1)
        + ' renderMs=' + packRenderMs.toFixed(1)
        + ' fms=' + fms.toFixed(2)
        + (phaseSum > 0 ? ' | interp=' + pct(packPhases.interp) + '% shape=' + pct(packPhases.shape) + '% trim=' + pct(packPhases.trim) + '% blit=' + pct(packPhases.blit) + '% clone=' + pct(packPhases.clone)
            + ' | paint-sub: pcmd=' + pct(packPhases.pcmd) + '% pstyle=' + pct(packPhases.pstyle) + '% fill=' + pct(packPhases.fill) + '% stroke=' + pct(packPhases.stroke) + '%'
            + ' | stroke-sub: sprep=' + pct(packPhases.sprep) + '% sras=' + pct(packPhases.sras) + '% sdl=' + pct(packPhases.srasdl) + '% ssw=' + pct(packPhases.srassw) + '% paint=' + pct(packPhases.frowus + packPhases.frowul + packPhases.frowur) + '%'
            + ' | fill-sub: fprep=' + pct(packPhases.fprep) + '% fras=' + pct(packPhases.fras) + '% frow=' + pct(packPhases.frow) + '%'
            + ' | ras-sub: rc=' + pct(packPhases.rc) + '% rs=' + pct(packPhases.rs) + '% rw=' + pct(packPhases.rw) + '% ract=' + pct(packPhases.ract) + '% rinit=' + pct(packPhases.rinit) + '% rzc=' + pct(packPhases.rzc) + '%'
            + ' | wasm-phases=' + baseSum.toFixed(0) + 'ms js-in-render=' + Math.max(0, packRenderMs - baseSum).toFixed(0) + 'ms' : ''));
}

const tot = { frames: 0, ms: 0, loadMs: 0, phases: {} };
for (const ph of PHASES) tot.phases[ph] = 0;
let filesT = 0;
for (const r of results) {
    tot.frames += r.packFrames;
    tot.ms += r.packRenderMs;
    tot.loadMs += r.packLoadMs;
    filesT += r.packFiles;
    for (const ph of PHASES) tot.phases[ph] += r.packPhases[ph];
}
const baseSum = PHASES.reduce((s, ph) => s + (OVERLAP.has(ph) ? 0 : tot.phases[ph]), 0);
const sum = PHASES.reduce((s, ph) => s + tot.phases[ph], 0);
console.log('[tgs-profile] TOTAL files=' + filesT + ' frames=' + tot.frames + ' loadMs=' + tot.loadMs.toFixed(1) + ' renderMs=' + tot.ms.toFixed(1) + ' fms=' + (tot.ms > 0 ? tot.frames / tot.ms : 0).toFixed(2));
if (baseSum > 0) {
    console.log('[tgs-profile] phase split (non-overlap): ' + PHASES.filter((ph) => !OVERLAP.has(ph)).map((ph) => ph + ' ' + (tot.phases[ph] / baseSum * 100).toFixed(1) + '%').join(' | ')
        + ' | +overlap ' + [...OVERLAP].map((ph) => ph + ' ' + (tot.phases[ph] / baseSum * 100).toFixed(1) + '%').join(', ')
        + ' | js-in-render ' + Math.max(0, tot.ms - baseSum).toFixed(1) + 'ms (' + (Math.max(0, tot.ms - baseSum) / tot.ms * 100).toFixed(1) + '%)');
}
    if (tot.phases.spts > 0) console.log('[tgs-profile] geom: stroke-outline-pts=' + tot.phases.spts.toFixed(0) + ' stroke-input-pts=' + tot.phases.sinp.toFixed(0) + ' (ratio ' + (tot.phases.spts / Math.max(1, tot.phases.sinp)).toFixed(2) + ') fill-pts=' + tot.phases.fpts.toFixed(0));
const paintSub = tot.phases.pcmd + tot.phases.pstyle + tot.phases.fill + tot.phases.stroke;
if (paintSub > tot.phases.paint * 1.02 || paintSub < tot.phases.paint * 0.98) console.log('[tgs-profile] note: paint(cover)=' + tot.phases.paint.toFixed(0) + ' vs sum-of-subs=' + paintSub.toFixed(0) + 'ms — growing gap means unaccounted work inside draw_paints');
if (tot.phases.scalls > 0) console.log('[tgs-profile] diag stroke-calls=' + tot.phases.scalls.toFixed(0) + ' stable=' + tot.phases.sstable.toFixed(0) + ' (' + (tot.phases.sstable / tot.phases.scalls * 100).toFixed(1) + '%) — share of stroke calls with unchanged (cmds,width,cap,join,ml) vs previous frame');
