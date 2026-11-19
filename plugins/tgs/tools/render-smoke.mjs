// Smoke test for the native TGS renderer (TgsRender in the prod wasm build).
// Renders a few frames of corpus files at small size and sanity-checks pixels.
//
// Usage:
//   node tools/render-smoke.mjs <corpus-dir-or-file>... [--size 64] [--frames 8] [--limit 5]
// Exits non-zero when a file renders to an empty buffer or fails.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const tgsWasm = require('../src/rust/wasm/tgs_wasm.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');

const argv = process.argv.slice(2);
const flags = { size: 64, frames: 8, limit: 5, list: '' };
const paths = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--size') flags.size = Number(argv[++i]);
    else if (argv[i] === '--frames') flags.frames = Number(argv[++i]);
    else if (argv[i] === '--limit') flags.limit = Number(argv[++i]);
    else if (argv[i] === '--list') flags.list = argv[++i];
    else paths.push(argv[i]);
}

const files = new Set();
const scanDir = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (e.isDirectory()) { scanDir(join(dir, e.name)); continue; }
        if (e.name.endsWith('.tgs')) {
            const p = join(dir, e.name);
            try { if (statSync(p).isFile() && statSync(p).size > 0) files.add(p); } catch { }
        }
    }
};
if (flags.list) {
    // Text file: one path per line.
    try {
        for (const line of readFileSync(flags.list, 'utf8').split('\n')) {
            const p = line.trim();
            if (!p) continue;
            try { if (statSync(p).size > 0) files.add(p); } catch { }
        }
    } catch { }
} else if (paths.length > 0) {
    for (const p of paths) {
        const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
        let st;
        try { st = statSync(abs); } catch { continue; }
        if (st.isDirectory()) scanDir(abs);
        else if (abs.endsWith('.tgs') && st.size > 0) files.add(abs);
    }
} else {
    scanDir(join(REPO_ROOT, 'tmp'));
}
if (files.size === 0) {
    console.error('[render-smoke] no .tgs inputs; pass a corpus dir/file, e.g. node tools/render-smoke.mjs ~/Documents/tgs_data');
    process.exit(1);
}

const toText = (data) => {
    if (data[0] === 0x1f && data[1] === 0x8b) return gunzipSync(data).toString('utf8');
    return data.toString('utf8');
};

let ok = 0, fail = 0;
let checked = 0;
for (const file of [...files]) {
    if (checked >= flags.limit) break;
    checked++;
    let json;
    try {
        json = toText(readFileSync(file));
    } catch (e) {
        console.log(`FAIL read       ${file}: ${e.message}`);
        fail++;
        continue;
    }
    const w = flags.size, h = flags.size;
    const t0 = performance.now();
    let r;
    try {
        r = new tgsWasm.TgsRender(json, w, h);
    } catch (e) {
        console.log(`FAIL construct  ${file}: ${e?.message ?? e}`);
        fail++;
        continue;
    }
    const loadMs = (performance.now() - t0).toFixed(1);

    let anyOpaque = 0;
    const ip = r.in_frame();
    try {
        for (let f = 0; f < flags.frames; f++) {
            const bytes = r.frame_bytes(ip + f, w, h);
            if (bytes.length !== w * h * 4) throw new Error(`bad buffer len ${bytes.length}`);
            let opaque = 0;
            for (let i = 3; i < bytes.length; i += 4) if (bytes[i] > 8) opaque++;
            if (opaque > 0) anyOpaque++;
        }
    } catch (e) {
        console.log(`FAIL render     ${file}: ${e?.message ?? e}`);
        fail++;
        continue;
    }
    ok++;
    const stats = `${anyOpaque}/${flags.frames} frames non-empty`;
    if (anyOpaque === 0) {
        console.log(`EMPTY  load=${loadMs}ms  ${file} (${stats})`);
    } else {
        console.log(`OK     load=${loadMs}ms  ${file} (${stats})`);
    }
}
console.log('[render-smoke] checked=%d ok=%d fail=%d', checked, ok, fail);
process.exit(fail > 0 ? 1 : 0);
