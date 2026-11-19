// Render a .tgs file frame through both tlottie and our TgsRender at full size,
// dump each plus an abs-diff visualization as PNG files (no deps).
//
// Usage:
//   node tools/png-dump.mjs <file.tgs> [frame=0] [size=512] [outdir=/tmp/opencode/pngcheck]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync, deflateSync } from 'node:zlib';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');
const tlBytes = readFileSync(join(PLUGIN_ROOT, 'tools', 'vendor', 'tlottie.wasm'));
const tlEx = new WebAssembly.Instance(new WebAssembly.Module(tlBytes), { env: { emscripten_memcpy_big: () => { } } }).exports;
const glue = require('../src/rust/wasm/tgs_wasm.js');

const file = process.argv[2];
const frame = Number(process.argv[3] || 0);
const size = Number(process.argv[4] || 512);
const outdir = process.argv[5] || '/tmp/opencode/pngcheck';
if (!file) { console.log('usage: png-dump.mjs <file.tgs> [frame] [size] [outdir]'); process.exit(1); }

// ---------------- PNG writer (RGBA, no deps) ----------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
};
const pngWrite = (rgba, w, h, path) => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 4 + 1)] = 0; // filter none
        Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
    }
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 6 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
    writeFileSync(path, png);
};

// premultiplied RGBA -> plain RGBA (PNG color type 6 stores unassociated alpha)
const premulToPlain = (src) => {
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        out[i + 3] = a;
        if (a === 0 || a === 255) {
            out[i] = a === 0 ? 0 : src[i];
            out[i + 1] = a === 0 ? 0 : src[i + 1];
            out[i + 2] = a === 0 ? 0 : src[i + 2];
        } else {
            const f = 255 / a;
            out[i] = Math.min(255, Math.round(src[i] * f));
            out[i + 1] = Math.min(255, Math.round(src[i + 1] * f));
            out[i + 2] = Math.min(255, Math.round(src[i + 2] * f));
        }
    }
    return out;
};

const isTgs = file.endsWith('.tgs');
const json = isTgs ? gunzipSync(readFileSync(file)).toString('utf8') : readFileSync(file, 'utf8');
mkdirSync(outdir, { recursive: true });
const stem = basename(file).replace(/\.(tgs|json)$/, '');

// dims
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

const px = tlEx.tlottie_render_with_options(inst, frame, rw, rh, 1, 0.3);
const tl = px ? new Uint8Array(tlEx.memory.buffer, px, rw * rh * 4) : null;
pngWrite(premulToPlain(tl || new Uint8Array(rw * rh * 4)), rw, rh, join(outdir, `${stem}-f${frame}-tl.png`));
tlEx.tlottie_drop(inst);

const ours = new glue.TgsRender(json, rw, rh);
const ob = ours.frame_bytes(ours.in_frame() + frame, rw, rh);
pngWrite(premulToPlain(ob || new Uint8Array(rw * rh * 4)), rw, rh, join(outdir, `${stem}-f${frame}-ours.png`));
ours.free?.();

// diff visualization (grayscale over RGBA byte diff) + alpha-only diff
const diff = new Uint8Array(rw * rh * 4);
let maxD = 0, sumD = 0, bad = 0;
for (let i = 0; i < rw * rh * 4; i++) {
    const d = tl && ob ? Math.abs(tl[i] - ob[i]) : 255;
    diff[i] = d;
    sumD += d;
    if (d > 32) bad++;
    if (d > maxD) maxD = d;
}
pngWrite(diff, rw, rh, join(outdir, `${stem}-f${frame}-diff.png`));
const stats = { max: maxD, mean: +(sumD / (rw * rh * 4)).toFixed(2), badBytesPct: +((bad / (rw * rh * 4)) * 100).toFixed(3) };
writeFileSync(join(outdir, `${stem}-f${frame}-stats.json`), JSON.stringify(stats));
console.log(`[png-dump] ${stem} frame=${frame} ${rw}x${rh} diff: max=${stats.max} mean=${stats.mean} badBytes=${stats.badBytesPct}%`);
console.log(`[png-dump] out: ${outdir}/${stem}-f${frame}-{ours,tl,diff}.png`);
