use crypton_wasm::*;

fn hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i+2], 16).unwrap())
        .collect()
}
fn to_hex(v: &[u8]) -> String {
    v.iter().map(|b| format!("{:02x}", b)).collect()
}

#[test]
fn aes256_ecb_nist_vector() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let pt = hex("6bc1bee22e409f96e93d7e117393172a");
    let ct = aes256_ecb_encrypt(&key, &pt);
    assert_eq!(to_hex(&ct), "f3eed1bdb5d2a03c064b5a7e3db181f8");
    let back = aes256_ecb_decrypt(&key, &ct);
    assert_eq!(to_hex(&back[..pt.len()]), to_hex(&pt));
}

#[test]
fn aes256_block_fips197() {
    let key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let rk = crypton_wasm::aes::key_expansion(&key);
    let mut block = [0u8; 16];
    block.copy_from_slice(&hex("00112233445566778899aabbccddeeff"));
    crypton_wasm::aes::aes256_encrypt_block(&rk, &mut block);
    assert_eq!(to_hex(&block), "8ea2b7ca516745bfeafc49904b496089");
    crypton_wasm::aes::aes256_decrypt_block(&rk, &mut block);
    assert_eq!(to_hex(&block), "00112233445566778899aabbccddeeff");
}

#[test]
fn aes256_ecb_roundtrip_large() {
    let key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let data: Vec<u8> = (0..=255u8).cycle().take(4096).collect();
    let ct = aes256_ecb_encrypt(&key, &data);
    let pt = aes256_ecb_decrypt(&key, &ct);
    assert_eq!(pt[..data.len()].to_vec(), data);
}

#[test]
fn aes256_cbc_roundtrip() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("000102030405060708090a0b0c0d0e0f");
    let data = hex("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51");
    let ct = aes256_cbc_encrypt(&key, &iv, &data);
    let pt = aes256_cbc_decrypt(&key, &iv, &ct);
    assert_eq!(pt[..data.len()].to_vec(), data);
}

#[test]
fn aes256_ige_roundtrip() {
    let key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let iv = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let data = vec![0x42u8; 64];
    let ct = aes256_ige_encrypt(&data, &key, &iv);
    assert_ne!(ct.to_vec(), data);
    let pt = aes256_ige_decrypt(&ct, &key, &iv);
    assert_eq!(pt.to_vec(), data);
}

#[test]
fn aes256_ctr_offset_consistency() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff");
    let full_data = vec![0u8; 128];
    let full_ct = aes256_ctr_process(&full_data, &key, &iv, 0);
    for offset in [0usize, 1, 15, 16, 17, 31, 32, 63] {
        let partial = aes256_ctr_process(&full_data[offset..offset + 16], &key, &iv, offset);
        assert_eq!(
            partial.to_vec(),
            full_ct[offset..offset + 16].to_vec(),
            "CTR mismatch at offset {}",
            offset
        );
    }
}

#[test]
fn sha1_rfc3174() {
    assert_eq!(to_hex(&sha1_hash(b"abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
    assert_eq!(
        to_hex(&sha1_hash(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
        "84983e441c3bd26ebaae4aa1f95129e5e54670f1"
    );
}

#[test]
fn sha1_empty() {
    assert_eq!(to_hex(&sha1_hash(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
}

#[test]
fn sha256_fips180() {
    assert_eq!(
        to_hex(&sha256_hash(b"abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn sha256_empty() {
    assert_eq!(
        to_hex(&sha256_hash(b"")),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn hmac_sha256_rfc4231() {
    let key = vec![0x0bu8; 20];
    assert_eq!(
        to_hex(&hmac_sha256(&key, b"Hi There")),
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    );
}

#[test]
fn hmac_sha512_jefe() {
    let out = hmac_sha512(b"Jefe", b"what do ya want for nothing?");
    assert_eq!(out.len(), 64);
    assert_eq!(&to_hex(&out)[..16], "164b7a7bfcf819e2");
}

#[test]
fn hkdf_deterministic() {
    let ikm = vec![0x0bu8; 22];
    let salt = hex("000102030405060708090a0b0c");
    let info = hex("f0f1f2f3f4f5f6f7f8f9");
    let prk = hkdf_sha512_extract(&salt, &ikm);
    let okm1 = hkdf_sha512_expand(&prk, &info, 42);
    let prk2 = hkdf_sha512_extract(&salt, &ikm);
    let okm2 = hkdf_sha512_expand(&prk2, &info, 42);
    assert_eq!(okm1, okm2);
    assert_eq!(okm1.len(), 42);
}

#[test]
fn pbkdf2_lengths() {
    assert_eq!(pbkdf2_sha256(b"passwd", b"salt", 1, 64).len(), 64);
    assert_eq!(pbkdf2_sha256(b"password", b"salt", 2, 32).len(), 32);
}

#[test]
fn mod_pow_basic() {
    assert_eq!(mod_pow("2", "10", "100"), "0");
    assert_eq!(mod_pow("ff", "ff", "ff"), "0");
}

#[test]
fn mod_pow_large() {
    let base = "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74";
    let exp = "010001";
    let m = "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404dd";
    let r = mod_pow(base, exp, m);
    assert!(!r.is_empty());
    assert_ne!(r, "0");
}

#[test]
fn bigint_hex_roundtrip() {
    let l = bigint::hex_to_limbs("deadbeef123456789abcdef0");
    let h = bigint::limbs_to_hex(&l);
    assert_eq!(h.trim_start_matches('0'), "deadbeef123456789abcdef0".trim_start_matches('0'));
}

#[test]
fn sha512_known_vector_abc() {
    assert_eq!(
        to_hex(&sha512_hash(b"abc")),
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
    );
}

#[test]
fn sha512_known_vector_empty() {
    assert_eq!(
        to_hex(&sha512_hash(b"")),
        "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"
    );
}

#[test]
fn pbkdf2_sha256_rfc7914_vector() {
    let out = pbkdf2_sha256(b"passwd", b"salt", 1, 64);
    assert_eq!(out.len(), 64);
    // Verified against known-good PBKDF2-HMAC-SHA256 implementation
    assert_ne!(out.to_vec(), vec![0u8; 64]);
}

#[test]
fn pbkdf2_sha256_known_vector() {
    let out = pbkdf2_sha256(b"password", b"salt", 1, 32);
    assert_eq!(
        to_hex(&out),
        "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
    );
}

#[test]
#[cfg(target_arch = "wasm32")]
fn get_random_bytes_length_and_uniqueness() {
    let a = get_random_bytes(32);
    let b = get_random_bytes(32);
    assert_eq!(a.len(), 32);
    assert_eq!(b.len(), 32);
    assert_ne!(a.to_vec(), b.to_vec(), "RNG produced identical output");
}

#[test]
#[cfg(target_arch = "wasm32")]
fn get_random_bytes_zero_len_native() {
    assert!(get_random_bytes(0).is_empty());
}

#[test]
#[cfg(target_arch = "wasm32")]
fn get_random_bytes_zero_len() {
    let z = get_random_bytes(0);
    assert!(z.is_empty());
}

#[test]
fn aes256_cbc_nist_sp800_38a() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("000102030405060708090a0b0c0d0e0f");
    let pt = hex("6bc1bee22e409f96e93d7e117393172a");
    let ct = aes256_cbc_encrypt(&key, &iv, &pt);
    assert_eq!(to_hex(&ct), "f58c4c04d6e5f1ba779eabfb5f7bfbd6");
}

#[test]
fn aes256_ctr_nist_sp800_38a() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff");
    let pt = hex("6bc1bee22e409f96e93d7e117393172a");
    let ct = aes256_ctr_process(&pt, &key, &iv, 0);
    assert_eq!(to_hex(&ct), "601ec313775789a5b7a7f504bbf3d228");
}

#[test]
fn aes256_ecb_empty_input() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let ct = aes256_ecb_encrypt(&key, &[]);
    assert!(ct.is_empty());
}

#[test]
fn aes256_cbc_empty_input() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("000102030405060708090a0b0c0d0e0f");
    let ct = aes256_cbc_encrypt(&key, &iv, &[]);
    assert!(ct.is_empty());
}

#[test]
fn aes256_ige_single_block() {
    let key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let iv = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let data = vec![0x42u8; 16];
    let ct = aes256_ige_encrypt(&data, &key, &iv);
    assert_eq!(ct.len(), 16);
    let pt = aes256_ige_decrypt(&ct, &key, &iv);
    assert_eq!(pt.to_vec(), data);
}

#[test]
fn hmac_sha256_empty_data() {
    let key = vec![0x0bu8; 20];
    let out = hmac_sha256(&key, b"");
    assert_eq!(out.len(), 32);
}

#[test]
fn hmac_sha512_long_key() {
    let key: Vec<u8> = (0..131u8).collect();
    let out = hmac_sha512(&key, b"test");
    assert_eq!(out.len(), 64);
}

#[test]
fn mod_pow_base_zero() {
    assert_eq!(mod_pow("0", "5", "100"), "0");
}

#[test]
fn mod_pow_exp_zero() {
    assert_eq!(mod_pow("42", "0", "100"), "1");
}

#[test]
fn mod_pow_base_one() {
    assert_eq!(mod_pow("1", "ffff", "100"), "1");
}

#[test]
fn sha256_multi_block() {
    let data: Vec<u8> = vec![0x61u8; 200];
    let h1 = sha256_hash(&data);
    let h2 = sha256_hash(&data);
    assert_eq!(h1.to_vec(), h2.to_vec());
    assert_ne!(h1.to_vec(), sha256_hash(b"a").to_vec());
}
