// One-off debug: render a .tgs through both tlottie (vendored) and our TgsRender,
// compare opaque-pixel counts per frame.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');
const tlBytes = readFileSync(join(PLUGIN_ROOT, 'tools', 'vendor', 'tlottie.wasm'));
const tlEx = new WebAssembly.Instance(new WebAssembly.Module(tlBytes), { env: { emscripten_memcpy_big: () => { } } }).exports;
const glue = require('../src/rust/wasm/tgs_wasm.js');

const warm = new TextEncoder ? new Uint8Array(1) : null;
{
    const p = tlEx.tlottie_alloc(1);
    tlEx.tlottie_free(p, 1);
}

const file = process.argv[2];
const size = Number(process.argv[3] || 512);
const frames = Number(process.argv[4] || 4);
const json = gunzipSync(readFileSync(file)).toString('utf8');

const countO = (bytes) => {
    let n = 0, sumA = 0;
    for (let i = 3; i < bytes.length; i += 4) { if (bytes[i] > 8) n++; sumA += bytes[i]; }
    return { n, sumA };
};

// tlottie
const jbuf = Buffer.from(json, 'utf8');
const ptr = tlEx.tlottie_alloc(jbuf.length);
new Uint8Array(tlEx.memory.buffer, ptr, jbuf.length).set(jbuf);
const inst = tlEx.tlottie_new_with_options(ptr, jbuf.length, 0, 0, 0);
tlEx.tlottie_free(ptr, jbuf.length);
if (!inst) { console.log('tlottie load failed'); process.exit(1); }
const cw = tlEx.tlottie_width(inst), ch = tlEx.tlottie_height(inst);
const long = Math.max(cw, ch) || 1;
const rw = cw >= ch ? size : Math.max(1, Math.round(cw * size / long));
const rh = ch > cw ? size : Math.max(1, Math.round(ch * size / long));
console.log(`dims ${cw}x${ch} render ${rw}x${rh}`);
for (let f = 0; f < frames; f++) {
    const px = tlEx.tlottie_render_with_options(inst, f, rw, rh, 1, 0.3);
    const c = px ? countO(new Uint8Array(tlEx.memory.buffer, px, rw * rh * 4)) : null;
    console.log(`frame ${f}: tlottie ${c ? `n=${c.n} sumA=${c.sumA}` : 'null'}`);
}
tlEx.tlottie_drop(inst);

// ours
const r = new glue.TgsRender(json, size, size);
for (let f = 0; f < frames; f++) {
    const bytes = r.frame_bytes(f, size, size);
    const c = countO(bytes);
    console.log(`frame ${f}: ours    n=${c.n} sumA=${c.sumA}`);
}
