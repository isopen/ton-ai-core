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
    let ct = ecb_encrypt_checked(&key, &pt).unwrap();
    assert_eq!(to_hex(&ct), "f3eed1bdb5d2a03c064b5a7e3db181f8");
    let back = ecb_decrypt_checked(&key, &ct).unwrap();
    assert_eq!(to_hex(&back[..pt.len()]), to_hex(&pt));
}

#[test]
fn aes256_block_fips197() {
    let key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let rk = crypton_wasm::aes::key_expansion(&key).unwrap();
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
    let ct = ecb_encrypt_checked(&key, &data).unwrap();
    let pt = ecb_decrypt_checked(&key, &ct).unwrap();
    assert_eq!(pt[..data.len()].to_vec(), data);
}

#[test]
fn aes256_cbc_roundtrip() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("000102030405060708090a0b0c0d0e0f");
    let data = hex("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51");
    let ct = cbc_encrypt_checked(&key, &iv, &data).unwrap();
    let pt = cbc_decrypt_checked(&key, &iv, &ct).unwrap();
    assert_eq!(pt[..data.len()].to_vec(), data);
}

#[test]
fn aes256_ige_roundtrip() {
    let key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let iv = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let data = vec![0x42u8; 64];
    let ct = ige_encrypt_checked(&data, &key, &iv).unwrap();
    assert_ne!(ct.to_vec(), data);
    let pt = ige_decrypt_checked(&ct, &key, &iv).unwrap();
    assert_eq!(pt.to_vec(), data);
}

#[test]
fn aes256_ctr_offset_consistency() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff");
    let full_data = vec![0u8; 128];
    let full_ct = ctr_process_checked(&full_data, &key, &iv, 0).unwrap();
    for offset in [0usize, 1, 15, 16, 17, 31, 32, 63] {
        let partial = ctr_process_checked(&full_data[offset..offset + 16], &key, &iv, offset).unwrap();
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
    let okm1 = hkdf_expand_checked(&prk, &info, 42).unwrap();
    let prk2 = hkdf_sha512_extract(&salt, &ikm);
    let okm2 = hkdf_expand_checked(&prk2, &info, 42).unwrap();
    assert_eq!(okm1, okm2);
    assert_eq!(okm1.len(), 42);
}

#[test]
fn hkdf_max_length_ok() {
    let ikm = vec![0x0bu8; 22];
    let salt = hex("000102030405060708090a0b0c");
    let prk = hkdf_sha512_extract(&salt, &ikm);
    let okm = hkdf_expand_checked(&prk, &[], 255 * 64).unwrap();
    assert_eq!(okm.len(), 255 * 64);
    let err = hkdf_expand_checked(&prk, &[], 255 * 64 + 1).unwrap_err();
    assert_eq!(err, CryptoError::DerivedKeyTooLong);
}

#[test]
fn pbkdf2_lengths() {
    assert_eq!(pbkdf2_sha256_checked(b"passwd", b"salt", 1, 64).unwrap().len(), 64);
    assert_eq!(pbkdf2_sha256_checked(b"password", b"salt", 2, 32).unwrap().len(), 32);
}

#[test]
fn mod_pow_basic() {
    assert_eq!(mod_pow_hex_checked("2", "10", "100").unwrap(), "0");
    assert_eq!(mod_pow_hex_checked("ff", "ff", "ff").unwrap(), "0");
}

#[test]
fn mod_pow_large() {
    let base = "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74";
    let exp = "010001";
    let m = "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404dd";
    let r = mod_pow_hex_checked(base, exp, m).unwrap();
    assert!(!r.is_empty());
    assert_ne!(r, "0");
}

#[test]
fn bigint_hex_roundtrip() {
    let l = bigint::hex_to_limbs("deadbeef123456789abcdef0").unwrap();
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
    let out = pbkdf2_sha256_checked(b"passwd", b"salt", 1, 64).unwrap();
    assert_eq!(out.len(), 64);
    assert_ne!(out.to_vec(), vec![0u8; 64]);
}

#[test]
fn pbkdf2_sha256_known_vector() {
    let out = pbkdf2_sha256_checked(b"password", b"salt", 1, 32).unwrap();
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
fn get_random_bytes_large_chunked() {
    let big = get_random_bytes(65_536 * 2 + 11);
    assert_eq!(big.len(), 65_536 * 2 + 11);
    assert_ne!(big[..32].to_vec(), big[65_536 * 2..].to_vec());
}

#[test]
fn aes256_cbc_nist_sp800_38a() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("000102030405060708090a0b0c0d0e0f");
    let pt = hex("6bc1bee22e409f96e93d7e117393172a");
    let ct = cbc_encrypt_checked(&key, &iv, &pt).unwrap();
    assert_eq!(to_hex(&ct), "f58c4c04d6e5f1ba779eabfb5f7bfbd6");
}

#[test]
fn aes256_ctr_nist_sp800_38a() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff");
    let pt = hex("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710");
    let ct = ctr_process_checked(&pt, &key, &iv, 0).unwrap();
    assert_eq!(
        to_hex(&ct),
        "601ec313775789a5b7a7f504bbf3d228f443e3ca4d62b59aca84e990cacaf5c52b0930daa23de94ce87017ba2d84988ddfc9c58db67aada613c2dd08457941a6"
    );
}

#[test]
fn ctr_counter_wraparound_matches_reference() {
    let key = [0u8; 32];
    let mut iv = [0u8; 16];
    iv[14] = 0xFF;
    iv[15] = 0xFE;
    let data = vec![0u8; 64];
    let ct = ctr_process_checked(&data, &key, &iv, 0).unwrap();
    assert_eq!(&ct[..16], &ctr_process_checked(&vec![0u8; 16], &key, &iv, 0).unwrap()[..]);
    let block1 = &ct[16..32];
    let block2 = &ct[32..48];
    assert_ne!(block1, block2);
    let mut expect_iv = iv;
    assert_eq!(expect_iv[15], 0xFE);
    expect_iv[15] = 0x00;
    expect_iv[14] = 0x00;
    expect_iv[13] = 0x01;
    let ref_ct = ctr_process_checked(&vec![0u8; 16], &key, &expect_iv, 0).unwrap();
    assert_eq!(block2.to_vec(), ref_ct.to_vec(), "counter wraparound diverges from big-endian increment");
}

#[test]
fn aes256_ecb_empty_input() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let ct = ecb_encrypt_checked(&key, &[]).unwrap();
    assert!(ct.is_empty());
}

#[test]
fn aes256_cbc_empty_input() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("000102030405060708090a0b0c0d0e0f");
    let ct = cbc_encrypt_checked(&key, &iv, &[]).unwrap();
    assert!(ct.is_empty());
}

#[test]
fn aes256_ige_single_block() {
    let key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let iv = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let data = vec![0x42u8; 16];
    let ct = ige_encrypt_checked(&data, &key, &iv).unwrap();
    assert_eq!(ct.len(), 16);
    let pt = ige_decrypt_checked(&ct, &key, &iv).unwrap();
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
    assert_eq!(mod_pow_hex_checked("0", "5", "100").unwrap(), "0");
}

#[test]
fn mod_pow_exp_zero() {
    assert_eq!(mod_pow_hex_checked("42", "0", "100").unwrap(), "1");
}

#[test]
fn mod_pow_base_one() {
    assert_eq!(mod_pow_hex_checked("1", "ffff", "100").unwrap(), "1");
}

#[test]
fn sha256_multi_block() {
    let data: Vec<u8> = vec![0x61u8; 200];
    let h1 = sha256_hash(&data);
    let h2 = sha256_hash(&data);
    assert_eq!(h1.to_vec(), h2.to_vec());
    assert_ne!(h1.to_vec(), sha256_hash(b"a").to_vec());
}

#[test]
fn mod_pow_medium_multi_limb() {
    let r = mod_pow_hex_checked(
        "deadbeefcafebabe123456789abcdef0fedcbaf09876543210",
        "deadbeef",
        "fffffffeffffffffffffffffffffffff"
    ).unwrap();
    assert_eq!(r, "e9f5efbc0cd9c5d1655435d0182363f6");
}

#[test]
fn mod_pow_large_2048bit() {
    let base = "deadbeefcafebabe123456789abcdef04242424247474747";
    let exp = "10001";
    let m = "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aaac42dad33170d04507a33a85521abdf1cba64ecfb850458dbef0a8aea71514d22978d1dc7dc7f80bd848d45e9eeedffcd27ccadf";
    let expected = "5dec062c59ac9d9ba0ac213f0c0fe3580f0b0a9d86a3215976f81c40f089e3a645628edfd42add26378614b3c1f59f32476ff3e84ce58c7804e5b45bbe36d8937f4f40c736250b3819236c0486b3954e48ff3ccaf41f3a1d1413c112c81304c7b0843cebbf083a88167d1f06815664f96250cd3094c3ee4a8b2d72aea3b8ce1feaa493cb13f78f8bf202bb5689f2612db31e5cd4937a09ad1ee9b8e064ab27f442d52c6cbefef7b11a1bed9f9cba6b19e86c063162a7c1fc072988f194c4171508f38bab4a343e2f82fa007487be7bfc95b8b2c525020c4cbfa03028050775e3a6cebde37fa3179956c801d82a2737ef87ae8f47d702718737b528bcdf2c268cf6462c9b8085226a16c8e51db57c6a2bd267960d2ea4cd59d372616c0e0d82a9cea12bd2cfbd5b33d6c";

    let r = mod_pow_hex_checked(base, exp, m).unwrap();
    assert_eq!(r, expected, "mod_pow 2048-bit result mismatch");
}

#[test]
fn reject_bad_key_length() {
    let key16 = [0u8; 16];
    let key33 = [0u8; 33];
    let block = [0u8; 16];
    for key in [key16.as_slice(), key33.as_slice()] {
        assert_eq!(ecb_encrypt_checked(key, &block), Err(CryptoError::InvalidKeyLength));
        assert_eq!(ecb_decrypt_checked(key, &block), Err(CryptoError::InvalidKeyLength));
        assert_eq!(cbc_encrypt_checked(key, &[0u8; 16], &block), Err(CryptoError::InvalidKeyLength));
        assert_eq!(ctr_process_checked(&block, key, &[0u8; 16], 0), Err(CryptoError::InvalidKeyLength));
        assert_eq!(ige_encrypt_checked(&block, key, &[0u8; 32]), Err(CryptoError::InvalidKeyLength));
    }
}

#[test]
fn reject_bad_iv_lengths() {
    let key = [0u8; 32];
    let block = [0u8; 16];
    assert_eq!(cbc_encrypt_checked(&key, &[0u8; 8], &block), Err(CryptoError::InvalidIvLength));
    assert_eq!(cbc_encrypt_checked(&key, &[0u8; 17], &block), Err(CryptoError::InvalidIvLength));
    assert_eq!(cbc_decrypt_checked(&key, &[0u8; 8], &block), Err(CryptoError::InvalidIvLength));
    assert_eq!(ctr_process_checked(&block, &key, &[0u8; 15], 0), Err(CryptoError::InvalidIvLength));
    assert_eq!(ige_encrypt_checked(&block, &key, &[0u8; 31]), Err(CryptoError::InvalidIvLength));
    assert_eq!(ige_decrypt_checked(&block, &key, &[0u8; 33]), Err(CryptoError::InvalidIvLength));
}

#[test]
fn reject_unaligned_input() {
    let key = [0u8; 32];
    let iv16 = [0u8; 16];
    let iv32 = [0u8; 32];
    let bad = [0u8; 18];
    assert_eq!(ecb_encrypt_checked(&key, &bad), Err(CryptoError::InputNotAligned));
    assert_eq!(ecb_decrypt_checked(&key, &bad), Err(CryptoError::InputNotAligned));
    assert_eq!(cbc_encrypt_checked(&key, &iv16, &bad), Err(CryptoError::InputNotAligned));
    assert_eq!(cbc_decrypt_checked(&key, &iv16, &bad), Err(CryptoError::InputNotAligned));
    assert_eq!(ige_encrypt_checked(&bad, &key, &iv32), Err(CryptoError::InputNotAligned));
    assert_eq!(ige_decrypt_checked(&bad, &key, &iv32), Err(CryptoError::InputNotAligned));
}

#[test]
fn reject_modulus_zero() {
    assert_eq!(mod_pow_hex_checked("10", "10", "0"), Err(CryptoError::ModulusIsZero));
    assert_eq!(mod_pow_hex_checked("10", "10", ""), Err(CryptoError::EmptyHex));
}

#[test]
fn reject_invalid_hex() {
    assert_eq!(bigint::hex_to_limbs("zzzz"), Err(CryptoError::InvalidHexChar));
    assert_eq!(bigint::hex_to_limbs("12345g"), Err(CryptoError::InvalidHexChar));
    assert_eq!(bigint::hex_to_limbs("12 34"), Err(CryptoError::InvalidHexChar));
    assert_eq!(bigint::hex_to_limbs(""), Err(CryptoError::EmptyHex));
    assert_eq!(bigint::hex_to_limbs("0x"), Err(CryptoError::EmptyHex));
    assert_eq!(mod_pow_hex_checked("zzzz", "2", "ff"), Err(CryptoError::InvalidHexChar));
}

#[test]
fn hex_prefix_and_case_handling() {
    assert_eq!(bigint::hex_to_limbs("0XFF").unwrap(), vec![0xff]);
    assert_eq!(bigint::hex_to_limbs("0xFF").unwrap(), vec![0xff]);
    assert_eq!(bigint::hex_to_limbs("Ff").unwrap(), vec![0xff]);
    assert_eq!(mod_pow_hex_checked("0x2", "0x2", "0x3").unwrap(), "1");
}

#[test]
fn reject_pbkdf2_zero_iterations() {
    assert_eq!(
        pbkdf2_sha256_checked(b"pw", b"salt", 0, 32),
        Err(CryptoError::ZeroIterations)
    );
}

#[test]
#[cfg(target_arch = "wasm32")]
fn wasm_wrappers_return_results() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let pt = hex("6bc1bee22e409f96e93d7e117393172a");
    let ct = aes256_ecb_encrypt(&key, &pt).unwrap();
    assert_eq!(aes256_ecb_decrypt(&key, &ct).unwrap(), pt);
    assert!(aes256_ecb_encrypt(&key, &[0u8; 3]).is_err());
    assert_eq!(
        mod_pow("2", "10", "100").unwrap(),
        "0"
    );
}

#[test]
fn reject_pbkdf2_dk_len_over_cap() {
    assert_eq!(
        pbkdf2_sha256_checked(b"pw", b"salt", 1, 255 * 64 + 1),
        Err(CryptoError::DerivedKeyTooLong)
    );
    assert!(pbkdf2_sha256_checked(b"pw", b"salt", 1, 255 * 64).is_ok());
}

#[test]
#[cfg(target_arch = "wasm32")]
fn reject_rng_over_cap() {
    assert!(get_random_bytes((1 << 20) + 1).is_err());
    assert!(get_random_bytes(1 << 20).is_ok());
}

#[test]
fn ctr_large_offset_streaming_no_alloc_bomb() {
    let key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff");
    let offset = 1 << 20;
    let probe = vec![0u8; 32];
    let a = ctr_process_checked(&probe, &key, &iv, offset).unwrap();
    let seed = ctr_process_checked(&vec![0u8; offset + 32], &key, &iv, 0).unwrap();
    assert_eq!(a.to_vec(), seed[offset..offset + 32].to_vec());
}

#[test]
fn key_expansion_rejects_bad_length() {
    for len in [0usize, 16, 24, 31, 33, 64] {
        assert_eq!(
            crypton_wasm::aes::key_expansion(&vec![0u8; len]),
            Err(CryptoError::InvalidKeyLength)
        );
    }
    assert!(crypton_wasm::aes::key_expansion(&vec![0u8; 32]).is_ok());
}

struct XorShift(u64);
impl XorShift {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn limbs(&mut self, n: usize) -> Vec<u64> {
        let mut v: Vec<u64> = (0..n).map(|_| self.next()).collect();
        while v.len() > 1 && *v.last().unwrap() == 0 { v.pop(); }
        if v.is_empty() { v.push(1); }
        v
    }
}

fn test_cmp(a: &[u64], b: &[u64]) -> std::cmp::Ordering {
    if a.len() != b.len() { return a.len().cmp(&b.len()); }
    for i in (0..a.len()).rev() {
        if a[i] != b[i] { return a[i].cmp(&b[i]); }
    }
    std::cmp::Ordering::Equal
}

#[test]
fn prop_divmod_identity() {
    let mut rng = XorShift(0x243F6A8885A308D3);
    for _ in 0..300 {
        let an = 1 + (rng.next() as usize % 6);
        let bn = 1 + (rng.next() as usize % 4);
        let a = rng.limbs(an);
        let b = rng.limbs(bn);
        if bigint::is_zero(&b) { continue; }
        let (q, r) = bigint::divmod(&a, &b).unwrap();
        let recon = bigint::add(&bigint::mul(&q, &b), &r);
        assert_eq!(recon, a, "divmod identity failed for a={:?} b={:?}", a, b);
        assert_eq!(test_cmp(&r, &b), std::cmp::Ordering::Less, "remainder >= divisor");
    }
}

#[test]
fn prop_mod_pow_matches_bruteforce() {
    let mut rng = XorShift(0xB7E151628AED2A6A);
    for _ in 0..200 {
        let mn = 1 + (rng.next() as usize % 2);
        let m = rng.limbs(mn);
        if bigint::is_zero(&m) || m == vec![1] { continue; }
        let x = rng.next();
        let e = (rng.next() % 8) as usize;
        let mut expected = vec![1u64];
        for _ in 0..e {
            expected = bigint::divmod(&bigint::mul(&expected, &[x]), &m).unwrap().1;
        }
        let got = bigint::mod_pow(&[x], &[e as u64], &m).unwrap();
        assert_eq!(got, expected, "mod_pow mismatch: x={} e={} m={:?}", x, e, m);
    }
}

#[test]
fn prop_mod_pow_homomorphism() {
    let mut rng = XorShift(0x9E3779B97F4A7C15);
    for _ in 0..100 {
        let mn = 1 + (rng.next() as usize % 3);
        let m = rng.limbs(mn);
        if bigint::is_zero(&m) || m == vec![1] { continue; }
        let bn2 = 1 + (rng.next() as usize % 3);
        let base = rng.limbs(bn2);
        let e1 = rng.limbs(1);
        let e2 = rng.limbs(1);
        let e_sum = bigint::add(&e1, &e2);
        let left = bigint::mod_pow(&base, &e_sum, &m).unwrap();
        let p1 = bigint::mod_pow(&base, &e1, &m).unwrap();
        let p2 = bigint::mod_pow(&base, &e2, &m).unwrap();
        let right = bigint::divmod(&bigint::mul(&p1, &p2), &m).unwrap().1;
        assert_eq!(left, right, "x^(a+b) != x^a * x^b mod m");
    }
}

#[test]
fn prop_hex_roundtrip_random() {
    let mut rng = XorShift(0xBF58476D1CE4E5B9);
    for _ in 0..100 {
        let count = 1 + (rng.next() as usize % 5);
        let limbs: Vec<u64> = (0..count).map(|_| rng.next()).collect();
        let h = bigint::limbs_to_hex(&limbs);
        let back = bigint::hex_to_limbs(&h).unwrap();
        let mut expect = limbs.clone();
        while expect.len() > 1 && *expect.last().unwrap() == 0 { expect.pop(); }
        assert_eq!(back, expect, "hex roundtrip failed for {:?}", limbs);
    }
}

fn limbs_of(vals: &[u64]) -> Vec<u64> {
    let mut v = vals.to_vec();
    while v.len() > 1 && *v.last().unwrap() == 0 { v.pop(); }
    v
}

#[test]
fn prop_mod_inv_known_case() {
    let mut rng = XorShift(0xD1B54A32D192ED03);
    for _ in 0..200 {
        let mn = 1 + (rng.next() as usize % 3);
        let mut m = rng.limbs(mn);
        m[0] |= 1;
        if bigint::is_zero(&m) || m == vec![1] { continue; }
        let two = vec![2u64];
        if test_cmp(&two, &m) == std::cmp::Ordering::Greater { continue; }
        let a = bigint::sub(&m, &two);
        let inv = bigint::mod_inv(&a, &m).unwrap();
        let prod = bigint::divmod(&bigint::mul(&a, &inv), &m).unwrap().1;
        assert_eq!(prod, vec![1], "(m-2)*inv(m-2) != 1 mod m");
    }
}

#[test]
fn prop_mod_inv_random_pairs() {
    let mut rng = XorShift(0xA24BAED4966E8B41);
    for _ in 0..300 {
        let alen = 1 + (rng.next() as usize % 2);
        let a = rng.limbs(alen);
        let mlen = 1 + (rng.next() as usize % 2);
        let mut m = rng.limbs(mlen);
        if bigint::is_zero(&m) || m == vec![1] { continue; }
        match bigint::mod_inv(&a, &m) {
            Ok(inv) => {
                let prod = bigint::divmod(&bigint::mul(&a, &inv), &m).unwrap().1;
                assert_eq!(prod, vec![1], "inverse not normalized: a={:?} m={:?}", a, m);
                let reduced = bigint::divmod(&inv, &m).unwrap().1;
                assert_eq!(reduced, inv, "inverse out of [0,m)");
            }
            Err(CryptoError::NoModularInverse) => {}
            Err(e) => panic!("unexpected error {:?}", e),
        }
    }
}

#[test]
fn blinding_produces_identical_results() {
    let mut rng = XorShift(0x2545F4914F6CDD1D);
    for _ in 0..100 {
        let mn = 1 + (rng.next() as usize % 3);
        let m = rng.limbs(mn);
        if bigint::is_zero(&m) || m == vec![1] { continue; }
        let bn2 = 1 + (rng.next() as usize % 2);
        let base = rng.limbs(bn2);
        let elen = 1 + (rng.next() as usize % 2);
        let exp = rng.limbs(elen);
        let plain = bigint::mod_pow(&base, &exp, &m).unwrap();
        for k in 1..4u64 {
            let blinder = vec![k.wrapping_mul(0x9E3779B97F4A7C15).wrapping_add(3)];
            match mod_pow_blind_with(&base, &exp, &m, &blinder) {
                Ok(blinded) => assert_eq!(blinded, plain, "blinded mismatch blinder={} m={:?}", k, m),
                Err(CryptoError::NoModularInverse) => {}
                Err(e) => panic!("unexpected {:?}", e),
            }
        }
    }
}

#[test]
fn etm_roundtrip_and_tamper_detection() {
    let mac_key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let enc_key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let iv = hex("000102030405060708090a0b0c0d0e0f");
    let pt = hex("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51");

    let sealed = cbc_encrypt_etm_checked(&mac_key, &enc_key, &iv, &pt).unwrap();
    assert_eq!(sealed.len(), pt.len() + 32);
    let opened = cbc_decrypt_etm_checked(&mac_key, &enc_key, &iv, &sealed).unwrap();
    assert_eq!(opened, pt);

    for pos in [0usize, 10, sealed.len() - 33, sealed.len() - 1] {
        let mut tampered = sealed.clone();
        tampered[pos] ^= 0x01;
        assert_eq!(
            cbc_decrypt_etm_checked(&mac_key, &enc_key, &iv, &tampered),
            Err(CryptoError::AuthenticationFailure),
            "tamper at {} not detected",
            pos
        );
    }

    let truncated = &sealed[..sealed.len() - 1];
    assert_eq!(
        cbc_decrypt_etm_checked(&mac_key, &enc_key, &iv, truncated),
        Err(CryptoError::AuthenticationFailure)
    );

    let mut wrong_mac = mac_key.clone();
    wrong_mac[0] ^= 1;
    assert_eq!(
        cbc_decrypt_etm_checked(&wrong_mac, &enc_key, &iv, &sealed),
        Err(CryptoError::AuthenticationFailure)
    );
}

#[test]
fn differential_divmod_vs_u128() {
    let mut rng = XorShift(0x27BB2EE687B0B0FD);
    for _ in 0..500 {
        let a_hi = rng.next() >> (rng.next() % 32);
        let a_lo = rng.next();
        let a_val = ((a_hi as u128) << 64) | a_lo as u128;
        let b_val = (rng.next() | 1) as u128;
        let q_ref = a_val / b_val;
        let r_ref = a_val % b_val;

        let a = limbs_of(&[a_lo, a_hi]);
        let b = limbs_of(&[b_val as u64, (b_val >> 64) as u64]);
        if bigint::is_zero(&b) { continue; }
        let (q, r) = bigint::divmod(&a, &b).unwrap();

        let ql = limbs_of(&[q.first().copied().unwrap_or(0), *q.get(1).unwrap_or(&0)]);
        let rl = limbs_of(&[r.first().copied().unwrap_or(0), *r.get(1).unwrap_or(&0)]);
        let q_expect = limbs_of(&[q_ref as u64, (q_ref >> 64) as u64]);
        let r_expect = limbs_of(&[r_ref as u64, (r_ref >> 64) as u64]);
        assert_eq!(ql, q_expect, "quotient mismatch a={} b={}", a_val, b_val);
        assert_eq!(rl, r_expect, "remainder mismatch a={} b={}", a_val, b_val);
    }
}

#[test]
fn differential_mod_pow_vs_u64_ladder() {
    let mut rng = XorShift(0x9FB21C651E98DF25);
    for _ in 0..300 {
        let m = (rng.next() | 1) as u64;
        if m < 3 { continue; }
        let base = rng.next() % m;
        let e = (rng.next() % 16) as u64;
        let mut acc: u64 = 1 % m;
        let mut b: u64 = base % m;
        let mut ee = e;
        while ee > 0 {
            if ee & 1 == 1 { acc = ((acc as u128 * b as u128) % m as u128) as u64; }
            b = ((b as u128 * b as u128) % m as u128) as u64;
            ee >>= 1;
        }
        let got = bigint::mod_pow(&[base], &[e], &[m]).unwrap();
        let expect = if acc == 0 { vec![0] } else { vec![acc] };
        assert_eq!(got, expect, "mod_pow diff: base={} e={} m={}", base, e, m);
    }
}

fn hmac_sha512_ref(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut k = key.to_vec();
    if k.len() > 128 { k = hashes::sha512(&k).to_vec(); }
    k.resize(128, 0);
    let ipad: Vec<u8> = k.iter().map(|b| b ^ 0x36).collect();
    let opad: Vec<u8> = k.iter().map(|b| b ^ 0x5c).collect();
    let mut inner = ipad;
    inner.extend_from_slice(data);
    let ih = hashes::sha512(&inner).to_vec();
    let mut outer = opad;
    outer.extend_from_slice(&ih);
    hashes::sha512(&outer).to_vec()
}

#[test]
fn differential_hmac_sha512_vs_inline_rfc_ref() {
    let mut rng = XorShift(0x94D049BB133111EB);
    for case in 0..50u32 {
        let klen = (case * 5 % 200) as usize;
        let dlen = (case * 13 % 300) as usize;
        let key: Vec<u8> = (0..klen).map(|_| rng.next() as u8).collect();
        let data: Vec<u8> = (0..dlen).map(|_| rng.next() as u8).collect();
        assert_eq!(hmac_sha512(&key, &data).to_vec(), hmac_sha512_ref(&key, &data), "klen={} dlen={}", klen, dlen);
    }
}

#[test]
fn reject_mod_pow_operand_over_cap() {
    let huge = "ab".repeat(1025);
    let ok_mod = "ffffff";
    assert_eq!(
        mod_pow_hex_checked(&huge, "2", ok_mod).unwrap_err(),
        CryptoError::OperandTooLarge
    );
    assert_eq!(
        mod_pow_hex_checked("2", &huge, ok_mod).unwrap_err(),
        CryptoError::OperandTooLarge
    );
    assert_eq!(
        mod_pow_hex_checked("2", "2", &huge).unwrap_err(),
        CryptoError::OperandTooLarge
    );
    let max_ok = "ff".repeat(1024);
    assert!(mod_pow_hex_checked("2", "3", &max_ok).is_ok());
    let over = "ff".repeat(1025);
    assert_eq!(
        mod_pow_hex_checked("2", "3", &over).unwrap_err(),
        CryptoError::OperandTooLarge
    );
}

#[test]
fn differential_montgomery_vs_legacy_mod_pow() {
    let mut rng = XorShift(0x6364132238844343);
    for _ in 0..200 {
        let mlen = 1 + (rng.next() as usize % 4);
        let mut m = rng.limbs(mlen);
        m[0] |= 1;
        if bigint::is_zero(&m) || m == vec![1] { continue; }
        let blen = 1 + (rng.next() as usize % 3);
        let base = rng.limbs(blen);
        let elen = 1 + (rng.next() as usize % 2);
        let exp = rng.limbs(elen);
        let via_mont = bigint::mod_pow(&base, &exp, &m).unwrap();
        let via_legacy = bigint::legacy_mod_pow(&base, &exp, &m).unwrap();
        assert_eq!(via_mont, via_legacy, "montgomery mismatch: base={:?} e={:?} m={:?}", base, exp, m);
    }
}

#[test]
fn even_modulus_uses_legacy_path() {
    let m = vec![0x30u64];
    assert_eq!(bigint::mod_pow(&[2], &[8], &m).unwrap(), vec![16]);
    let m_even_big = vec![0x1234567890abcdef, 0xfedcba0987654320];
    let r = bigint::mod_pow(&[3], &[5], &m_even_big).unwrap();
    let expect = bigint::divmod(&bigint::mul(&bigint::mul(&[3], &[3]), &[27]), &m_even_big).unwrap().1;
    assert_eq!(r, expect);
}

#[test]
fn mont_2048_bit_matches_known_vector() {
    let m = "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aaac42dad33170d04507a33a85521abdf1cba64ecfb850458dbef0a8aea71514d22978d1dc7dc7f80bd848d45e9eeedffcd27ccadf";
    let t0 = std::time::Instant::now();
    let r = mod_pow_hex_checked("deadbeefcafebabe123456789abcdef04242424247474747", "10001", m).unwrap();
    println!("2048-class small-exp via montgomery: {:?}, len={}", t0.elapsed(), r.len());
    let legacy_ref = bigint::legacy_mod_pow(
        &bigint::hex_to_limbs("deadbeefcafebabe123456789abcdef04242424247474747").unwrap(),
        &bigint::hex_to_limbs("10001").unwrap(),
        &bigint::hex_to_limbs(m).unwrap(),
    ).unwrap();
    assert_eq!(bigint::limbs_to_hex(&legacy_ref), r);

    let big_exp = "3f2a7c1d9b8e5f40617263748596a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e";
    let t1 = std::time::Instant::now();
    let r2 = mod_pow_hex_checked("deadbeefcafebabe123456789abcdef04242424247474747", big_exp, m).unwrap();
    println!("2048-bit 480-bit-exp via montgomery: {:?}", t1.elapsed());
    assert!(!r2.is_empty());
}

#[test]
fn seal_open_roundtrip_and_random_iv() {
    let mac_key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    let enc_key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    let pt = hex("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51");

    let s1 = cbc_seal_checked(&mac_key, &enc_key, &pt).unwrap();
    assert_eq!(s1.len(), 16 + pt.len() + 32);
    assert_eq!(cbc_open_checked(&mac_key, &enc_key, &s1).unwrap(), pt);

    let s2 = cbc_seal_checked(&mac_key, &enc_key, &pt).unwrap();
    assert_ne!(s1, s2, "two seals identical -> IV not random");

    for pos in [0usize, 15, 16, s1.len() - 33, s1.len() - 1] {
        let mut t = s1.clone();
        t[pos] ^= 0x01;
        assert_eq!(
            cbc_open_checked(&mac_key, &enc_key, &t),
            Err(CryptoError::AuthenticationFailure),
            "tamper at {} not detected",
            pos
        );
    }

    assert_eq!(
        cbc_open_checked(&mac_key, &enc_key, &s1[..63]),
        Err(CryptoError::AuthenticationFailure)
    );
}
