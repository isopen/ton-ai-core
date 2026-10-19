const ERRORS = {
  1: 'invalid AES-256 key length: expected 32 bytes',
  2: 'invalid IV length',
  3: 'input length must be a multiple of 16 bytes',
  4: 'empty hex string',
  5: 'invalid character in hex string',
  6: 'division by zero',
  7: 'modulus must be non-zero',
  8: 'PBKDF2 iteration count must be greater than zero',
  9: 'PBKDF2 iteration count exceeds the allowed maximum',
  10: 'derived output length exceeds 255 * 64 bytes',
  11: 'random length exceeds 1 MiB limit',
  12: 'authentication failed: MAC mismatch',
  13: 'input has no modular inverse for the given modulus',
  14: 'unable to select a blinding factor for the given modulus',
  15: 'mod_pow operand exceeds 8192 bits',
  16: 'secure entropy source is unavailable',
  17: 'Miller-Rabin round count must be greater than zero',
  18: 'internal bignum arithmetic invariant violated',
};

let block = 0;
let memory = null;
let $ = null;

function fail(status) {
  throw new Error(ERRORS[status] ?? `crypton wasm error ${status}`);
}

function readResult(ptr) {
  const dv = new DataView(memory.buffer);
  const st = dv.getUint32(ptr, true);
  const len = dv.getUint32(ptr + 4, true);
  return { st, len };
}

function callBytes(fn, args) {
  const ptr = fn(...args);
  const { st, len } = readResult(ptr);
  if (st !== 0) fail(st);
  return new Uint8Array(memory.buffer.slice(ptr + 12, ptr + 12 + len));
}

function putBytes(bytes) {
  const p = $.crw_alloc(bytes.length);
  if (p === 0) throw new Error('crypton wasm: allocation failed');
  new Uint8Array(memory.buffer, p, bytes.length).set(bytes);
  return [p, bytes.length];
}

function putStr(s) {
  return putBytes(new TextEncoder().encode(s));
}

async function loadBytes(url) {
  if (typeof globalThis !== 'undefined' && globalThis.process?.versions?.node) {
    let fs = null;
    try {
      fs = await new Function('return import("node:fs/promises")')();
    } catch (e) {
      fs = null;
    }
    if (fs) {
      if (url instanceof URL && url.protocol === 'file:') {
        const buf = await fs.readFile(url.pathname);
        return buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf;
      }
      if (typeof url === 'string' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
        const buf = await fs.readFile(url);
        return buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf;
      }
    }
  }
  const res = await fetch(url);
  return res.arrayBuffer();
}

export async function init(input) {
  if ($) return $;
  let source = null;
  if (typeof WebAssembly.Module === 'function' && input instanceof WebAssembly.Module) {
    throw new TypeError('crypton-wasm: precompiled modules are not supported');
  }
  if (input && typeof input === 'object' && 'module_or_path' in input) {
    const v = input.module_or_path;
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
      source = v instanceof ArrayBuffer ? v : v.slice().buffer;
    } else {
      source = await loadBytes(v);
    }
  } else if (typeof input === 'string' || input instanceof URL) {
    source = await loadBytes(input);
  } else {
    source = await loadBytes(new URL('crypton_wasm_bg.wasm', import.meta.url));
  }
  const imports = {
    env: {
      js_get_random_values: (ptr, n) => {
        const dst = new Uint8Array(memory.buffer, ptr, n);
        while (n > 0) {
          const chunk = Math.min(n, 65536);
          crypto.getRandomValues(dst.subarray(0, chunk));
          ptr += chunk;
          n -= chunk;
        }
      },
    },
  };
  const inst = (await WebAssembly.instantiate(source, imports)).instance;
  memory = inst.exports.memory;
  $ = inst.exports;
  block = $.crw_result_ptr();
  return $;
}

export { init as __wbg_init, init as default };

export function get_random_bytes(len) {
  return callBytes($.crw_get_random_bytes, [len >>> 0]);
}

export function sha1_hash(data) {
  const [p, l] = putBytes(new Uint8Array(data));
  const out = callBytes($.crw_sha1_hash, [p, l]);
  $.crw_free(p, l);
  return out;
}

export function sha256_hash(data) {
  const [p, l] = putBytes(new Uint8Array(data));
  const out = callBytes($.crw_sha256_hash, [p, l]);
  $.crw_free(p, l);
  return out;
}

export function sha512_hash(data) {
  const [p, l] = putBytes(new Uint8Array(data));
  const out = callBytes($.crw_sha512_hash, [p, l]);
  $.crw_free(p, l);
  return out;
}

export function hmac_sha256(key, data) {
  const [kp, kl] = putBytes(new Uint8Array(key));
  const [dp, dl] = putBytes(new Uint8Array(data));
  const out = callBytes($.crw_hmac_sha256, [kp, kl, dp, dl]);
  $.crw_free(kp, kl);
  $.crw_free(dp, dl);
  return out;
}

export function hmac_sha512(key, data) {
  const [kp, kl] = putBytes(new Uint8Array(key));
  const [dp, dl] = putBytes(new Uint8Array(data));
  const out = callBytes($.crw_hmac_sha512, [kp, kl, dp, dl]);
  $.crw_free(kp, kl);
  $.crw_free(dp, dl);
  return out;
}

export function hkdf_sha512_extract(salt, ikm) {
  const [sp, sl] = putBytes(new Uint8Array(salt));
  const [ip, il] = putBytes(new Uint8Array(ikm));
  const out = callBytes($.crw_hkdf_sha512_extract, [sp, sl, ip, il]);
  $.crw_free(sp, sl);
  $.crw_free(ip, il);
  return out;
}

export function hkdf_sha512_expand(prk, info, len) {
  const [pp, pl] = putBytes(new Uint8Array(prk));
  const [ip, il] = putBytes(new Uint8Array(info));
  const out = callBytes($.crw_hkdf_sha512_expand, [pp, pl, ip, il, len >>> 0]);
  $.crw_free(pp, pl);
  $.crw_free(ip, il);
  return out;
}

export function pbkdf2_sha256(password, salt, iterations, dk_len) {
  const [pp, pl] = putBytes(new Uint8Array(password));
  const [sp, sl] = putBytes(new Uint8Array(salt));
  const out = callBytes($.crw_pbkdf2_sha256, [pp, pl, sp, sl, iterations >>> 0, dk_len >>> 0]);
  $.crw_free(pp, pl);
  $.crw_free(sp, sl);
  return out;
}

export function mod_pow(base_hex, exp_hex, mod_hex) {
  const [bp, bl] = putStr(base_hex);
  const [ep, el] = putStr(exp_hex);
  const [mp, ml] = putStr(mod_hex);
  const ptr = $.crw_mod_pow(bp, bl, ep, el, mp, ml);
  const { st, len } = readResult(ptr);
  $.crw_free(bp, bl);
  $.crw_free(ep, el);
  $.crw_free(mp, ml);
  if (st !== 0) fail(st);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 12, len));
}

export function is_probably_prime(n_hex, rounds) {
  const [np, nl] = putStr(n_hex);
  const ptr = $.crw_is_probably_prime(np, nl, rounds >>> 0);
  const { st, len } = readResult(ptr);
  $.crw_free(np, nl);
  if (st !== 0) fail(st);
  return len === 1 ? new Uint8Array(memory.buffer, ptr + 12, 1)[0] !== 0 : false;
}

export function aes256_ecb_encrypt(key, data) {
  const [kp, kl] = putBytes(new Uint8Array(key));
  const [dp, dl] = putBytes(new Uint8Array(data));
  const out = callBytes($.crw_aes256_ecb_encrypt, [kp, kl, dp, dl]);
  $.crw_free(kp, kl);
  $.crw_free(dp, dl);
  return out;
}

export function aes256_ecb_decrypt(key, data) {
  const [kp, kl] = putBytes(new Uint8Array(key));
  const [dp, dl] = putBytes(new Uint8Array(data));
  const out = callBytes($.crw_aes256_ecb_decrypt, [kp, kl, dp, dl]);
  $.crw_free(kp, kl);
  $.crw_free(dp, dl);
  return out;
}

export function aes256_cbc_encrypt(key, iv, data) {
  const [kp, kl] = putBytes(new Uint8Array(key));
  const [ip, il] = putBytes(new Uint8Array(iv));
  const [dp, dl] = putBytes(new Uint8Array(data));
  const out = callBytes($.crw_aes256_cbc_encrypt, [kp, kl, ip, il, dp, dl]);
  $.crw_free(kp, kl);
  $.crw_free(ip, il);
  $.crw_free(dp, dl);
  return out;
}

export function aes256_cbc_decrypt(key, iv, data) {
  const [kp, kl] = putBytes(new Uint8Array(key));
  const [ip, il] = putBytes(new Uint8Array(iv));
  const [dp, dl] = putBytes(new Uint8Array(data));
  const out = callBytes($.crw_aes256_cbc_decrypt, [kp, kl, ip, il, dp, dl]);
  $.crw_free(kp, kl);
  $.crw_free(ip, il);
  $.crw_free(dp, dl);
  return out;
}

export function aes256_cbc_encrypt_etm(mac_key, enc_key, iv, plaintext) {
  const [mp, ml] = putBytes(new Uint8Array(mac_key));
  const [kp, kl] = putBytes(new Uint8Array(enc_key));
  const [ip, il] = putBytes(new Uint8Array(iv));
  const [dp, dl] = putBytes(new Uint8Array(plaintext));
  const out = callBytes($.crw_aes256_cbc_encrypt_etm, [mp, ml, kp, kl, ip, il, dp, dl]);
  $.crw_free(mp, ml);
  $.crw_free(kp, kl);
  $.crw_free(ip, il);
  $.crw_free(dp, dl);
  return out;
}

export function aes256_cbc_decrypt_etm(mac_key, enc_key, iv, data) {
  const [mp, ml] = putBytes(new Uint8Array(mac_key));
  const [kp, kl] = putBytes(new Uint8Array(enc_key));
  const [ip, il] = putBytes(new Uint8Array(iv));
  const [dp, dl] = putBytes(new Uint8Array(data));
  const out = callBytes($.crw_aes256_cbc_decrypt_etm, [mp, ml, kp, kl, ip, il, dp, dl]);
  $.crw_free(mp, ml);
  $.crw_free(kp, kl);
  $.crw_free(ip, il);
  $.crw_free(dp, dl);
  return out;
}

export function aes256_cbc_seal(mac_key, enc_key, plaintext) {
  const [mp, ml] = putBytes(new Uint8Array(mac_key));
  const [kp, kl] = putBytes(new Uint8Array(enc_key));
  const [dp, dl] = putBytes(new Uint8Array(plaintext));
  const out = callBytes($.crw_aes256_cbc_seal, [mp, ml, kp, kl, dp, dl]);
  $.crw_free(mp, ml);
  $.crw_free(kp, kl);
  $.crw_free(dp, dl);
  return out;
}

export function aes256_cbc_open(mac_key, enc_key, sealed) {
  const [mp, ml] = putBytes(new Uint8Array(mac_key));
  const [kp, kl] = putBytes(new Uint8Array(enc_key));
  const [dp, dl] = putBytes(new Uint8Array(sealed));
  const out = callBytes($.crw_aes256_cbc_open, [mp, ml, kp, kl, dp, dl]);
  $.crw_free(mp, ml);
  $.crw_free(kp, kl);
  $.crw_free(dp, dl);
  return out;
}

export function aes256_ige_encrypt(data, key, iv) {
  const [dp, dl] = putBytes(new Uint8Array(data));
  const [kp, kl] = putBytes(new Uint8Array(key));
  const [ip, il] = putBytes(new Uint8Array(iv));
  const out = callBytes($.crw_aes256_ige_encrypt, [dp, dl, kp, kl, ip, il]);
  $.crw_free(dp, dl);
  $.crw_free(kp, kl);
  $.crw_free(ip, il);
  return out;
}

export function aes256_ige_decrypt(data, key, iv) {
  const [dp, dl] = putBytes(new Uint8Array(data));
  const [kp, kl] = putBytes(new Uint8Array(key));
  const [ip, il] = putBytes(new Uint8Array(iv));
  const out = callBytes($.crw_aes256_ige_decrypt, [dp, dl, kp, kl, ip, il]);
  $.crw_free(dp, dl);
  $.crw_free(kp, kl);
  $.crw_free(ip, il);
  return out;
}

export function aes256_ctr_process(data, key, iv, byte_offset) {
  const [dp, dl] = putBytes(new Uint8Array(data));
  const [kp, kl] = putBytes(new Uint8Array(key));
  const [ip, il] = putBytes(new Uint8Array(iv));
  const out = callBytes($.crw_aes256_ctr_process, [dp, dl, kp, kl, ip, il, BigInt(byte_offset)]);
  $.crw_free(dp, dl);
  $.crw_free(kp, kl);
  $.crw_free(ip, il);
  return out;
}

export function runKat() {
  return $.crw_kat();
}
