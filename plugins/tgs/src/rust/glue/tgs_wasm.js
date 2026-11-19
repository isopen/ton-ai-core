let wasm = null;
let memory = null;
let decode = null;
let encoder = null;
let decoder = null;

function fail(msg) {
    throw new Error(msg);
}

function copyBytes(ptr, len) {
    if (!len) return new Uint8Array(0);
    return new Uint8Array(memory.buffer, ptr, len).slice();
}

function readString(ptr, len) {
    if (!len) return '';
    return decoder.decode(new Uint8Array(memory.buffer, ptr, len));
}

const inPool = [];

function writeString(s, slot) {
    const n = s.length;
    const need = n * 3;
    const idx = slot === undefined ? 0 : slot;
    let buf = inPool[idx];
    if (!buf || buf.cap < need) {
        let cap = need < 256 ? 256 : need;
        if (buf) {
            if (buf.cap * 2 > cap) cap = buf.cap * 2;
            inPool[idx] = null;
            try { wasm.tgs_free(buf.ptr, buf.cap); } catch { }
        }
        const r = unpack(wasm.tgs_alloc(cap));
        if (!r) fail('tgs alloc failed');
        buf = { ptr: r.ptr, cap, pool: true };
        inPool[idx] = buf;
    }
    const res = encoder.encodeInto(s, new Uint8Array(memory.buffer, buf.ptr, buf.cap));
    if (res.read !== n) fail('tgs utf8 encode failed');
    return { ptr: buf.ptr, len: res.written, cap: buf.cap, pool: true };
}

function freeString(s) {
    if (s && s.ptr && !s.pool) {
        try { wasm.tgs_free(s.ptr, s.cap === undefined ? s.len : s.cap); } catch { }
    }
}

function unpack(v) {
    if (v === 0n || v === null || v === undefined) return null;
    const ptr = Number(v & 0xffffffffn);
    const len = Number((v >> 32n) & 0xffffffffn);
    return { ptr, len };
}

function readResp(v) {
    const out = unpack(v);
    if (!out) {
        const e = unpack(wasm.tgs_err());
        if (e) {
            const m = readString(e.ptr, e.len);
            freeString(e);
            fail(m);
        }
        fail('tgs call failed');
    }
    return out;
}

function setExports(ex) {
    wasm = ex;
    memory = ex.memory;
    decoder = new TextDecoder('utf-8');
    encoder = new TextEncoder();
    inPool.length = 0;
}

function ensureReady() {
    if (wasm) {
        return;
    }
    if (!isNode()) {
        fail('tgs wasm not initialized (await init() first)');
    }
    const p = globalThis['process'];
    const fs = p.getBuiltinModule('node:fs');
    const urlm = p.getBuiltinModule('node:url');
    const file = urlm.fileURLToPath(new URL('tgs_wasm_bg.wasm', import.meta.url));
    const bytes = new Uint8Array(fs.readFileSync(file));
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports());
    setExports(inst.exports);
}

export function parse_tgs_json(json, key, cache) {
    ensureReady();
    const j = writeString(String(json), 0);
    const k = key ? writeString(String(key), 1) : { ptr: 0, len: 0 };
    try {
        const r = wasm.tgs_parse_json(j.ptr, j.len, k.ptr, k.len, cache ? 1 : 0);
        const out = readResp(r);
        try { return readString(out.ptr, out.len); } finally { freeString(out); }
    } finally {
        freeString(j);
        freeString(k);
    }
}

export function parse_tgs_binary(json, key, cache) {
    return parseBinaryCall(json, key, cache, 0);
}

export function parse_tgs_binary_lex(json, key, cache) {
    return parseBinaryCall(json, key, cache, 1);
}

export function parse_tgs_binary_serde(json, key, cache) {
    return parseBinaryCall(json, key, cache, 0);
}

function parseBinaryCall(json, key, cache, lex) {
    ensureReady();
    const j = writeString(String(json), 0);
    const k = key ? writeString(String(key), 1) : { ptr: 0, len: 0 };
    try {
        const r = wasm.tgs_parse_binary(j.ptr, j.len, lex, cache ? 1 : 0);
        const out = readResp(r);
        try { return copyBytes(out.ptr, out.len); } finally { freeString(out); }
    } finally {
        freeString(j);
        freeString(k);
    }
}

export function measure_parse_parts(json) {
    ensureReady();
    const j = writeString(String(json), 0);
    try {
        const r = wasm.tgs_measure(j.ptr, j.len);
        const out = readResp(r);
        try { return readString(out.ptr, out.len); } finally { freeString(out); }
    } finally {
        freeString(j);
    }
}

export class TgsRender {
    constructor(json, w, h) {
        ensureReady();
        const j = writeString(String(json), 0);
        try {
            this._handle = wasm.tgs_render_new(j.ptr, j.len, w >>> 0, h >>> 0);
        } finally {
            freeString(j);
        }
        if (!this._handle) {
            const e = unpack(wasm.tgs_err());
            if (e) {
                const m = readString(e.ptr, e.len);
                freeString(e);
                fail(m);
            }
            fail('tgs render: bad input');
        }
        this._ptr = 0;
        this._len = 0;
    }

    render(frame, w, h) {
        const r = wasm.tgs_render(this._handle, frame, w >>> 0, h >>> 0);
        const out = unpack(r);
        if (!out) {
            const e = unpack(wasm.tgs_err());
            if (e) {
                const m = readString(e.ptr, e.len);
                freeString(e);
                fail(m);
            }
            fail('tgs render failed');
        }
        this._ptr = out.ptr;
        this._len = out.len;
    }

    frame_bytes(frame, w, h) {
        this.render(frame, w, h);
        return copyBytes(this._ptr, this._len);
    }

    data_ptr() {
        return this._ptr;
    }

    data_len() {
        return this._len;
    }

    in_frame() {
        return wasm.tgs_render_in_frame(this._handle);
    }

    out_frame() {
        return wasm.tgs_render_out_frame(this._handle);
    }

    frame_count() {
        return wasm.tgs_render_frame_count(this._handle);
    }

    free() {
        if (this._handle) {
            try { wasm.tgs_render_drop(this._handle); } catch { }
            this._handle = 0;
        }
    }
}

export function getMemory() {
    return memory;
}

export function getExports() {
    return wasm;
}

export function profReset() {
    ensureReady();
    wasm.tgs_prof_reset();
}

export function profStats() {
    ensureReady();
    const out = readResp(wasm.tgs_prof_stats());
    try { return readString(out.ptr, out.len); } finally { freeString(out); }
}

function isNode() {
    const p = globalThis['process'];
    return typeof p === 'object' && p !== null && !!p.versions && !!p.versions.node;
}

async function loadBytes(arg) {
    if (arg && arg.module_or_path !== undefined) {
        return loadBytes(arg.module_or_path);
    }
    if (arg && arg.module instanceof WebAssembly.Module) {
        const inst = await WebAssembly.instantiate(arg.module, imports());
        return inst.instance.exports;
    }
    if (arg instanceof WebAssembly.Module) {
        const inst = await WebAssembly.instantiate(arg, imports());
        return inst.instance.exports;
    }
    let bytes;
    if (arg instanceof ArrayBuffer) {
        bytes = new Uint8Array(arg);
    } else if (ArrayBuffer.isView(arg)) {
        bytes = new Uint8Array(arg.buffer, arg.byteOffset, arg.byteLength);
    } else if (typeof arg === 'string') {
        bytes = await fetchOrFs(arg);
    } else if (isNode()) {
        const path = await import(/* webpackIgnore: true */ 'node:url');
        bytes = await fetchOrFs(path.fileURLToPath(new URL('tgs_wasm_bg.wasm', import.meta.url)));
    } else {
        const url = new URL('tgs_wasm_bg.wasm', import.meta.url);
        bytes = await fetchOrFs(url.href);
    }
    const { instance } = await WebAssembly.instantiate(bytes, imports());
    return instance.exports;
}

async function fetchOrFs(urlOrPath) {
    if (!isNode() && typeof fetch === 'function') {
        const res = await fetch(urlOrPath, { credentials: 'same-origin' });
        if (!res.ok) fail('tgs wasm fetch failed: ' + res.status);
        return new Uint8Array(await res.arrayBuffer());
    }
    if (isNode()) {
        const fs = await import(/* webpackIgnore: true */ 'node:fs');
        const path = await import(/* webpackIgnore: true */ 'node:url');
        const p = urlOrPath.startsWith('file:') ? path.fileURLToPath(urlOrPath) : urlOrPath;
        return new Uint8Array(fs.readFileSync(p));
    }
    fail('tgs wasm: no fetch available');
}

function imports() {
    return { env: { perf_now: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) } };
}

export async function init(arg) {
    setExports(await loadBytes(arg));
    return true;
}

export const __wbg_init = init;

export default init;
