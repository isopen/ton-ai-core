/* tslint:disable */
/* eslint-disable */

export function get_random_bytes(len: number): Uint8Array;

export function sha1_hash(data: Uint8Array): Uint8Array;

export function sha256_hash(data: Uint8Array): Uint8Array;

export function sha512_hash(data: Uint8Array): Uint8Array;

export function hmac_sha256(key: Uint8Array, data: Uint8Array): Uint8Array;

export function hmac_sha512(key: Uint8Array, data: Uint8Array): Uint8Array;

export function hkdf_sha512_extract(salt: Uint8Array, ikm: Uint8Array): Uint8Array;

export function hkdf_sha512_expand(prk: Uint8Array, info: Uint8Array, len: number): Uint8Array;

export function pbkdf2_sha256(password: Uint8Array, salt: Uint8Array, iterations: number, dk_len: number): Uint8Array;

export function mod_pow(base_hex: string, exp_hex: string, mod_hex: string): string;

export function is_probably_prime(n_hex: string, rounds: number): boolean;

export function aes256_ecb_encrypt(key: Uint8Array, data: Uint8Array): Uint8Array;

export function aes256_ecb_decrypt(key: Uint8Array, data: Uint8Array): Uint8Array;

export function aes256_cbc_encrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array;

export function aes256_cbc_decrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array;

export function aes256_cbc_encrypt_etm(mac_key: Uint8Array, enc_key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array;

export function aes256_cbc_decrypt_etm(mac_key: Uint8Array, enc_key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array;

export function aes256_cbc_seal(mac_key: Uint8Array, enc_key: Uint8Array, plaintext: Uint8Array): Uint8Array;

export function aes256_cbc_open(mac_key: Uint8Array, enc_key: Uint8Array, sealed: Uint8Array): Uint8Array;

export function aes256_ige_encrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array;

export function aes256_ige_decrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array;

export function aes256_ctr_process(data: Uint8Array, key: Uint8Array, iv: Uint8Array, byte_offset: bigint): Uint8Array;

export function runKat(): number;

export interface InitInput { }

export type SyncInitInput = BufferSource | WebAssembly.Module;

export default function init(module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<void>;

export const __wbg_init: typeof init;
