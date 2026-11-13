let wasm = null;
let memory = null;
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

function writeBytes(b) {
    if (!(b instanceof Uint8Array) && !ArrayBuffer.isView(b)) fail('crypton: expected bytes argument');
    const src = b instanceof Uint8Array ? b : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    const a = unpack(wasm.crypton_alloc(src.length));
    if (!a) fail('crypton alloc failed');
    new Uint8Array(memory.buffer, a.ptr, src.length).set(src);
    return { ptr: a.ptr, len: src.length };
}

function writeString(s) {
    const bytes = encoder.encode(String(s));
    const a = unpack(wasm.crypton_alloc(bytes.length));
    if (!a) fail('crypton alloc failed');
    new Uint8Array(memory.buffer, a.ptr, bytes.length).set(bytes);
    return { ptr: a.ptr, len: bytes.length };
}

function freeArg(a) {
    if (a && a.ptr) {
        try { wasm.crypton_free(a.ptr, a.len); } catch { }
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
        const e = unpack(wasm.crypton_err());
        if (e) {
            const m = readString(e.ptr, e.len);
            freeArg(e);
            fail(m);
        }
        fail('crypton call failed');
    }
    return out;
}

function resultBytes(v) {
    const out = readResp(v);
    try { return copyBytes(out.ptr, out.len); } finally { freeArg(out); }
}

function resultString(v) {
    const out = readResp(v);
    try { return readString(out.ptr, out.len); } finally { freeArg(out); }
}

function checkBigint(v) {
    const b = typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)));
    if (b < 0n || b > 0xffffffffffffffffn) fail('crypton: byte_offset out of u64 range');
    return b;
}

function setExports(ex) {
    wasm = ex;
    memory = ex.memory;
    decoder = new TextDecoder('utf-8');
    encoder = new TextEncoder();
}

function isNode() {
    const p = globalThis['process'];
    return typeof p === 'object' && p !== null && !!p.versions && !!p.versions.node;
}

function ensureReady() {
    if (wasm) return;
    if (!isNode()) fail('crypton wasm not initialized (await init() first)');
    const p = globalThis['process'];
    const fs = p.getBuiltinModule('node:fs');
    const urlm = p.getBuiltinModule('node:url');
    const file = urlm.fileURLToPath(new URL('crypton_wasm_bg.wasm', import.meta.url));
    const bytes = new Uint8Array(fs.readFileSync(file));
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports());
    setExports(inst.exports);
}

function randFill(ptr, len) {
    const view = new Uint8Array(memory.buffer, ptr, len);
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues
        ? crypto
        : isNode() ? globalThis['process'].getBuiltinModule('node:crypto').webcrypto : null;
    if (!c) fail('crypton: no crypto.getRandomValues available');
    for (let off = 0; off < len; off += 65536) {
        c.getRandomValues(view.subarray(off, Math.min(len, off + 65536)));
    }
}

function imports() {
    return { env: { get_random_values: (ptr, len) => randFill(ptr, len) } };
}

async function fetchOrFs(urlOrPath) {
    if (!isNode() && typeof fetch === 'function') {
        const res = await fetch(urlOrPath, { credentials: 'same-origin' });
        if (!res.ok) fail('crypton wasm fetch failed: ' + res.status);
        return new Uint8Array(await res.arrayBuffer());
    }
    if (isNode()) {
        const fs = await import(/* webpackIgnore: true */ 'node:fs');
        const path = await import(/* webpackIgnore: true */ 'node:url');
        const p = urlOrPath.startsWith('file:') ? path.fileURLToPath(urlOrPath) : urlOrPath;
        return new Uint8Array(fs.readFileSync(p));
    }
    fail('crypton wasm: no fetch available');
}

async function loadBytes(arg) {
    if (arg && arg.module_or_path !== undefined) return loadBytes(arg.module_or_path);
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
        bytes = await fetchOrFs(path.fileURLToPath(new URL('crypton_wasm_bg.wasm', import.meta.url)));
    } else {
        const url = new URL('crypton_wasm_bg.wasm', import.meta.url);
        bytes = await fetchOrFs(url.href);
    }
    const { instance } = await WebAssembly.instantiate(bytes, imports());
    return instance.exports;
}

const sha1Fns = {
    sha1_hash(data) {
        ensureReady();
        const d = writeBytes(data);
        try { return resultBytes(wasm.crypton_sha1(d.ptr, d.len)); } finally { freeArg(d); }
    },
    sha256_hash(data) {
        ensureReady();
        const d = writeBytes(data);
        try { return resultBytes(wasm.crypton_sha256(d.ptr, d.len)); } finally { freeArg(d); }
    },
    sha512_hash(data) {
        ensureReady();
        const d = writeBytes(data);
        try { return resultBytes(wasm.crypton_sha512(d.ptr, d.len)); } finally { freeArg(d); }
    }
};

export const sha1_hash = (data) => sha1Fns.sha1_hash(data);
export const sha256_hash = (data) => sha1Fns.sha256_hash(data);
export const sha512_hash = (data) => sha1Fns.sha512_hash(data);

export function hmac_sha256(key, data) {
    ensureReady();
    const k = writeBytes(key);
    const d = writeBytes(data);
    try { return resultBytes(wasm.crypton_hmac_sha256(k.ptr, k.len, d.ptr, d.len)); } finally { freeArg(k); freeArg(d); }
}

export function hmac_sha512(key, data) {
    ensureReady();
    const k = writeBytes(key);
    const d = writeBytes(data);
    try { return resultBytes(wasm.crypton_hmac_sha512(k.ptr, k.len, d.ptr, d.len)); } finally { freeArg(k); freeArg(d); }
}

export function hkdf_sha512_extract(salt, ikm) {
    ensureReady();
    const s = writeBytes(salt);
    const i = writeBytes(ikm);
    try { return resultBytes(wasm.crypton_hkdf_sha512_extract(s.ptr, s.len, i.ptr, i.len)); } finally { freeArg(s); freeArg(i); }
}

export function hkdf_sha512_expand(prk, info, len) {
    ensureReady();
    const p = writeBytes(prk);
    const i = writeBytes(info);
    try { return resultBytes(wasm.crypton_hkdf_sha512_expand(p.ptr, p.len, i.ptr, i.len, len >>> 0)); } finally { freeArg(p); freeArg(i); }
}

export function pbkdf2_sha256(password, salt, iterations, dk_len) {
    ensureReady();
    const p = writeBytes(password);
    const s = writeBytes(salt);
    try { return resultBytes(wasm.crypton_pbkdf2_sha256(p.ptr, p.len, s.ptr, s.len, iterations >>> 0, dk_len >>> 0)); } finally { freeArg(p); freeArg(s); }
}

export function get_random_bytes(len) {
    ensureReady();
    return resultBytes(wasm.crypton_get_random_bytes(len >>> 0));
}

export function mod_pow(base_hex, exp_hex, mod_hex) {
    ensureReady();
    const b = writeString(base_hex.replace(/^0x/, ''));
    const e = writeString(exp_hex.replace(/^0x/, ''));
    const m = writeString(mod_hex.replace(/^0x/, ''));
    try { return resultString(wasm.crypton_mod_pow(b.ptr, b.len, e.ptr, e.len, m.ptr, m.len)); } finally { freeArg(b); freeArg(e); freeArg(m); }
}

export function is_probably_prime(n_hex, rounds) {
    ensureReady();
    const n = writeString(n_hex.replace(/^0x/, ''));
    try {
        const r = wasm.crypton_is_probably_prime(n.ptr, n.len, rounds >>> 0);
        if (r === 2) {
            const e = unpack(wasm.crypton_err());
            if (e) {
                const m = readString(e.ptr, e.len);
                freeArg(e);
                fail(m);
            }
            fail('crypton primality check failed');
        }
        return r === 1;
    } finally { freeArg(n); }
}

function aesCall(name, key, data) {
    ensureReady();
    const k = writeBytes(key);
    const d = writeBytes(data);
    try { return resultBytes(wasm[name](k.ptr, k.len, d.ptr, d.len)); } finally { freeArg(k); freeArg(d); }
}

function aesCbc(name, key, iv, data) {
    ensureReady();
    const k = writeBytes(key);
    const i = writeBytes(iv);
    const d = writeBytes(data);
    try { return resultBytes(wasm[name](k.ptr, k.len, i.ptr, i.len, d.ptr, d.len)); } finally { freeArg(k); freeArg(i); freeArg(d); }
}

function aesEtm(name, mac_key, enc_key, iv, data) {
    ensureReady();
    const mk = writeBytes(mac_key);
    const ek = writeBytes(enc_key);
    const i = writeBytes(iv);
    const d = writeBytes(data);
    try { return resultBytes(wasm[name](mk.ptr, mk.len, ek.ptr, ek.len, i.ptr, i.len, d.ptr, d.len)); } finally { freeArg(mk); freeArg(ek); freeArg(i); freeArg(d); }
}

function aesIge(name, data, key, iv) {
    ensureReady();
    const d = writeBytes(data);
    const k = writeBytes(key);
    const i = writeBytes(iv);
    try { return resultBytes(wasm[name](d.ptr, d.len, k.ptr, k.len, i.ptr, i.len)); } finally { freeArg(d); freeArg(k); freeArg(i); }
}

function aesSeal(name, mac_key, enc_key, data) {
    ensureReady();
    const m = writeBytes(mac_key);
    const e = writeBytes(enc_key);
    const d = writeBytes(data);
    try { return resultBytes(wasm[name](m.ptr, m.len, e.ptr, e.len, d.ptr, d.len)); } finally { freeArg(m); freeArg(e); freeArg(d); }
}

function aesCtr(name, data, key, iv, byte_offset) {
    ensureReady();
    const d = writeBytes(data);
    const k = writeBytes(key);
    const i = writeBytes(iv);
    try { return resultBytes(wasm[name](d.ptr, d.len, k.ptr, k.len, i.ptr, i.len, checkBigint(byte_offset))); } finally { freeArg(d); freeArg(k); freeArg(i); }
}

export const aes256_ecb_encrypt = (key, data) => aesCall('crypton_aes256_ecb_encrypt', key, data);
export const aes256_ecb_decrypt = (key, data) => aesCall('crypton_aes256_ecb_decrypt', key, data);
export const aes256_cbc_encrypt = (key, iv, data) => aesCbc('crypton_aes256_cbc_encrypt', key, iv, data);
export const aes256_cbc_decrypt = (key, iv, data) => aesCbc('crypton_aes256_cbc_decrypt', key, iv, data);
export const aes256_cbc_encrypt_etm = (mk, ek, iv, pt) => aesEtm('crypton_aes256_cbc_encrypt_etm', mk, ek, iv, pt);
export const aes256_cbc_decrypt_etm = (mk, ek, iv, d) => aesEtm('crypton_aes256_cbc_decrypt_etm', mk, ek, iv, d);
export const aes256_cbc_seal = (mk, ek, pt) => aesSeal('crypton_aes256_cbc_seal', mk, ek, pt);
export const aes256_cbc_open = (mk, ek, sealed) => aesSeal('crypton_aes256_cbc_open', mk, ek, sealed);
export const aes256_ige_encrypt = (data, key, iv) => aesIge('crypton_aes256_ige_encrypt', data, key, iv);
export const aes256_ige_decrypt = (data, key, iv) => aesIge('crypton_aes256_ige_decrypt', data, key, iv);
export const aes256_ctr_process = (data, key, iv, byte_offset) => aesCtr('crypton_aes256_ctr_process', data, key, iv, byte_offset);

export async function init(arg) {
    setExports(await loadBytes(arg));
    return true;
}

export const __wbg_init = init;

export default init;
