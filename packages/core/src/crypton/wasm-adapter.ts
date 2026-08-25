import { Buffer } from 'buffer';

let wlogEnabled = false;
export function enableWasmLogging(v: boolean) { wlogEnabled = v; }
export function isWasmLoggingEnabled() { return wlogEnabled; }
function log(op: string, detail?: string) {
  if (!wlogEnabled) return;
  if (detail) console.log(`[crypton-rs] ${op} | ${detail}`);
  else console.log(`[crypton-rs] ${op}`);
}

const wasmCallCounts = new Map<string, number>();
function count(op: string) {
  wasmCallCounts.set(op, (wasmCallCounts.get(op) ?? 0) + 1);
}
export function getWasmCallStats(): Record<string, number> {
  return Object.fromEntries([...wasmCallCounts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
export function resetWasmCallStats() { wasmCallCounts.clear(); }

let wasmInstance: typeof import('./wasm/crypton_wasm') | null = null;
let initPromise: Promise<boolean> | null = null;

export function isWasmAvailable(): boolean {
  return wasmInstance !== null;
}

export async function initWasm(): Promise<boolean> {
  if (wasmInstance) return true;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const mod = await import('./wasm/crypton_wasm.js');
      const isNode = typeof process !== 'undefined' && !!(process as any).versions?.node;
      if (isNode) {
        const { readFileSync } = await import('fs');
        const path = await import('path');
        const wasmPath = path.join(__dirname, 'wasm', 'crypton_wasm_bg.wasm');
        await mod.default(readFileSync(wasmPath));
      } else {
        await mod.default();
      }
      wasmInstance = mod;
      log('init', 'wasm module loaded');
      return true;
    } catch (e) {
      console.warn('[crypton-rs] init failed:', e);
      return false;
    }
  })();
  return initPromise;
}

function w(fnName: string): typeof import('./wasm/crypton_wasm') {
  if (!wasmInstance) throw new Error('crypton WASM not initialized');
  return wasmInstance;
}

export function wasmGetRandomBytes(len: number): Buffer | null {
  if (!wasmInstance) return null;
  log('get_random_bytes', `len=${len}`);
  count('get_random_bytes');
  return Buffer.from(w('get_random_bytes').get_random_bytes(len));
}

export function wasmAes256EcbEncrypt(key: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ecb_encrypt', `data=${data.length}B`);
  count('aes_ecb_encrypt');
  return Buffer.from(w('aes256_ecb_encrypt').aes256_ecb_encrypt(key, data));
}

export function wasmAes256EcbDecrypt(key: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ecb_decrypt', `data=${data.length}B`);
  count('aes_ecb_decrypt');
  return Buffer.from(w('aes256_ecb_decrypt').aes256_ecb_decrypt(key, data));
}

export function wasmAes256CbcEncrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_encrypt', `data=${data.length}B`);
  count('aes_cbc_encrypt');
  return Buffer.from(w('aes256_cbc_encrypt').aes256_cbc_encrypt(key, iv, data));
}

export function wasmAes256CbcEncryptEtm(macKey: Buffer, encKey: Buffer, iv: Buffer, plaintext: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_etm_encrypt', `data=${plaintext.length}B`);
  count('aes_cbc_etm_encrypt');
  return Buffer.from(w('aes256_cbc_encrypt_etm').aes256_cbc_encrypt_etm(macKey, encKey, iv, plaintext));
}

export function wasmAes256CbcDecryptEtm(macKey: Buffer, encKey: Buffer, iv: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_etm_decrypt', `data=${data.length}B`);
  return Buffer.from(w('aes256_cbc_decrypt_etm').aes256_cbc_decrypt_etm(macKey, encKey, iv, data));
}

export function wasmAes256CbcSeal(macKey: Buffer, encKey: Buffer, plaintext: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_seal', `data=${plaintext.length}B`);
  return Buffer.from(w('aes256_cbc_seal').aes256_cbc_seal(macKey, encKey, plaintext));
}

export function wasmAes256CbcOpen(macKey: Buffer, encKey: Buffer, sealed: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_open', `data=${sealed.length}B`);
  return Buffer.from(w('aes256_cbc_open').aes256_cbc_open(macKey, encKey, sealed));
}

export function wasmAes256CbcDecrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_decrypt', `data=${data.length}B`);
  count('aes_cbc_decrypt');
  return Buffer.from(w('aes256_cbc_decrypt').aes256_cbc_decrypt(key, iv, data));
}

export function wasmAes256IgeEncrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ige_encrypt', `data=${data.length}B`);
  count('aes_ige_encrypt');
  return Buffer.from(w('aes256_ige_encrypt').aes256_ige_encrypt(data, key, iv));
}

export function wasmAes256IgeDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ige_decrypt', `data=${data.length}B`);
  count('aes_ige_decrypt');
  return Buffer.from(w('aes256_ige_decrypt').aes256_ige_decrypt(data, key, iv));
}

export function wasmAes256CtrProcess(data: Buffer, key: Buffer, iv: Buffer, offset: number): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ctr_process', `data=${data.length}B offset=${offset}`);
  count('aes_ctr_process');
  return Buffer.from(w('aes256_ctr_process').aes256_ctr_process(data, key, iv, offset));
}

export function wasmSha1(data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('sha1', `data=${data.length}B`);
  count('sha1');
  return Buffer.from(w('sha1_hash').sha1_hash(data));
}

export function wasmSha256(data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('sha256', `data=${data.length}B`);
  count('sha256');
  return Buffer.from(w('sha256_hash').sha256_hash(data));
}

export function wasmHmacSha256(key: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('hmac_sha256', `key=${key.length}B data=${data.length}B`);
  count('hmac_sha256');
  return Buffer.from(w('hmac_sha256').hmac_sha256(key, data));
}

export function wasmIsProbablyPrime(nHex: string, rounds: number): boolean | null {
  if (!wasmInstance) return null;
  log('is_probably_prime', `n=${nHex.length}hex rounds=${rounds}`);
  return w('is_probably_prime').is_probably_prime(nHex, rounds);
}

export function wasmModPow(baseHex: string, expHex: string, modHex: string): string | null {
  if (!wasmInstance) return null;
  const clean = (s: string) => s.startsWith('0x') ? s.slice(2) : s;
  log('mod_pow', `base=${baseHex.length}hex exp=${expHex.length}hex mod=${modHex.length}hex`);
  count('mod_pow');
  return w('mod_pow').mod_pow(clean(baseHex), clean(expHex), clean(modHex));
}
