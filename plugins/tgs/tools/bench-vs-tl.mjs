import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..');

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const corpus = args[0] ? (isAbsolute(args[0]) ? args[0] : join(REPO_ROOT, args[0])) : '/home/user/Documents/tgs_data';
const packs = (process.env.TGS_VS_PACKS || 'StaticEmoji,SocialEmojis,SlimeFontEmoji,WallyOwl,CupidKitty,TenYearsOfTelegram,MatrixFont,EmojiStatus').split(',').map((s) => s.trim()).filter(Boolean);
const perPack = Math.max(1, Number(process.env.TGS_VS_PER_PACK || 6));
const framesN = Math.max(1, Number(process.env.TGS_VS_FRAMES || 30));
const reps = Math.max(1, Number(process.env.TGS_VS_REPS || 1));
const sizePx = Math.max(8, Number(process.env.TGS_VS_SIZE || 64));

const tlBytes = readFileSync(join(PLUGIN_ROOT, 'tools', 'vendor', 'tlottie.wasm'));
const tlEx = new WebAssembly.Instance(new WebAssembly.Module(tlBytes), { env: { emscripten_memcpy_big: () => { } } }).exports;

const glue = await import(pathToFileURL(join(PLUGIN_ROOT, 'src', 'rust', 'wasm', 'tgs_wasm.js')).href);
const wasmPath = process.env.TGS_VS_WASM || join(PLUGIN_ROOT, 'src', 'rust', 'wasm', 'tgs_wasm_bg.wasm');
await glue.default(pathToFileURL(wasmPath).href);

{
    const p = tlEx.tlottie_alloc(1);
    tlEx.tlottie_free(p, 1);
}

const byPack = new Map();
for (const p of packs) byPack.set(p, []);
const scan = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { scan(p); continue; }
        if (!e.name.endsWith('.tgs')) continue;
        const st = statSync(p);
        if (st.size === 0) continue;
        const parts = p.split(/[\\/]/);
        const pk = parts.length >= 2 ? parts[parts.length - 2] : '(root)';
        const bucket = byPack.get(pk);
        if (bucket && bucket.length < perPack) bucket.push(p);
    }
};
scan(corpus);

const toText = (data) => (data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data).toString('utf8') : data.toString('utf8'));

const tlRender = (json, frames) => {
    const jbuf = Buffer.from(json, 'utf8');
    const ptr = tlEx.tlottie_alloc(jbuf.length);
    new Uint8Array(tlEx.memory.buffer, ptr, jbuf.length).set(jbuf);
    const inst = tlEx.tlottie_new_with_options(ptr, jbuf.length, 0, 0, 0);
    tlEx.tlottie_free(ptr, jbuf.length);
    if (!inst) return -1;
    const cw = tlEx.tlottie_width(inst);
    const ch = tlEx.tlottie_height(inst);
    const long = Math.max(cw, ch) || 1;
    const rw = cw >= ch ? sizePx : Math.max(1, Math.round(cw * sizePx / long));
    const rh = ch > cw ? sizePx : Math.max(1, Math.round(ch * sizePx / long));
    tlEx.tlottie_render_with_options(inst, 0, rw, rh, 1, 0.3);
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) tlEx.tlottie_render_with_options(inst, f, rw, rh, 1, 0.3);
    const ms = performance.now() - t0;
    tlEx.tlottie_drop(inst);
    return ms;
};

const oursRender = (json, frames) => {
    const r = new glue.TgsRender(json, sizePx, sizePx);
    const ip = r.in_frame();
    const fc = Math.max(1, r.frame_count());
    r.render(ip, sizePx, sizePx);
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) r.render(ip + (f % fc), sizePx, sizePx);
    const ms = performance.now() - t0;
    r.free();
    return ms;
};

console.log('[tgs-vs] corpus=' + corpus + ' | packs=' + packs.length + ' | per_pack=' + perPack + ' | frames=' + framesN + ' @ ' + sizePx + 'px');

let totOurs = 0, totTl = 0, totFrames = 0, order = 0;
for (const [pack, files] of byPack) {
    let ours = 0, tl = 0, nf = 0, errs = 0;
    for (const file of files) {
        try {
            const json = toText(readFileSync(file));
            const fc = framesN;
            let tO = Infinity, tT = Infinity, bad = false;
            for (let r = 0; r < reps; r++) {
                const a = (order + r) % 2 === 0;
                if (a) {
                    const t = oursRender(json, fc);
                    if (t < tO) tO = t;
                }
                const t = tlRender(json, fc);
                if (t < 0) { bad = true; break; }
                if (t < tT) tT = t;
                if (!a) {
                    const t = oursRender(json, fc);
                    if (t < tO) tO = t;
                }
            }
            order++;
            if (bad) { errs++; continue; }
            ours += tO;
            tl += tT;
            nf += fc;
        } catch {
            errs++;
        }
    }
    const ratio = tl > 0 ? ours / tl : 0;
    totOurs += ours;
    totTl += tl;
    totFrames += nf;
    console.log('[tgs-vs] ' + pack.padEnd(22) + ' files=' + files.length + ' frames=' + nf + ' errs=' + errs
        + ' ours=' + ours.toFixed(1) + 'ms tl=' + tl.toFixed(1) + 'ms ratio=' + ratio.toFixed(2));
}
const totalRatio = totTl > 0 ? totOurs / totTl : 0;
console.log('[tgs-vs] TOTAL frames=' + totFrames + ' ours=' + totOurs.toFixed(1) + 'ms tl=' + totTl.toFixed(1) + 'ms ratio=' + totalRatio.toFixed(2));
