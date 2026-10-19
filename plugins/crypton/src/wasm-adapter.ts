import { Buffer } from 'buffer';

let wlogEnabled = false;
export function enableWasmLogging(v: boolean) { wlogEnabled = v; }
export function isWasmLoggingEnabled() { return wlogEnabled; }
function log(op: string, detail?: string) {
  if (!wlogEnabled) return;
  if (detail) console.log(`[crypton] ${op} | ${detail}`);
  else console.log(`[crypton] ${op}`);
}

const wasmCallCounts = new Map<string, number>();
function count(op: string) {
  wasmCallCounts.set(op, (wasmCallCounts.get(op) ?? 0) + 1);
}
export function getWasmCallStats(): Record<string, number> {
  return Object.fromEntries([...wasmCallCounts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
export function resetWasmCallStats() { wasmCallCounts.clear(); }

let generation = 0;
export function deinitWasm(): void {
  generation += 1;
  wasmInstance = null;
  initPromise = null;
}

let wasmInstance: any = null;
let initPromise: Promise<boolean> | null = null;

export function isWasmAvailable(): boolean {
  return wasmInstance !== null;
}

export async function initWasm(wasmBinary?: Uint8Array, implementation: 'rust' | 'c' = 'rust'): Promise<boolean> {
  if (wasmInstance) return true;
  if (initPromise) return initPromise;
  const gen = generation;
  initPromise = (async () => {
    try {
      const mod: any = implementation === 'c'
        ? await import('./c/wasm/crypton_wasm.js')
        : await import('./rust/wasm/crypton_wasm.js');
      const initFn: any =
        (typeof mod.default === 'function' && mod.default) ||
        (typeof mod.__wbg_init === 'function' && mod.__wbg_init) ||
        (mod.default && typeof mod.default.default === 'function' && mod.default.default);
      if (typeof initFn !== 'function') throw new TypeError('crypton_wasm init export not found');
      if (wasmBinary && wasmBinary.length > 0) {
        try {
          await initFn({ module_or_path: wasmBinary });
        } catch {
          await initFn(wasmBinary);
        }
      } else {
        await initFn();
      }
      if (gen !== generation) return false;
      wasmInstance = mod;
      log('init', 'wasm module loaded');
      return true;
    } catch (e) {
      console.warn('[crypton] init failed:', e);
      console.warn('[crypton] falling back to the pure-JS backend. WASM artifacts are built by '
        + '`bash plugins/crypton/src/rust/build.sh` and `bash plugins/crypton/src/c/build.sh` and can be provided to the host via '
        + '`initWasmCrypton({ wasmBinary })`.');
      initPromise = null;
      return false;
    }
  })();
  return initPromise;
}

function w(): typeof import('./rust/wasm/crypton_wasm') {
  if (!wasmInstance) throw new Error('crypton WASM not initialized');
  return wasmInstance;
}

export function wasmGetRandomBytes(len: number): Buffer | null {
  if (!wasmInstance) return null;
  log('get_random_bytes', `len=${len}`);
  count('get_random_bytes');
  return Buffer.from(w().get_random_bytes(len));
}

export function wasmAes256EcbEncrypt(key: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ecb_encrypt', `data=${data.length}B`);
  count('aes_ecb_encrypt');
  return Buffer.from(w().aes256_ecb_encrypt(key, data));
}

export function wasmAes256EcbDecrypt(key: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ecb_decrypt', `data=${data.length}B`);
  count('aes_ecb_decrypt');
  return Buffer.from(w().aes256_ecb_decrypt(key, data));
}

export function wasmAes256CbcEncrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_encrypt', `data=${data.length}B`);
  count('aes_cbc_encrypt');
  return Buffer.from(w().aes256_cbc_encrypt(key, iv, data));
}

export function wasmAes256CbcDecrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_decrypt', `data=${data.length}B`);
  count('aes_cbc_decrypt');
  return Buffer.from(w().aes256_cbc_decrypt(key, iv, data));
}

export function wasmAes256IgeEncrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ige_encrypt', `data=${data.length}B`);
  count('aes_ige_encrypt');
  return Buffer.from(w().aes256_ige_encrypt(data, key, iv));
}

export function wasmAes256IgeDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ige_decrypt', `data=${data.length}B`);
  count('aes_ige_decrypt');
  return Buffer.from(w().aes256_ige_decrypt(data, key, iv));
}

export function wasmAes256CtrProcess(data: Buffer, key: Buffer, iv: Buffer, offset: number): Buffer | null {
  if (!wasmInstance) return null;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error(`Invalid CTR byte offset: ${offset}`);
  log('aes_ctr_process', `data=${data.length}B offset=${offset}`);
  count('aes_ctr_process');
  return Buffer.from(w().aes256_ctr_process(data, key, iv, BigInt(offset)));
}

export function wasmSha1(data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('sha1', `data=${data.length}B`);
  count('sha1');
  return Buffer.from(w().sha1_hash(data));
}

export function wasmSha256(data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('sha256', `data=${data.length}B`);
  count('sha256');
  return Buffer.from(w().sha256_hash(data));
}

export function wasmHmacSha256(key: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('hmac_sha256', `key=${key.length}B data=${data.length}B`);
  count('hmac_sha256');
  return Buffer.from(w().hmac_sha256(key, data));
}

export function wasmHmacSha512(key: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('hmac_sha512', `key=${key.length}B data=${data.length}B`);
  count('hmac_sha512');
  return Buffer.from(w().hmac_sha512(key, data));
}

export function wasmIsProbablyPrime(nHex: string, rounds: number): boolean | null {
  if (!wasmInstance) return null;
  log('is_probably_prime', `n=${nHex.length}hex rounds=${rounds}`);
  count('is_probably_prime');
  return w().is_probably_prime(nHex, rounds);
}

export function wasmModPow(baseHex: string, expHex: string, modHex: string): string | null {
  if (!wasmInstance) return null;
  const clean = (s: string) => s.startsWith('0x') ? s.slice(2) : s;
  log('mod_pow', `base=${baseHex.length}hex exp=${expHex.length}hex mod=${modHex.length}hex`);
  count('mod_pow');
  return w().mod_pow(clean(baseHex), clean(expHex), clean(modHex));
}
