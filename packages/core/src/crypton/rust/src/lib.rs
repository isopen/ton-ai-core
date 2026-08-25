use wasm_bindgen::prelude::*;
pub mod aes;
pub mod hashes;
pub mod bigint;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = crypto, js_name = getRandomValues)]
    fn js_get_random_values(arr: &mut [u8]);
}



#[wasm_bindgen]
pub fn get_random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    js_get_random_values(&mut buf);
    buf
}

fn pad16(mut data: Vec<u8>) -> Vec<u8> {
    let r = data.len() % 16;
    if r != 0 { data.extend(std::iter::repeat(0u8).take(16 - r)); }
    data
}

#[wasm_bindgen]
pub fn aes256_ecb_encrypt(key: &[u8], data: &[u8]) -> Vec<u8> {
    let rk = aes::key_expansion(key);
    let padded = pad16(data.to_vec());
    let mut out = vec![0u8; padded.len()];
    for (i, chunk) in padded.chunks(16).enumerate() {
        let mut block = [0u8; 16];
        block.copy_from_slice(chunk);
        aes::aes256_encrypt_block(&rk, &mut block);
        out[i*16..(i+1)*16].copy_from_slice(&block);
    }
    out
}

#[wasm_bindgen]
pub fn aes256_ecb_decrypt(key: &[u8], data: &[u8]) -> Vec<u8> {
    let rk = aes::key_expansion(key);
    let mut out = vec![0u8; data.len()];
    for (i, chunk) in data.chunks(16).enumerate() {
        let mut block = [0u8; 16];
        block.copy_from_slice(chunk);
        aes::aes256_decrypt_block(&rk, &mut block);
        out[i*16..(i+1)*16].copy_from_slice(&block);
    }
    out
}

#[wasm_bindgen]
pub fn aes256_cbc_encrypt(key: &[u8], iv: &[u8], data: &[u8]) -> Vec<u8> {
    let rk = aes::key_expansion(key);
    let padded = pad16(data.to_vec());
    let mut prev = [0u8; 16];
    prev.copy_from_slice(iv);
    let mut out = vec![0u8; padded.len()];
    for (i, chunk) in padded.chunks(16).enumerate() {
        for j in 0..16 { prev[j] ^= chunk[j]; }
        aes::aes256_encrypt_block(&rk, &mut prev);
        out[i*16..(i+1)*16].copy_from_slice(&prev);
    }
    out
}

#[wasm_bindgen]
pub fn aes256_cbc_decrypt(key: &[u8], iv: &[u8], data: &[u8]) -> Vec<u8> {
    let rk = aes::key_expansion(key);
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
    out
}

fn add_ctr(counter: &mut [u8; 16], amount: u64) {
    let mut carry = amount;
    for i in (0..16).rev() {
        if carry == 0 { break; }
        let sum = counter[i] as u64 + (carry & 0xff);
        counter[i] = sum as u8;
        carry >>= 8;
        if sum > 0xff { carry += 1; } else { carry = 0; }
    }
}

#[wasm_bindgen]
pub fn aes256_ige_encrypt(data: &[u8], key: &[u8], iv: &[u8]) -> Vec<u8> {
    let rk = aes::key_expansion(key);
    let padded = pad16(data.to_vec());
    let mut enc_iv = [0u8; 16];
    let mut dec_iv = [0u8; 16];
    enc_iv.copy_from_slice(&iv[..16]);
    dec_iv.copy_from_slice(&iv[16..32]);
    let mut out = vec![0u8; padded.len()];

    for (bi, chunk) in padded.chunks(16).enumerate() {
        let pt = [chunk[0],chunk[1],chunk[2],chunk[3],chunk[4],chunk[5],chunk[6],chunk[7],
                  chunk[8],chunk[9],chunk[10],chunk[11],chunk[12],chunk[13],chunk[14],chunk[15]];
        let mut x = pt;
        for j in 0..16 { x[j] ^= enc_iv[j]; }
        aes::aes256_encrypt_block(&rk, &mut x);
        for j in 0..16 { x[j] ^= dec_iv[j]; }
        out[bi*16..(bi+1)*16].copy_from_slice(&x);
        enc_iv.copy_from_slice(&x);
        dec_iv.copy_from_slice(&pt);
    }
    out
}

#[wasm_bindgen]
pub fn aes256_ige_decrypt(data: &[u8], key: &[u8], iv: &[u8]) -> Vec<u8> {
    let rk = aes::key_expansion(key);
    let mut enc_iv = [0u8; 16];
    let mut dec_iv = [0u8; 16];
    enc_iv.copy_from_slice(&iv[..16]);
    dec_iv.copy_from_slice(&iv[16..32]);
    let mut out = vec![0u8; data.len()];

    for (bi, chunk) in data.chunks(16).enumerate() {
        let ct = [chunk[0],chunk[1],chunk[2],chunk[3],chunk[4],chunk[5],chunk[6],chunk[7],
                  chunk[8],chunk[9],chunk[10],chunk[11],chunk[12],chunk[13],chunk[14],chunk[15]];
        let mut x = ct;
        for j in 0..16 { x[j] ^= dec_iv[j]; }
        aes::aes256_decrypt_block(&rk, &mut x);
        for j in 0..16 { x[j] ^= enc_iv[j]; }
        out[bi*16..(bi+1)*16].copy_from_slice(&x);
        enc_iv.copy_from_slice(&ct);
        dec_iv.copy_from_slice(&x);
    }
    out
}

#[wasm_bindgen]
pub fn aes256_ctr_process(data: &[u8], key: &[u8], iv: &[u8], byte_offset: usize) -> Vec<u8> {
    let rk = aes::key_expansion(key);

    let total_needed = byte_offset + data.len();
    let total_blocks = (total_needed + 15) / 16;
    let mut keystream = Vec::with_capacity(total_blocks * 16);

    let mut counter = [0u8; 16];
    counter.copy_from_slice(&iv[..16]);

    for _ in 0..total_blocks {
        let mut block = [0u8; 16];
        block.copy_from_slice(&counter);
        aes::aes256_encrypt_block(&rk, &mut block);
        keystream.extend_from_slice(&block);
        add_ctr(&mut counter, 1);
    }

    let mut out = Vec::with_capacity(data.len());
    for (i, b) in data.iter().enumerate() {
        out.push(b ^ keystream[byte_offset + i]);
    }
    out
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
    let block_size = 64;
    let mut k = key.to_vec();
    if k.len() > block_size { k = hashes::sha256(&k).to_vec(); }
    while k.len() < block_size { k.push(0); }

    let ipad: Vec<u8> = k.iter().map(|b| b ^ 0x36).collect();
    let opad: Vec<u8> = k.iter().map(|b| b ^ 0x5c).collect();
    let inner = hashes::sha256(&[&ipad[..], data].concat()).to_vec();
    hashes::sha256(&[&opad[..], &inner].concat()).to_vec()
}

#[wasm_bindgen]
pub fn hmac_sha512(key: &[u8], data: &[u8]) -> Vec<u8> {
    let block_size = 128;
    let mut k = key.to_vec();
    if k.len() > block_size { k = hashes::sha512(&k).to_vec(); }
    while k.len() < block_size { k.push(0); }

    let ipad: Vec<u8> = k.iter().map(|b| b ^ 0x36).collect();
    let opad: Vec<u8> = k.iter().map(|b| b ^ 0x5c).collect();
    let inner = hashes::sha512(&[&ipad[..], data].concat()).to_vec();
    hashes::sha512(&[&opad[..], &inner].concat()).to_vec()
}

#[wasm_bindgen]
pub fn hkdf_sha512_extract(salt: &[u8], ikm: &[u8]) -> Vec<u8> {
    hmac_sha512(salt, ikm)
}

#[wasm_bindgen]
pub fn hkdf_sha512_expand(prk: &[u8], info: &[u8], len: usize) -> Vec<u8> {
    let mut okm = Vec::new();
    let mut t: Vec<u8> = Vec::new();
    let mut i: u8 = 1;
    while okm.len() < len {
        let mut input = t.clone();
        input.extend_from_slice(info);
        input.push(i);
        t = hmac_sha512(prk, &input);
        okm.extend_from_slice(&t);
        i += 1;
    }
    okm.truncate(len);
    okm
}

#[wasm_bindgen]
pub fn pbkdf2_sha256(password: &[u8], salt: &[u8], iterations: usize, dk_len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(dk_len);
    let mut block_index: u32 = 1;
    while out.len() < dk_len {
        let mut input = salt.to_vec();
        input.extend_from_slice(&block_index.to_be_bytes());
        let mut u = hmac_sha256(password, &input);
        let mut acc = u.clone();
        for _ in 1..iterations {
            u = hmac_sha256(password, &u);
            for i in 0..acc.len() { acc[i] ^= u[i]; }
        }
        out.extend_from_slice(&acc);
        block_index += 1;
    }
    out.truncate(dk_len);
    out
}

#[wasm_bindgen]
pub fn mod_pow(base_hex: &str, exp_hex: &str, mod_hex: &str) -> String {
    let base = bigint::hex_to_limbs(base_hex);
    let exp = bigint::hex_to_limbs(exp_hex);
    let modulus = bigint::hex_to_limbs(mod_hex);
    bigint::limbs_to_hex(&bigint::mod_pow(&base, &exp, &modulus))
}

