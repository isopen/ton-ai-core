use wasm_bindgen::prelude::*;
use std::fmt;
pub mod aes;
pub mod hashes;
pub mod bigint;

const MAX_RANDOM_CHUNK: usize = 65_536;
const MAX_RANDOM_BYTES: usize = 1 << 20;
const MAX_DERIVED_LEN: usize = 255 * 64;
const MAX_MODPOW_LIMBS: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoError {
    InvalidKeyLength,
    InvalidIvLength,
    InputNotAligned,
    EmptyHex,
    InvalidHexChar,
    DivisionByZero,
    ModulusIsZero,
    ZeroIterations,
    DerivedKeyTooLong,
    RandomTooLarge,
    AuthenticationFailure,
    NoModularInverse,
    BlindingExhausted,
    OperandTooLarge,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            CryptoError::InvalidKeyLength => "invalid AES-256 key length: expected 32 bytes",
            CryptoError::InvalidIvLength => "invalid IV length",
            CryptoError::InputNotAligned => "input length must be a multiple of 16 bytes",
            CryptoError::EmptyHex => "empty hex string",
            CryptoError::InvalidHexChar => "invalid character in hex string",
            CryptoError::DivisionByZero => "division by zero",
            CryptoError::ModulusIsZero => "modulus must be non-zero",
            CryptoError::ZeroIterations => "PBKDF2 iteration count must be greater than zero",
            CryptoError::DerivedKeyTooLong => "derived output length exceeds 255 * 64 bytes",
            CryptoError::RandomTooLarge => "random length exceeds 1 MiB limit",
            CryptoError::AuthenticationFailure => "authentication failed: MAC mismatch",
            CryptoError::NoModularInverse => "input has no modular inverse for the given modulus",
            CryptoError::BlindingExhausted => "unable to select a blinding factor for the given modulus",
            CryptoError::OperandTooLarge => "mod_pow operand exceeds 8192 bits",
        };
        f.write_str(s)
    }
}

impl std::error::Error for CryptoError {}

pub(crate) fn wipe<T: Default + Copy>(buf: &mut [T]) {
    for x in buf.iter_mut() {
        unsafe { std::ptr::write_volatile(x, T::default()); }
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

fn require_key(key: &[u8]) -> Result<(), CryptoError> {
    if key.len() == 32 { Ok(()) } else { Err(CryptoError::InvalidKeyLength) }
}

fn require_iv(iv: &[u8], len: usize) -> Result<(), CryptoError> {
    if iv.len() == len { Ok(()) } else { Err(CryptoError::InvalidIvLength) }
}

fn require_aligned(data: &[u8]) -> Result<(), CryptoError> {
    if data.len() % 16 == 0 { Ok(()) } else { Err(CryptoError::InputNotAligned) }
}

pub fn require_modpow_size(operands: &[&[u64]]) -> Result<(), CryptoError> {
    for op in operands {
        if op.len() > MAX_MODPOW_LIMBS { return Err(CryptoError::OperandTooLarge); }
    }
    Ok(())
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = crypto, js_name = getRandomValues)]
    fn js_get_random_values(arr: &mut [u8]);
}

#[wasm_bindgen]
pub fn get_random_bytes(len: usize) -> Result<Vec<u8>, JsError> {
    if len > MAX_RANDOM_BYTES { return Err(JsError::new(&CryptoError::RandomTooLarge.to_string())); }
    let mut buf = vec![0u8; len];
    for chunk in buf.chunks_mut(MAX_RANDOM_CHUNK) {
        js_get_random_values(chunk);
    }
    Ok(buf)
}

pub(crate) fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

#[cfg(target_arch = "wasm32")]
fn random_bytes(n: usize) -> Vec<u8> {
    let mut v = vec![0u8; n];
    js_get_random_values(&mut v);
    v
}

pub fn mul_mod(a: &[u64], b: &[u64], m: &[u64]) -> Result<Vec<u64>, CryptoError> {
    bigint::divmod(&bigint::mul(a, b), m).map(|(_, r)| r)
}

pub fn mod_pow_blind_with(base: &[u64], exp: &[u64], modulus: &[u64], blinder: &[u64]) -> Result<Vec<u64>, CryptoError> {
    if bigint::is_zero(modulus) { return Err(CryptoError::ModulusIsZero); }
    let mut r = bigint::divmod(blinder, modulus).map(|(_, r)| r)?;
    if bigint::is_zero(&r) { return Err(CryptoError::NoModularInverse); }
    let mut r_inv = bigint::mod_inv(&r, modulus)?;
    let mut blinded_base = mul_mod(base, &r, modulus)?;
    let core = bigint::mod_pow(&blinded_base, exp, modulus)?;
    let mut unblind = bigint::mod_pow(&r_inv, exp, modulus)?;
    let out = mul_mod(&core, &unblind, modulus);
    crate::wipe(&mut blinded_base);
    crate::wipe(&mut unblind);
    crate::wipe(&mut r);
    crate::wipe(&mut r_inv);
    let mut core_mut = core;
    crate::wipe(&mut core_mut);
    out
}

#[allow(unused_variables)]
pub fn mod_pow_auto(base: &[u64], exp: &[u64], modulus: &[u64]) -> Result<Vec<u64>, CryptoError> {
    #[cfg(target_arch = "wasm32")]
    {
        let exp_wide = exp.len() * 64 > 32;
        if exp_wide {
            for _ in 0..128 {
                let mut raw = random_bytes(modulus.len() * 8);
                let mut cand = bigint::bytes_to_limbs_be(&raw);
                crate::wipe(&mut raw);
                let ok = !bigint::is_zero(&cand)
                    && bigint::divmod(&cand, modulus).map(|(_, r)| !bigint::is_zero(&r)).unwrap_or(false);
                if ok {
                    match mod_pow_blind_with(base, exp, modulus, &cand) {
                        Ok(v) => return Ok(v),
                        Err(CryptoError::NoModularInverse) => {
                            crate::wipe(&mut cand);
                            continue;
                        }
                        Err(e) => return Err(e),
                    }
                }
                crate::wipe(&mut cand);
            }
            return Err(CryptoError::BlindingExhausted);
        }
    }
    bigint::mod_pow(base, exp, modulus)
}

pub fn cbc_encrypt_etm_checked(mac_key: &[u8], enc_key: &[u8], iv: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    require_key(mac_key)?;
    let mut ct = cbc_encrypt_checked(enc_key, iv, plaintext)?;
    let mut mac_input = Vec::with_capacity(iv.len() + ct.len());
    mac_input.extend_from_slice(iv);
    mac_input.extend_from_slice(&ct);
    let tag = hmac_sha256(mac_key, &mac_input);
    crate::wipe(&mut mac_input);
    ct.extend_from_slice(&tag);
    Ok(ct)
}

pub fn cbc_decrypt_etm_checked(mac_key: &[u8], enc_key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    require_key(mac_key)?;
    if data.len() < 16 + 32 || (data.len() - 32) % 16 != 0 {
        return Err(CryptoError::AuthenticationFailure);
    }
    let split = data.len() - 32;
    let mut mac_input = Vec::with_capacity(iv.len() + split);
    mac_input.extend_from_slice(iv);
    mac_input.extend_from_slice(&data[..split]);
    let mut expected = hmac_sha256(mac_key, &mac_input);
    crate::wipe(&mut mac_input);
    let ok = ct_eq(&expected, &data[split..]);
    crate::wipe(&mut expected);
    if !ok {
        return Err(CryptoError::AuthenticationFailure);
    }
    cbc_decrypt_checked(enc_key, iv, &data[..split])
}

pub fn ecb_encrypt_checked(key: &[u8], data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    require_key(key)?;
    require_aligned(data)?;
    let mut rk = aes::key_expansion(key)?;
    let mut out = vec![0u8; data.len()];
    let mut block = [0u8; 16];
    for (i, chunk) in data.chunks(16).enumerate() {
        block.copy_from_slice(chunk);
        aes::aes256_encrypt_block(&rk, &mut block);
        out[i*16..(i+1)*16].copy_from_slice(&block);
    }
    wipe(&mut block);
    wipe(&mut rk);
    Ok(out)
}

pub fn ecb_decrypt_checked(key: &[u8], data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    require_key(key)?;
    require_aligned(data)?;
    let mut rk = aes::key_expansion(key)?;
    let mut out = vec![0u8; data.len()];
    let mut block = [0u8; 16];
    for (i, chunk) in data.chunks(16).enumerate() {
        block.copy_from_slice(chunk);
        aes::aes256_decrypt_block(&rk, &mut block);
        out[i*16..(i+1)*16].copy_from_slice(&block);
    }
    wipe(&mut block);
    wipe(&mut rk);
    Ok(out)
}

pub fn cbc_encrypt_checked(key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    require_key(key)?;
    require_iv(iv, 16)?;
    require_aligned(data)?;
    let mut rk = aes::key_expansion(key)?;
    let mut prev = [0u8; 16];
    prev.copy_from_slice(iv);
    let mut out = vec![0u8; data.len()];
    for (i, chunk) in data.chunks(16).enumerate() {
        for j in 0..16 { prev[j] ^= chunk[j]; }
        aes::aes256_encrypt_block(&rk, &mut prev);
        out[i*16..(i+1)*16].copy_from_slice(&prev);
    }
    wipe(&mut prev);
    wipe(&mut rk);
    Ok(out)
}

pub fn cbc_decrypt_checked(key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    require_key(key)?;
    require_iv(iv, 16)?;
    require_aligned(data)?;
    let mut rk = aes::key_expansion(key)?;
    let mut prev = [0u8; 16];
    prev.copy_from_slice(iv);
    let mut out = vec![0u8; data.len()];
    for (i, chunk) in data.chunks(16).enumerate() {
        let mut ct = [0u8; 16];
        ct.copy_from_slice(chunk);
        let saved_ct = ct;
        aes::aes256_decrypt_block(&rk, &mut ct);
        for j in 0..16 { ct[j] ^= prev[j]; }
        out[i*16..(i+1)*16].copy_from_slice(&ct);
        prev = saved_ct;
    }
    wipe(&mut prev);
    wipe(&mut rk);
    Ok(out)
}

fn add_ctr(counter: &mut [u8; 16], amount: u64) {
    let mut carry = amount as u128;
    for i in (0..16).rev() {
        if carry == 0 { break; }
        let sum = counter[i] as u128 + (carry & 0xff);
        counter[i] = sum as u8;
        carry >>= 8;
        carry += sum >> 8;
    }
}

pub fn ige_encrypt_checked(data: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, CryptoError> {
    require_key(key)?;
    require_iv(iv, 32)?;
    require_aligned(data)?;
    let mut rk = aes::key_expansion(key)?;
    let mut enc_iv = [0u8; 16];
    let mut dec_iv = [0u8; 16];
    enc_iv.copy_from_slice(&iv[..16]);
    dec_iv.copy_from_slice(&iv[16..32]);
    let mut out = vec![0u8; data.len()];
    let mut pt = [0u8; 16];
    let mut x = [0u8; 16];

    for (bi, chunk) in data.chunks(16).enumerate() {
        pt.copy_from_slice(chunk);
        x.copy_from_slice(&pt);
        for j in 0..16 { x[j] ^= enc_iv[j]; }
        aes::aes256_encrypt_block(&rk, &mut x);
        for j in 0..16 { x[j] ^= dec_iv[j]; }
        out[bi*16..(bi+1)*16].copy_from_slice(&x);
        enc_iv.copy_from_slice(&x);
        dec_iv.copy_from_slice(&pt);
    }
    wipe(&mut pt);
    wipe(&mut x);
    wipe(&mut enc_iv);
    wipe(&mut dec_iv);
    wipe(&mut rk);
    Ok(out)
}

pub fn ige_decrypt_checked(data: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, CryptoError> {
    require_key(key)?;
    require_iv(iv, 32)?;
    require_aligned(data)?;
    let mut rk = aes::key_expansion(key)?;
    let mut enc_iv = [0u8; 16];
    let mut dec_iv = [0u8; 16];
    enc_iv.copy_from_slice(&iv[..16]);
    dec_iv.copy_from_slice(&iv[16..32]);
    let mut out = vec![0u8; data.len()];
    let mut ct = [0u8; 16];
    let mut x = [0u8; 16];

    for (bi, chunk) in data.chunks(16).enumerate() {
        ct.copy_from_slice(chunk);
        x.copy_from_slice(&ct);
        for j in 0..16 { x[j] ^= dec_iv[j]; }
        aes::aes256_decrypt_block(&rk, &mut x);
        for j in 0..16 { x[j] ^= enc_iv[j]; }
        out[bi*16..(bi+1)*16].copy_from_slice(&x);
        enc_iv.copy_from_slice(&ct);
        dec_iv.copy_from_slice(&x);
    }
    wipe(&mut ct);
    wipe(&mut x);
    wipe(&mut enc_iv);
    wipe(&mut dec_iv);
    wipe(&mut rk);
    Ok(out)
}

pub fn ctr_process_checked(data: &[u8], key: &[u8], iv: &[u8], byte_offset: usize) -> Result<Vec<u8>, CryptoError> {
    require_key(key)?;
    require_iv(iv, 16)?;
    let mut rk = aes::key_expansion(key)?;

    let mut counter = [0u8; 16];
    counter.copy_from_slice(iv);
    add_ctr(&mut counter, (byte_offset / 16) as u64);

    let mut block = [0u8; 16];
    block.copy_from_slice(&counter);
    aes::aes256_encrypt_block(&rk, &mut block);
    let mut pos = byte_offset % 16;

    let mut out = Vec::with_capacity(data.len());
    let mut idx = 0usize;
    while idx < data.len() {
        while pos < 16 && idx < data.len() {
            out.push(data[idx] ^ block[pos]);
            idx += 1;
            pos += 1;
        }
        if idx < data.len() {
            add_ctr(&mut counter, 1);
            block.copy_from_slice(&counter);
            aes::aes256_encrypt_block(&rk, &mut block);
            pos = 0;
        }
    }

    wipe(&mut counter);
    wipe(&mut rk);
    wipe(&mut block);
    Ok(out)
}

#[wasm_bindgen]
pub fn sha1_hash(data: &[u8]) -> Vec<u8> {
    hashes::sha1(data).to_vec()
}

#[wasm_bindgen]
pub fn sha256_hash(data: &[u8]) -> Vec<u8> {
    hashes::sha256(data).to_vec()
}

#[wasm_bindgen]
pub fn sha512_hash(data: &[u8]) -> Vec<u8> {
    hashes::sha512(data).to_vec()
}

#[wasm_bindgen]
pub fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut k = key.to_vec();
    if k.len() > 64 { k = hashes::sha256(&k).to_vec(); }
    k.resize(64, 0);

    let mut ipad: Vec<u8> = k.iter().map(|b| b ^ 0x36).collect();
    let mut opad: Vec<u8> = k.iter().map(|b| b ^ 0x5c).collect();

    let mut inner_input = [&ipad[..], data].concat();
    let inner = hashes::sha256(&inner_input).to_vec();
    wipe(&mut ipad);
    wipe(&mut inner_input);

    let mut outer_input = [&opad[..], &inner].concat();
    wipe(&mut opad);
    let mac = hashes::sha256(&outer_input).to_vec();
    wipe(&mut outer_input);
    wipe(&mut k);
    mac
}

#[wasm_bindgen]
pub fn hmac_sha512(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut k = key.to_vec();
    if k.len() > 128 { k = hashes::sha512(&k).to_vec(); }
    k.resize(128, 0);

    let mut ipad: Vec<u8> = k.iter().map(|b| b ^ 0x36).collect();
    let mut opad: Vec<u8> = k.iter().map(|b| b ^ 0x5c).collect();

    let mut inner_input = [&ipad[..], data].concat();
    let inner = hashes::sha512(&inner_input).to_vec();
    wipe(&mut ipad);
    wipe(&mut inner_input);

    let mut outer_input = [&opad[..], &inner].concat();
    wipe(&mut opad);
    let mac = hashes::sha512(&outer_input).to_vec();
    wipe(&mut outer_input);
    wipe(&mut k);
    mac
}

#[wasm_bindgen]
pub fn hkdf_sha512_extract(salt: &[u8], ikm: &[u8]) -> Vec<u8> {
    hmac_sha512(salt, ikm)
}

pub fn hkdf_expand_checked(prk: &[u8], info: &[u8], len: usize) -> Result<Vec<u8>, CryptoError> {
    if len > MAX_DERIVED_LEN { return Err(CryptoError::DerivedKeyTooLong); }
    let n_blocks = len.div_ceil(64);
    let mut okm = Vec::with_capacity(n_blocks * 64);
    let mut t: Vec<u8> = Vec::new();
    for i in 1..=n_blocks {
        let mut input = t.clone();
        input.extend_from_slice(info);
        input.push(i as u8);
        let next = hmac_sha512(prk, &input);
        wipe(&mut input);
        wipe(&mut t);
        t = next;
        okm.extend_from_slice(&t);
    }
    wipe(&mut t);
    okm.truncate(len);
    Ok(okm)
}

pub fn pbkdf2_sha256_checked(password: &[u8], salt: &[u8], iterations: usize, dk_len: usize) -> Result<Vec<u8>, CryptoError> {
    if iterations == 0 { return Err(CryptoError::ZeroIterations); }
    if dk_len > MAX_DERIVED_LEN { return Err(CryptoError::DerivedKeyTooLong); }
    let mut out = Vec::with_capacity(dk_len);
    let mut block_index: u32 = 1;
    while out.len() < dk_len {
        let mut input = salt.to_vec();
        input.extend_from_slice(&block_index.to_be_bytes());
        let mut u = hmac_sha256(password, &input);
        let mut acc = u.clone();
        for _ in 1..iterations {
            let next = hmac_sha256(password, &u);
            wipe(&mut u);
            u = next;
            for i in 0..acc.len() { acc[i] ^= u[i]; }
        }
        wipe(&mut input);
        wipe(&mut u);
        out.extend_from_slice(&acc);
        wipe(&mut acc);
        block_index += 1;
    }
    out.truncate(dk_len);
    Ok(out)
}

pub fn mod_pow_hex_checked(base_hex: &str, exp_hex: &str, mod_hex: &str) -> Result<String, CryptoError> {
    let mut base = bigint::hex_to_limbs(base_hex)?;
    let mut exp = bigint::hex_to_limbs(exp_hex)?;
    let mut modulus = bigint::hex_to_limbs(mod_hex)?;
    require_modpow_size(&[&base, &exp, &modulus])?;
    let r = mod_pow_auto(&base, &exp, &modulus)?;
    wipe(&mut base);
    wipe(&mut exp);
    wipe(&mut modulus);
    Ok(bigint::limbs_to_hex(&r))
}

#[wasm_bindgen]
pub fn aes256_ecb_encrypt(key: &[u8], data: &[u8]) -> Result<Vec<u8>, JsError> {
    ecb_encrypt_checked(key, data).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn aes256_ecb_decrypt(key: &[u8], data: &[u8]) -> Result<Vec<u8>, JsError> {
    ecb_decrypt_checked(key, data).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn aes256_cbc_encrypt(key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, JsError> {
    cbc_encrypt_checked(key, iv, data).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn aes256_cbc_encrypt_etm(mac_key: &[u8], enc_key: &[u8], iv: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, JsError> {
    cbc_encrypt_etm_checked(mac_key, enc_key, iv, plaintext).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn aes256_cbc_decrypt_etm(mac_key: &[u8], enc_key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, JsError> {
    cbc_decrypt_etm_checked(mac_key, enc_key, iv, data).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn aes256_cbc_decrypt(key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, JsError> {
    cbc_decrypt_checked(key, iv, data).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn aes256_ige_encrypt(data: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, JsError> {
    ige_encrypt_checked(data, key, iv).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn aes256_ige_decrypt(data: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, JsError> {
    ige_decrypt_checked(data, key, iv).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn aes256_ctr_process(data: &[u8], key: &[u8], iv: &[u8], byte_offset: usize) -> Result<Vec<u8>, JsError> {
    ctr_process_checked(data, key, iv, byte_offset).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn hkdf_sha512_expand(prk: &[u8], info: &[u8], len: usize) -> Result<Vec<u8>, JsError> {
    hkdf_expand_checked(prk, info, len).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn pbkdf2_sha256(password: &[u8], salt: &[u8], iterations: usize, dk_len: usize) -> Result<Vec<u8>, JsError> {
    pbkdf2_sha256_checked(password, salt, iterations, dk_len).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
pub fn mod_pow(base_hex: &str, exp_hex: &str, mod_hex: &str) -> Result<String, JsError> {
    mod_pow_hex_checked(base_hex, exp_hex, mod_hex).map_err(|e| JsError::new(&e.to_string()))
}
