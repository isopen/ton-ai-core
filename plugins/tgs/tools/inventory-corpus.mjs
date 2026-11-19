// Feature inventory across a .tgs corpus (downloaded by tools/dump-tgs-corpus.js).
// Walks every file (gunzip + JSON.parse + shape/layer tree scan) and aggregates
// which Lottie primitives actually occur. Drives the scope of the native renderer.
//
// Usage:
//   node tools/inventory-corpus.mjs <corpus-dir>...   (recursive scan for *.tgs)
// Env:
//   TGS_INV_MAX=0      stop after N files (0 = all)
//   TGS_INV_OUT=path   write JSON totals (optional)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const maxFiles = Number(process.env.TGS_INV_MAX || 0);
const outFile = process.env.TGS_INV_OUT || '';
const progressEvery = Number(process.env.TGS_INV_PROGRESS || 500);

const files = new Set();
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
for (const a of process.argv.slice(2).filter((x) => !x.startsWith('-'))) {
    const p = isAbsolute(a) ? a : join(REPO_ROOT, a);
    const st = statSync(p);
    if (st.isDirectory()) scanDir(p); else files.add(p);
}
if (files.size === 0) {
    console.error('[inventory] no .tgs files found');
    process.exit(1);
}

const bump = (map, k, n = 1) => { map.set(k, (map.get(k) || 0) + n); };
const layers = new Map();   // layer types: ty:2 etc
const layersAnim = new Map(); // layers with any animated transform prop
const shapes = new Map();   // shape types: 'sh','el','rc','sr','fl','st','gs','gf','tm','rd','rp','mm','op','tr','gr'
const shapesAnim = new Map(); // shape types whose own props are animated (approx: subtree has any animated prop)
const flags = new Map();    // matte, blend, masks, dashes, fillRule, text, images, 3d, timeRemap, parent...
const grad = new Map();     // gradient kinds + size buckets
const animProps = new Map(); // which properties are animated (position, scale, opacity, rotation, vertices, trim, gradient stops...)
const animPropStyle = new Map(); // '#static' vs '#animated' occurrence style

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const asArr = (v) => Array.isArray(v) ? v : (isObj(v) && Array.isArray(v.k) ? v.k : null);

// detect classic lottie keyframe structure: {a:1, k:[{t,s,e,...}]}
const isAnimatedProp = (v) => {
    if (!isObj(v)) return false;
    if (v.a === 1) return true;
    const k = v.k;
    return Array.isArray(k) && k.length > 0 && isObj(k[0]) && ('t' in k[0] || 's' in k[0]);
};

const bumpProps = (v, tag) => {
    if (!isObj(v)) return;
    const animated = isAnimatedProp(v);
    bump(animPropStyle, animated ? '#animated' : '#static');
    if (animated) bump(animProps, tag);
};

const scanShapeTree = (list) => {
    if (!Array.isArray(list)) return;
    for (const sh of list) {
        if (!isObj(sh)) continue;
        const ty = String(sh.ty ?? '?');
        bump(shapes, ty);
        const partsAnimated = checkShapePropsAnimated(sh);
        if (partsAnimated) bump(shapesAnim, ty);
        scanShapeTree(sh.it);
    }
};

const checkShapePropsAnimated = (sh) => {
    if (!sh || typeof sh !== 'object') return false;
    let found = false;
    const p = (tag) => { bumpProps(sh[tag], tag); if (isAnimatedProp(sh[tag])) found = true; };
    // geometry
    ['pt', 'ks', 'r', 'or', 'ir', 'os', 'is', 'p', 's', 'a', 'rr', 'size', 'd'].forEach((t) => p(t === 'p' ? 'p' : t));
    // shape path
    if (isAnimatedProp(sh.ks)) { bump(animProps, 'shapes.ks'); found = true; }
    // fill/stroke
    p('c'); p('o'); p('g'); p('w'); p('ml2');
    if (Array.isArray(sh.d)) { bump(flags, 'dashes'); for (const d of sh.d) p('d.value'); }
    // transform item
    if (sh.ty === 'tr') {
        ['p','a','s','r','o'].forEach((t) => p(t));
        if (isAnimatedProp(sh.sk) || isAnimatedProp(sh.sa)) { bump(animProps, 'skew'); found = true; }
    }
    // trim paths
    if (sh.ty === 'tm') { ['s','e','o'].forEach((t) => p(t)); }
    // repeater
    if (sh.ty === 'rp') { ['c','o','m'].forEach((t) => p(t)); bump(flags, 'repeater'); found = true; }
    // merge paths
    if (sh.ty === 'mm') { bump(flags, 'mergePaths'); }
    // round corners
    if (sh.ty === 'rd') { p('r'); }
    return found;
};

const scanLayer = (l, depth) => {
    if (!isObj(l)) return;
    const ty = Number(l.ty ?? -1);
    bump(layers, 'ty:' + ty);
    const ks = l.ks || {};
    let anyAnim = false;
    const props = [
        ['ks.p', ks.p], ['ks.a', ks.a], ['ks.s', ks.s], ['ks.r', ks.r], ['ks.o', ks.o],
    ];
    for (const [tag, v] of props) { bumpProps(v, tag); if (isAnimatedProp(v)) anyAnim = true; }
    if (ks.sk != null || ks.sa != null) { bump(flags, 'skew'); if (isAnimatedProp(ks.sk) || isAnimatedProp(ks.sa)) anyAnim = true; }
    if (anyAnim) bump(layersAnim, 'ty:' + ty);
    if (l.tm != null) { bump(flags, 'timeRemap'); if (isAnimatedProp(l.tm)) bump(animProps, 'timeRemap'); }
    if (l.ln != null || !isObj(l.ef)) { }
    if (Array.isArray(l.ef) && l.ef.length) bump(flags, 'effects:' + l.ef.length);
    if (l.parent != null) bump(flags, 'parented');
    if (l.nm) { }
    if (ty === 0 && depth <= 1) bump(flags, depth === 0 ? 'topLevelPrecomp' : 'nestedPrecomp');
    // matte
    if (l.td != null) bump(flags, 'matteSource');
    if (l.tt != null) bump(flags, 'matteTarget:' + String(l.tt));
    // masks
    if (Array.isArray(l.masksProperties)) {
        bump(flags, 'masks:' + l.masksProperties.length);
        for (const m of l.masksProperties) { bumpProps(m.pt, 'mask.path'); if (isAnimatedProp(m.pt)) bump(animProps, 'mask.pt'); if (m.o != null && isAnimatedProp(m.o)) bump(animProps, 'mask.o'); }
    }
    if (l.bm) bump(flags, 'layerBlend:' + String(l.bm));
    if (l.ln != null && !isObj(l.ln)) { }
    // precomp/image assets
    if (ty === 0 && l.refId) bump(flags, 'precompRefs');
    if (ty === 2) { bump(flags, 'imageLayer'); }
    if (ty === 1) bump(flags, 'solidLayer');
    if (ty === 5) { bump(flags, 'textLayer'); for (const tk of (l.t?.d || [])) { } }
    if (l.ao) bump(flags, 'autoOrient');
    if (l.ip != null && l.op != null) { bump(flags, 'sideWindow'); }
    if (l.sr) bump(flags, 'timeStretch');
    if (l.w || l.h) { }
    scanShapeTree(l.shapes);
    if (Array.isArray(l.ef)) { for (const e of l.ef) if (e.ty) bump(flags, 'effectType:' + e.ty); }
};

const totals = { files: 0, bytes: 0, parseErrors: 0, jsonBytes: 0 };
const widthBuckets = new Map();
const fpsBuckets = new Map();

let i = 0;
const started = Date.now();
const fileList = [...files].sort();
for (const f of fileList) {
    i++;
    if (progressEvery > 0 && i % progressEvery === 0) {
        const secs = (Date.now() - started) / 1000;
        console.error(`[inventory] ${i}/${fileList.length} files (${secs.toFixed(1)}s)`);
    }
    let buf;
    try { buf = readFileSync(f); } catch { continue; }
    totals.files++;
    totals.bytes += buf.length;
    let raw;
    try { raw = gunzipSync(buf); } catch { totals.parseErrors++; continue; }
    totals.jsonBytes += raw.length;
    let json;
    try { json = JSON.parse(raw.toString('utf8')); } catch { totals.parseErrors++; continue; }
    bump(widthBuckets, json.w + 'x' + json.h);
    bump(fpsBuckets, String(json.fr) + 'frps');
    if (Array.isArray(json.layers)) for (const l of json.layers) scanLayer(l, 0);
    if (Array.isArray(json.assets)) for (const a of json.assets) {
        bump(flags, 'assets');
        if (a.u && a.p) bump(flags, 'assetImage');
        if (Array.isArray(a.layers)) for (const l of a.layers) scanLayer(l, 1);
    }
}

const fmt = (m) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
const report = {
    totals,
    layerTypes: fmt(layers),
    layerTypesAnimated: fmt(layersAnim),
    shapeTypes: fmt(shapes),
    shapeTypesAnimated: fmt(shapesAnim),
    flags: fmt(flags),
    animProps: fmt(animProps),
    propStyle: fmt(animPropStyle),
    grad: fmt(grad),
    dims: fmt(widthBuckets),
    fps: fmt(fpsBuckets),
};
console.log(JSON.stringify(report, (k, v) => (v === undefined ? undefined : v), 2));
if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2));
