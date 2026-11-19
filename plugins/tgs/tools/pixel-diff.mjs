// Pixel cross-check: renders corpus files through tlottie (vendored wasm) and
// our TgsRender at matching dimensions and frames, then reports per-file and
// aggregated alpha-channel agreement (premultiplied buffers).
//
// Usage:
//   node tools/pixel-diff.mjs <corpus-dir-or-file>... [--size 64] [--frames 6] [--limit 200] [--json out] [--worst 10]
import { createRequire } from 'node:module';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');
const tlBytes = readFileSync(join(PLUGIN_ROOT, 'tools', 'vendor', 'tlottie.wasm'));
const tlEx = new WebAssembly.Instance(new WebAssembly.Module(tlBytes), { env: { emscripten_memcpy_big: () => { } } }).exports;
const glue = require('../src/rust/wasm/tgs_wasm.js');

const argv = process.argv.slice(2);
const flags = { size: 64, frames: 6, limit: 200, json: '', worst: 10 };
const roots = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--size') flags.size = Number(argv[++i]);
    else if (argv[i] === '--frames') flags.frames = Number(argv[++i]);
    else if (argv[i] === '--limit') flags.limit = Number(argv[++i]);
    else if (argv[i] === '--json') flags.json = argv[++i];
    else if (argv[i] === '--worst') flags.worst = Number(argv[++i]);
    else roots.push(argv[i]);
}

const listFiles = (root, out) => {
    const st = statSync(root);
    if (st.isDirectory()) {
        for (const e of readdirSync(root)) listFiles(join(root, e), out);
    } else if (root.endsWith('.tgs') && st.size > 0) {
        out.push(root);
    }
};

const files = [];
for (const r of roots) listFiles(resolve(r), files);
files.sort();
const limited = files.slice(0, flags.limit);

{ // warm both runtimes once to avoid first-call noise
    const p = tlEx.tlottie_alloc(1);
    tlEx.tlottie_free(p, 1);
    const warm = new glue.TgsRender('{"v":"5.0","fr":30,"ip":0,"op":1,"w":2,"h":2,"layers":[]}', 2, 2);
    warm.frame_bytes(0, 2, 2);
    warm.free?.();
}

// Compare premultiplied alpha channels: returns {bad, mae} where bad counts
// pixels whose alpha differs by more than 16/255 and mae is mean abs error.
const compare = (a, b) => {
    const n = Math.min(a.length, b.length);
    let bad = 0, mae = 0;
    for (let i = 3; i < n; i += 4) {
        const d = Math.abs(a[i] - b[i]);
        mae += d;
        if (d > 16) bad++;
    }
    const px = n / 4 || 1;
    return { badPct: (bad / px) * 100, mae: mae / px };
};

const rows = [];
for (let fi = 0; fi < limited.length; fi++) {
    const file = limited[fi];
    process.stderr.write(`[pixel-diff] progress ${fi + 1}/${limited.length} ${file}\n`);
    let json;
    try {
        json = gunzipSync(readFileSync(file)).toString('utf8');
    } catch {
        continue;
    }
    try {
        const jbuf = Buffer.from(json, 'utf8');
        const ptr = tlEx.tlottie_alloc(jbuf.length);
        new Uint8Array(tlEx.memory.buffer, ptr, jbuf.length).set(jbuf);
        const inst = tlEx.tlottie_new_with_options(ptr, jbuf.length, 0, 0, 0);
        tlEx.tlottie_free(ptr, jbuf.length);
        if (!inst) continue;
        const cw = tlEx.tlottie_width(inst), ch = tlEx.tlottie_height(inst);
        const long = Math.max(cw, ch) || 1;
        const rw = cw >= ch ? flags.size : Math.max(1, Math.round(cw * flags.size / long));
        const rh = ch > cw ? flags.size : Math.max(1, Math.round(ch * flags.size / long));

        const ours = new glue.TgsRender(json, rw, rh);
        const frames = Math.min(flags.frames, Math.max(1, ours.out_frame() - ours.in_frame()));
        let worstBad = -1, worstMae = 0, compareFrames = 0, sumBad = 0, sumMae = 0;
        for (let f = 0; f < frames; f++) {
            const local = f; // tlottie uses local 0..op-ip-1
            const px = tlEx.tlottie_render_with_options(inst, local, rw, rh, 1, 0.3);
            const tb = px ? new Uint8Array(tlEx.memory.buffer, px, rw * rh * 4) : null;
            const ob = ours.frame_bytes(ours.in_frame() + f, rw, rh);
            if (!tb || !ob) continue;
            const c = compare(ob, tb);
            compareFrames++;
            sumBad += c.badPct;
            sumMae += c.mae;
            if (c.badPct > worstBad) { worstBad = c.badPct; worstMae = c.mae; }
        }
        ours.free?.();
        tlEx.tlottie_drop(inst);
        if (compareFrames > 0) {
            rows.push({ file: file.split('/').slice(-2).join('/'), avgBad: sumBad / compareFrames, worstBad, worstMae, frames: compareFrames });
        }
    } catch { /* skip broken */ }
}

rows.sort((a, b) => b.avgBad - a.avgBad);
const total = rows.length;
const meanBad = total ? rows.reduce((s, r) => s + r.avgBad, 0) / total : 0;
const good = rows.filter((r) => r.avgBad <= 0.5).length;
const medianBad = total ? rows[Math.floor(total / 2)].avgBad : 0;
console.log(`[pixel-diff] files=${total}/${limited.length} | size=${flags.size}px | frames<=${flags.frames}`);
console.log(`[pixel-diff] alpha diff: mean ${meanBad.toFixed(2)}% | median ${medianBad.toFixed(2)}% | good (<=0.5%) ${good}/${total}`);
console.log(`[pixel-diff] worst ${Math.min(flags.worst, rows.length)}:`);
for (const r of rows.slice(0, flags.worst)) {
    console.log(`  ${(r.avgBad).toFixed(2)}% worst ${(r.worstBad).toFixed(2)}% mae ${r.worstMae.toFixed(2)} ${r.file}`);
}
if (flags.json) {
    (await import('node:fs')).writeFileSync(flags.json, JSON.stringify({ size: flags.size, frames: flags.frames, rows }, null, 1));
    console.log(`[pixel-diff] json written: ${flags.json}`);
}
