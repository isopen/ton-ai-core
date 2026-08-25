import { Buffer } from 'buffer';

let wlogEnabled = false;
export function enableWasmLogging(v: boolean) { wlogEnabled = v; }
function log(op: string, detail?: string) {
  if (!wlogEnabled) return;
  if (detail) console.log(`[crypton] ${op} | ${detail}`);
  else console.log(`[crypton] ${op}`);
}

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
      await mod.default();
      wasmInstance = mod;
      log('init', 'wasm module loaded');
      return true;
    } catch (e) {
      console.warn('[crypton] init failed:', e);
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
  return Buffer.from(w('get_random_bytes').get_random_bytes(len));
}

export function wasmAes256EcbEncrypt(key: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ecb_encrypt', `data=${data.length}B`);
  return Buffer.from(w('aes256_ecb_encrypt').aes256_ecb_encrypt(key, data));
}

export function wasmAes256EcbDecrypt(key: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ecb_decrypt', `data=${data.length}B`);
  return Buffer.from(w('aes256_ecb_decrypt').aes256_ecb_decrypt(key, data));
}

export function wasmAes256CbcEncrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_encrypt', `data=${data.length}B`);
  return Buffer.from(w('aes256_cbc_encrypt').aes256_cbc_encrypt(key, iv, data));
}

export function wasmAes256CbcEncryptEtm(macKey: Buffer, encKey: Buffer, iv: Buffer, plaintext: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_etm_encrypt', `data=${plaintext.length}B`);
  return Buffer.from(w('aes256_cbc_encrypt_etm').aes256_cbc_encrypt_etm(macKey, encKey, iv, plaintext));
}

export function wasmAes256CbcDecryptEtm(macKey: Buffer, encKey: Buffer, iv: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_etm_decrypt', `data=${data.length}B`);
  return Buffer.from(w('aes256_cbc_decrypt_etm').aes256_cbc_decrypt_etm(macKey, encKey, iv, data));
}

export function wasmAes256CbcDecrypt(key: Buffer, iv: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_cbc_decrypt', `data=${data.length}B`);
  return Buffer.from(w('aes256_cbc_decrypt').aes256_cbc_decrypt(key, iv, data));
}

export function wasmAes256IgeEncrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ige_encrypt', `data=${data.length}B`);
  return Buffer.from(w('aes256_ige_encrypt').aes256_ige_encrypt(data, key, iv));
}

export function wasmAes256IgeDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ige_decrypt', `data=${data.length}B`);
  return Buffer.from(w('aes256_ige_decrypt').aes256_ige_decrypt(data, key, iv));
}

export function wasmAes256CtrProcess(data: Buffer, key: Buffer, iv: Buffer, offset: number): Buffer | null {
  if (!wasmInstance) return null;
  log('aes_ctr_process', `data=${data.length}B offset=${offset}`);
  return Buffer.from(w('aes256_ctr_process').aes256_ctr_process(data, key, iv, offset));
}

export function wasmSha1(data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('sha1', `data=${data.length}B`);
  return Buffer.from(w('sha1_hash').sha1_hash(data));
}

export function wasmSha256(data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('sha256', `data=${data.length}B`);
  return Buffer.from(w('sha256_hash').sha256_hash(data));
}

export function wasmHmacSha256(key: Buffer, data: Buffer): Buffer | null {
  if (!wasmInstance) return null;
  log('hmac_sha256', `key=${key.length}B data=${data.length}B`);
  return Buffer.from(w('hmac_sha256').hmac_sha256(key, data));
}

export function wasmModPow(baseHex: string, expHex: string, modHex: string): string | null {
  if (!wasmInstance) return null;
  const clean = (s: string) => s.startsWith('0x') ? s.slice(2) : s;
  log('mod_pow', `base=${baseHex.length}hex exp=${expHex.length}hex mod=${modHex.length}hex`);
  return w('mod_pow').mod_pow(clean(baseHex), clean(expHex), clean(modHex));
}
