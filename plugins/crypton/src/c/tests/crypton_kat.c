#include "../src/crypton.h"
#ifndef __wasm__
#include <stdio.h>
#include <string.h>
#else
int strcmp(const char *, const char *);
int strncmp(const char *, const char *, size_t);
size_t strlen(const char *);
int memcmp(const void *, const void *, size_t);
const char *strchr(const char *, int);
#endif

static int kat_failures;

#ifndef __wasm__
static void kat_fail(const char *name)
{
    kat_failures++;
    fprintf(stderr, "KAT FAIL: %s\n", name);
}
#else
static void kat_fail(const char *name)
{
    (void)name;
    kat_failures++;
}
#endif

static int kat_hexval(uint8_t c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static size_t kat_hex_bytes(const char *s, uint8_t *out)
{
    size_t n = 0;
    while (s[n] != 0 && s[n + 1] != 0) {
        int hi = kat_hexval((uint8_t)s[n]);
        int lo = kat_hexval((uint8_t)s[n + 1]);
        out[n / 2] = (uint8_t)((hi << 4) | lo);
        n += 2;
    }
    return n / 2;
}

static void kat_to_hex(const uint8_t *b, size_t n, char *out)
{
    static const char d[] = "0123456789abcdef";
    for (size_t i = 0; i < n; i++) {
        out[2 * i] = d[b[i] >> 4];
        out[2 * i + 1] = d[b[i] & 0xfu];
    }
    out[2 * n] = 0;
}

static bool kat_buf_hex_eq(const crypton_buf *b, const char *hex)
{
    static char tmp[65538];
    if (b->len * 2 + 1 > sizeof(tmp)) return false;
    kat_to_hex(b->data, b->len, tmp);
    return strcmp(tmp, hex) == 0;
}

static bool kat_buf_str_eq(const crypton_buf *b, const char *s)
{
    size_t n = strlen(s);
    return b->len == n && memcmp(b->data, s, n) == 0;
}

static bool kat_limbs_eq(const crypton_limbs *g, const crypton_limb *w, size_t wn)
{
    if (g->len != wn) return false;
    for (size_t i = 0; i < wn; i++) {
        if (g->v[i] != w[i]) return false;
    }
    return true;
}

static bool kat_limbs_pair_eq(const crypton_limbs *a, const crypton_limbs *b)
{
    if (a->len != b->len) return false;
    for (size_t i = 0; i < a->len; i++) {
        if (a->v[i] != b->v[i]) return false;
    }
    return true;
}

static crypton_status kat_limbs_of(const crypton_limb *vals, size_t n, crypton_limbs *out)
{
    crypton_limbs_init(out);
    crypton_status st = crypton_limbs_resize(out, n, 0);
    if (st != CRYPTON_OK) return st;
    cr_memcpy(out->v, vals, n * sizeof(crypton_limb));
    crypton_limbs_trim(out);
    return CRYPTON_OK;
}

typedef struct {
    uint64_t s;
} kat_rng;

static uint64_t rng_next(kat_rng *r)
{
    uint64_t x = r->s;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    r->s = x;
    return x;
}

static crypton_status kat_rng_limbs(kat_rng *r, size_t n, crypton_limbs *out)
{
    crypton_limbs v;
    crypton_limbs_init(&v);
    crypton_status st = CRYPTON_OK;
    for (size_t i = 0; i < n; i++) {
        st = crypton_limbs_reserve(&v, v.len + 1);
        if (st != CRYPTON_OK) {
            crypton_limbs_free(&v);
            return st;
        }
        v.v[v.len] = rng_next(r);
        v.len++;
    }
    crypton_limbs_trim(&v);
    *out = v;
    return CRYPTON_OK;
}

static crypton_status kat_rng_limbs_masked(kat_rng *r, size_t n, uint64_t density, crypton_limbs *out)
{
    crypton_limbs v;
    crypton_limbs_init(&v);
    crypton_status st = CRYPTON_OK;
    for (size_t i = 0; i < n; i++) {
        st = crypton_limbs_reserve(&v, v.len + 1);
        if (st != CRYPTON_OK) {
            crypton_limbs_free(&v);
            return st;
        }
        v.v[v.len] = rng_next(r) & density;
        v.len++;
    }
    crypton_limbs_trim(&v);
    *out = v;
    return CRYPTON_OK;
}

static void kat_u64_hex(uint64_t v, char *out)
{
    char tmp[16];
    size_t n = 0;
    if (v == 0) {
        out[0] = '0';
        out[1] = 0;
        return;
    }
    while (v) {
        tmp[n++] = "0123456789abcdef"[v & 0xfu];
        v >>= 4;
    }
    for (size_t i = 0; i < n; i++) out[i] = tmp[n - 1 - i];
    out[n] = 0;
}

static const char *K1 = "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4";
static const char *PT1 = "6bc1bee22e409f96e93d7e117393172a";
static const char *CT1 = "f3eed1bdb5d2a03c064b5a7e3db181f8";
static const char *K2 = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
static const char *BLK = "00112233445566778899aabbccddeeff";
static const char *BLK_CT = "8ea2b7ca516745bfeafc49904b496089";
static const char *CBC_IV = "000102030405060708090a0b0c0d0e0f";
static const char *CBC_PT2 = "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51";
static const char *CBC_CT1 = "f58c4c04d6e5f1ba779eabfb5f7bfbd6";
static const char *CTR_IV = "f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff";
static const char *CTR_PT64 = "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710";
static const char *CTR_CT64 = "601ec313775789a5b7a7f504bbf3d228f443e3ca4d62b59aca84e990cacaf5c52b0930daa23de94ce87017ba2d84988ddfc9c58db67aada613c2dd08457941a6";

static void test_aes256_ecb_nist_vector(void)
{
    uint8_t key[32], pt[16];
    kat_hex_bytes(K1, key);
    kat_hex_bytes(PT1, pt);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_ecb_encrypt(key, 32, pt, 16, &ct);
    if (st != CRYPTON_OK || !kat_buf_hex_eq(&ct, CT1)) kat_fail("aes256_ecb_nist_vector/encrypt");
    crypton_buf back;
    crypton_buf_init(&back);
    st = crypton_ecb_decrypt(key, 32, ct.data, ct.len, &back);
    if (st != CRYPTON_OK || !kat_buf_hex_eq(&back, PT1)) kat_fail("aes256_ecb_nist_vector/decrypt");
    crypton_buf_free(&back);
    crypton_buf_free(&ct);
}

static void test_aes256_block_fips197(void)
{
    uint8_t key[32], block[16];
    kat_hex_bytes(K2, key);
    kat_hex_bytes(BLK, block);
    uint8_t rk[15][16];
    crypton_status st = crypton_aes_key_expansion(key, 32, rk);
    if (st != CRYPTON_OK) {
        kat_fail("aes256_block_fips197/key_expansion");
        return;
    }
    crypton_aes256_encrypt_block(rk, block);
    char h[33];
    kat_to_hex(block, 16, h);
    if (strcmp(h, BLK_CT) != 0) kat_fail("aes256_block_fips197/encrypt");
    crypton_aes256_decrypt_block(rk, block);
    kat_to_hex(block, 16, h);
    if (strcmp(h, BLK) != 0) kat_fail("aes256_block_fips197/decrypt");
    crypton_wipe(rk, 240);
}

static void test_aes256_ecb_roundtrip_large(void)
{
    uint8_t key[32];
    kat_hex_bytes(K2, key);
    uint8_t data[4096];
    for (size_t i = 0; i < 4096; i++) data[i] = (uint8_t)(i % 256);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_ecb_encrypt(key, 32, data, 4096, &ct);
    if (st != CRYPTON_OK) {
        kat_fail("aes256_ecb_roundtrip_large/encrypt");
        crypton_buf_free(&ct);
        return;
    }
    crypton_buf pt;
    crypton_buf_init(&pt);
    st = crypton_ecb_decrypt(key, 32, ct.data, ct.len, &pt);
    if (st != CRYPTON_OK || pt.len != 4096 || memcmp(pt.data, data, 4096) != 0) kat_fail("aes256_ecb_roundtrip_large/roundtrip");
    crypton_buf_free(&pt);
    crypton_buf_free(&ct);
}

static void test_aes256_cbc_roundtrip(void)
{
    uint8_t key[32], iv[16], data[32];
    kat_hex_bytes(K1, key);
    kat_hex_bytes(CBC_IV, iv);
    kat_hex_bytes(CBC_PT2, data);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_cbc_encrypt(key, 32, iv, 16, data, 32, &ct);
    if (st != CRYPTON_OK) {
        kat_fail("aes256_cbc_roundtrip/encrypt");
        return;
    }
    crypton_buf pt;
    crypton_buf_init(&pt);
    st = crypton_cbc_decrypt(key, 32, iv, 16, ct.data, ct.len, &pt);
    if (st != CRYPTON_OK || pt.len != 32 || memcmp(pt.data, data, 32) != 0) kat_fail("aes256_cbc_roundtrip/roundtrip");
    crypton_buf_free(&pt);
    crypton_buf_free(&ct);
}

static void test_aes256_ige_roundtrip(void)
{
    uint8_t key[32], iv[32], data[64];
    kat_hex_bytes(K2, key);
    kat_hex_bytes(K2, iv);
    cr_memset(data, 0x42, 64);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_ige_encrypt(data, 64, key, 32, iv, 32, &ct);
    if (st != CRYPTON_OK) {
        kat_fail("aes256_ige_roundtrip/encrypt");
        return;
    }
    bool differs = false;
    for (size_t i = 0; i < 64; i++) {
        if (data[i] != ct.data[i]) differs = true;
    }
    if (!differs) kat_fail("aes256_ige_roundtrip/ct_eq_pt");
    crypton_buf pt;
    crypton_buf_init(&pt);
    st = crypton_ige_decrypt(ct.data, ct.len, key, 32, iv, 32, &pt);
    if (st != CRYPTON_OK || pt.len != 64 || memcmp(pt.data, data, 64) != 0) kat_fail("aes256_ige_roundtrip/roundtrip");
    crypton_buf_free(&pt);
    crypton_buf_free(&ct);
}

static void test_aes256_ctr_offset_consistency(void)
{
    uint8_t key[32], iv[16];
    kat_hex_bytes(K1, key);
    kat_hex_bytes(CTR_IV, iv);
    uint8_t full_data[128];
    cr_memset(full_data, 0, 128);
    crypton_buf full_ct;
    crypton_buf_init(&full_ct);
    crypton_status st = crypton_ctr_process(full_data, 128, key, 32, iv, 16, 0, &full_ct);
    if (st != CRYPTON_OK) {
        kat_fail("aes256_ctr_offset_consistency/full");
        crypton_buf_free(&full_ct);
        return;
    }
    static const size_t offs[8] = {0, 1, 15, 16, 17, 31, 32, 63};
    for (size_t oi = 0; oi < 8; oi++) {
        size_t off = offs[oi];
        crypton_buf part;
        crypton_buf_init(&part);
        crypton_status pst = crypton_ctr_process(full_data + off, 16, key, 32, iv, 16, (uint64_t)off, &part);
        if (pst != CRYPTON_OK || part.len != 16 || memcmp(part.data, full_ct.data + off, 16) != 0) {
            kat_fail("aes256_ctr_offset_consistency/partial");
        }
        crypton_buf_free(&part);
    }
    crypton_buf_free(&full_ct);
}

static void test_sha1_rfc3174(void)
{
    uint8_t out[20];
    char h[41];
    crypton_sha1((const uint8_t *)"abc", 3, out);
    kat_to_hex(out, 20, h);
    if (strcmp(h, "a9993e364706816aba3e25717850c26c9cd0d89d") != 0) kat_fail("sha1_rfc3174/abc");
    crypton_sha1((const uint8_t *)"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", 56, out);
    kat_to_hex(out, 20, h);
    if (strcmp(h, "84983e441c3bd26ebaae4aa1f95129e5e54670f1") != 0) kat_fail("sha1_rfc3174/long");
}

static void test_sha1_empty(void)
{
    uint8_t out[20];
    char h[41];
    crypton_sha1((const uint8_t *)"", 0, out);
    kat_to_hex(out, 20, h);
    if (strcmp(h, "da39a3ee5e6b4b0d3255bfef95601890afd80709") != 0) kat_fail("sha1_empty");
}

static void test_sha256_fips180(void)
{
    uint8_t out[32];
    char h[65];
    crypton_sha256((const uint8_t *)"abc", 3, out);
    kat_to_hex(out, 32, h);
    if (strcmp(h, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") != 0) kat_fail("sha256_fips180");
}

static void test_sha256_empty(void)
{
    uint8_t out[32];
    char h[65];
    crypton_sha256((const uint8_t *)"", 0, out);
    kat_to_hex(out, 32, h);
    if (strcmp(h, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") != 0) kat_fail("sha256_empty");
}

static void test_sha512_known_vector_abc(void)
{
    uint8_t out[64];
    char h[129];
    crypton_sha512((const uint8_t *)"abc", 3, out);
    kat_to_hex(out, 64, h);
    if (strcmp(h, "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f") != 0) kat_fail("sha512_known_vector_abc");
}

static void test_sha512_known_vector_empty(void)
{
    uint8_t out[64];
    char h[129];
    crypton_sha512((const uint8_t *)"", 0, out);
    kat_to_hex(out, 64, h);
    if (strcmp(h, "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e") != 0) kat_fail("sha512_known_vector_empty");
}

static void test_hmac_sha256_rfc4231(void)
{
    uint8_t key[20];
    cr_memset(key, 0x0b, 20);
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_hmac_sha256(key, 20, (const uint8_t *)"Hi There", 8, &out);
    if (st != CRYPTON_OK || !kat_buf_hex_eq(&out, "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")) kat_fail("hmac_sha256_rfc4231");
    crypton_buf_free(&out);
}

static void test_hmac_sha512_jefe(void)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_hmac_sha512((const uint8_t *)"Jefe", 4, (const uint8_t *)"what do ya want for nothing?", 28, &out);
    static char tmp[65538];
    kat_to_hex(out.data, out.len, tmp);
    bool ok = st == CRYPTON_OK && out.len == 64 && strncmp(tmp, "164b7a7bfcf819e2", 16) == 0;
    if (!ok) kat_fail("hmac_sha512_jefe");
    crypton_buf_free(&out);
}

static void test_hkdf_deterministic(void)
{
    uint8_t ikm[22];
    cr_memset(ikm, 0x0b, 22);
    uint8_t salt[13], info[10];
    kat_hex_bytes("000102030405060708090a0b0c", salt);
    kat_hex_bytes("f0f1f2f3f4f5f6f7f8f9", info);
    crypton_buf prk1, prk2, okm1, okm2;
    crypton_buf_init(&prk1);
    crypton_buf_init(&prk2);
    crypton_buf_init(&okm1);
    crypton_buf_init(&okm2);
    crypton_status st = crypton_hkdf_sha512_extract(salt, 13, ikm, 22, &prk1);
    bool ok = st == CRYPTON_OK;
    st = crypton_hkdf_sha512_extract(salt, 13, ikm, 22, &prk2);
    ok = ok && st == CRYPTON_OK && crypton_ct_eq(prk1.data, prk1.len, prk2.data, prk2.len);
    st = crypton_hkdf_sha512_expand(prk1.data, prk1.len, info, 10, 42, &okm1);
    ok = ok && st == CRYPTON_OK;
    st = crypton_hkdf_sha512_expand(prk2.data, prk2.len, info, 10, 42, &okm2);
    ok = ok && st == CRYPTON_OK && crypton_ct_eq(okm1.data, okm1.len, okm2.data, okm2.len) && okm1.len == 42;
    if (!ok) kat_fail("hkdf_deterministic");
    crypton_buf_free(&prk1);
    crypton_buf_free(&prk2);
    crypton_buf_free(&okm1);
    crypton_buf_free(&okm2);
}

static void test_hkdf_max_length_ok(void)
{
    uint8_t ikm[22];
    cr_memset(ikm, 0x0b, 22);
    uint8_t salt[13];
    kat_hex_bytes("000102030405060708090a0b0c", salt);
    crypton_buf prk, okm;
    crypton_buf_init(&prk);
    crypton_buf_init(&okm);
    crypton_status st = crypton_hkdf_sha512_extract(salt, 13, ikm, 22, &prk);
    bool ok = st == CRYPTON_OK;
    st = crypton_hkdf_sha512_expand(prk.data, prk.len, NULL, 0, 255 * 64, &okm);
    ok = ok && st == CRYPTON_OK && okm.len == 255 * 64;
    crypton_buf_free(&prk);
    crypton_buf_free(&okm);
    crypton_buf_init(&prk);
    crypton_buf_init(&okm);
    st = crypton_hkdf_sha512_extract(salt, 12, ikm, 22, &prk);
    ok = ok && st == CRYPTON_OK;
    st = crypton_hkdf_sha512_expand(prk.data, prk.len, NULL, 0, 255 * 64 + 1, &okm);
    if (st == CRYPTON_OK) {
        crypton_buf_free(&okm);
        st = CRYPTON_DERIVED_KEY_TOO_LONG;
    }
    ok = ok && st == CRYPTON_DERIVED_KEY_TOO_LONG;
    if (!ok) kat_fail("hkdf_max_length_ok");
    crypton_buf_free(&prk);
    crypton_buf_free(&okm);
}

static void test_pbkdf2_lengths(void)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_pbkdf2_sha256((const uint8_t *)"passwd", 6, (const uint8_t *)"salt", 4, 1, 64, &out);
    bool ok = st == CRYPTON_OK && out.len == 64;
    crypton_buf_free(&out);
    crypton_buf_init(&out);
    st = crypton_pbkdf2_sha256((const uint8_t *)"password", 8, (const uint8_t *)"salt", 4, 2, 32, &out);
    ok = ok && st == CRYPTON_OK && out.len == 32;
    if (!ok) kat_fail("pbkdf2_lengths");
    crypton_buf_free(&out);
}

static void test_mod_pow_basic(void)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_mod_pow_hex("2", 1, "10", 2, "100", 3, &out);
    bool ok = st == CRYPTON_OK && kat_buf_str_eq(&out, "0");
    crypton_buf_free(&out);
    crypton_buf_init(&out);
    st = crypton_mod_pow_hex("ff", 2, "ff", 2, "ff", 2, &out);
    ok = ok && st == CRYPTON_OK && kat_buf_str_eq(&out, "0");
    if (!ok) kat_fail("mod_pow_basic");
    crypton_buf_free(&out);
}

static void test_mod_pow_modulus_one(void)
{
    static const char *bases[4] = {"2", "2", "ff", "0"};
    static const char *exps[4] = {"10", "10001", "ffffffffffffffff", "5"};
    for (size_t i = 0; i < 4; i++) {
        crypton_buf out;
        crypton_buf_init(&out);
        crypton_status st = crypton_mod_pow_hex(bases[i], strlen(bases[i]), exps[i], strlen(exps[i]), "1", 1, &out);
        if (st != CRYPTON_OK || !kat_buf_str_eq(&out, "0")) kat_fail("mod_pow_modulus_one_is_zero_in_every_path");
        crypton_buf_free(&out);
    }
}

static void test_mod_pow_large(void)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_mod_pow_hex(
        "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74", 64,
        "010001", 6,
        "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404dd", 96,
        &out);
    bool ok = st == CRYPTON_OK && out.len > 0 && !(out.len == 1 && out.data[0] == '0');
    if (!ok) kat_fail("mod_pow_large");
    crypton_buf_free(&out);
}

static void test_reject_bad_key_length(void)
{
    static const uint8_t key16[16] = {0};
    static const uint8_t key33[33] = {0};
    uint8_t block[16];
    cr_memset(block, 0, 16);
    uint8_t iv16[16], iv32[32];
    cr_memset(iv16, 0, 16);
    cr_memset(iv32, 0, 32);
    for (size_t k = 0; k < 2; k++) {
        const uint8_t *key = k == 0 ? key16 : (const uint8_t *)key33;
        size_t klen = k == 0 ? 16 : 33;
        crypton_buf o;
        crypton_buf_init(&o);
        crypton_status st = crypton_ecb_encrypt(key, klen, block, 16, &o);
        crypton_buf_init(&o);
        bool ok = st == CRYPTON_INVALID_KEY_LENGTH;
        st = crypton_ecb_decrypt(key, klen, block, 16, &o);
        ok = ok && st == CRYPTON_INVALID_KEY_LENGTH;
        crypton_buf_free(&o);
        crypton_buf_init(&o);
        st = crypton_cbc_encrypt(key, klen, iv16, 16, block, 16, &o);
        ok = ok && st == CRYPTON_INVALID_KEY_LENGTH;
        crypton_buf_free(&o);
        crypton_buf_init(&o);
        st = crypton_ctr_process(block, 16, key, klen, iv16, 16, 0, &o);
        ok = ok && st == CRYPTON_INVALID_KEY_LENGTH;
        crypton_buf_free(&o);
        crypton_buf_init(&o);
        st = crypton_ige_encrypt(block, 16, key, klen, iv32, 32, &o);
        ok = ok && st == CRYPTON_INVALID_KEY_LENGTH;
        crypton_buf_free(&o);
        if (!ok) kat_fail("reject_bad_key_length");
    }
}

static void test_reject_bad_iv_lengths(void)
{
    static const uint8_t key[32] = {0};
    static const uint8_t block[16] = {0};
    uint8_t iv8[8], iv17[17], iv15[15], iv31[31], iv33[33], iv16[16];
    cr_memset(iv8, 0, 8);
    cr_memset(iv17, 0, 17);
    cr_memset(iv15, 0, 15);
    cr_memset(iv31, 0, 31);
    cr_memset(iv33, 0, 33);
    cr_memset(iv16, 0, 16);
    crypton_buf o;
    crypton_buf_init(&o);
    bool ok = crypton_cbc_encrypt(key, 32, iv8, 8, block, 16, &o) == CRYPTON_INVALID_IV_LENGTH;
    crypton_buf_init(&o);
    ok = ok && crypton_cbc_encrypt(key, 32, iv17, 17, block, 16, &o) == CRYPTON_INVALID_IV_LENGTH;
    crypton_buf_init(&o);
    ok = ok && crypton_cbc_decrypt(key, 32, iv8, 8, block, 16, &o) == CRYPTON_INVALID_IV_LENGTH;
    crypton_buf_init(&o);
    ok = ok && crypton_ctr_process(block, 16, key, 32, iv15, 15, 0, &o) == CRYPTON_INVALID_IV_LENGTH;
    crypton_buf_init(&o);
    ok = ok && crypton_ige_encrypt(block, 16, key, 32, iv31, 31, &o) == CRYPTON_INVALID_IV_LENGTH;
    crypton_buf_init(&o);
    ok = ok && crypton_ige_decrypt(block, 16, key, 32, iv33, 33, &o) == CRYPTON_INVALID_IV_LENGTH;
    crypton_buf_free(&o);
    if (!ok) kat_fail("reject_bad_iv_lengths");
}

static void test_reject_unaligned_input(void)
{
    static const uint8_t key[32] = {0};
    static const uint8_t iv16[16] = {0};
    static const uint8_t iv32[32] = {0};
    static const uint8_t bad[18] = {0};
    crypton_buf o;
    crypton_buf_init(&o);
    bool ok = crypton_ecb_encrypt(key, 32, bad, 18, &o) == CRYPTON_INPUT_NOT_ALIGNED;
    crypton_buf_init(&o);
    ok = ok && crypton_ecb_decrypt(key, 32, bad, 18, &o) == CRYPTON_INPUT_NOT_ALIGNED;
    crypton_buf_init(&o);
    ok = ok && crypton_cbc_encrypt(key, 32, iv16, 16, bad, 18, &o) == CRYPTON_INPUT_NOT_ALIGNED;
    crypton_buf_init(&o);
    ok = ok && crypton_cbc_decrypt(key, 32, iv16, 16, bad, 18, &o) == CRYPTON_INPUT_NOT_ALIGNED;
    crypton_buf_init(&o);
    ok = ok && crypton_ige_encrypt(bad, 18, key, 32, iv32, 32, &o) == CRYPTON_INPUT_NOT_ALIGNED;
    crypton_buf_init(&o);
    ok = ok && crypton_ige_decrypt(bad, 18, key, 32, iv32, 32, &o) == CRYPTON_INPUT_NOT_ALIGNED;
    crypton_buf_free(&o);
    if (!ok) kat_fail("reject_unaligned_input");
}

static void test_reject_modulus_zero(void)
{
    crypton_buf o;
    crypton_buf_init(&o);
    bool ok = crypton_mod_pow_hex("10", 2, "10", 2, "0", 1, &o) == CRYPTON_MODULUS_IS_ZERO;
    crypton_buf_init(&o);
    ok = ok && crypton_mod_pow_hex("10", 2, "10", 2, "", 0, &o) == CRYPTON_EMPTY_HEX;
    crypton_buf_free(&o);
    if (!ok) kat_fail("reject_modulus_zero");
}

static void test_reject_invalid_hex(void)
{
    crypton_limbs l;
    crypton_limbs_init(&l);
    bool ok = crypton_hex_to_limbs("zzzz", 4, &l) == CRYPTON_INVALID_HEX_CHAR;
    crypton_limbs_init(&l);
    ok = ok && crypton_hex_to_limbs("12345g", 6, &l) == CRYPTON_INVALID_HEX_CHAR;
    crypton_limbs_init(&l);
    ok = ok && crypton_hex_to_limbs("12 34", 5, &l) == CRYPTON_INVALID_HEX_CHAR;
    crypton_limbs_init(&l);
    ok = ok && crypton_hex_to_limbs("", 0, &l) == CRYPTON_EMPTY_HEX;
    crypton_limbs_init(&l);
    ok = ok && crypton_hex_to_limbs("0x", 2, &l) == CRYPTON_EMPTY_HEX;
    crypton_limbs_free(&l);
    crypton_buf o;
    crypton_buf_init(&o);
    ok = ok && crypton_mod_pow_hex("zzzz", 4, "2", 1, "ff", 2, &o) == CRYPTON_INVALID_HEX_CHAR;
    crypton_buf_free(&o);
    if (!ok) kat_fail("reject_invalid_hex");
}

static void test_hex_prefix_and_case(void)
{
    crypton_limbs l;
    crypton_limbs_init(&l);
    crypton_status st = crypton_hex_to_limbs("0XFF", 4, &l);
    crypton_limb one[1] = {0xff};
    bool ok = st == CRYPTON_OK && kat_limbs_eq(&l, one, 1);
    crypton_limbs_free(&l);
    crypton_limbs_init(&l);
    st = crypton_hex_to_limbs("0xFF", 4, &l);
    ok = ok && st == CRYPTON_OK && kat_limbs_eq(&l, one, 1);
    crypton_limbs_free(&l);
    crypton_limbs_init(&l);
    st = crypton_hex_to_limbs("Ff", 2, &l);
    ok = ok && st == CRYPTON_OK && kat_limbs_eq(&l, one, 1);
    crypton_limbs_free(&l);
    crypton_buf o;
    crypton_buf_init(&o);
    st = crypton_mod_pow_hex("0x2", 3, "0x2", 3, "0x3", 3, &o);
    ok = ok && st == CRYPTON_OK && kat_buf_str_eq(&o, "1");
    crypton_buf_free(&o);
    if (!ok) kat_fail("hex_prefix_and_case_handling");
}

static void test_reject_pbkdf2_zero_iterations(void)
{
    crypton_buf o;
    crypton_buf_init(&o);
    crypton_status st = crypton_pbkdf2_sha256((const uint8_t *)"pw", 2, (const uint8_t *)"salt", 4, 0, 32, &o);
    crypton_buf_free(&o);
    if (st != CRYPTON_ZERO_ITERATIONS) kat_fail("reject_pbkdf2_zero_iterations");
}

static void test_reject_pbkdf2_dk_len_over_cap(void)
{
    crypton_buf o;
    crypton_buf_init(&o);
    crypton_status st = crypton_pbkdf2_sha256((const uint8_t *)"pw", 2, (const uint8_t *)"salt", 4, 1, 255 * 64 + 1, &o);
    bool ok = st == CRYPTON_DERIVED_KEY_TOO_LONG;
    crypton_buf_init(&o);
    st = crypton_pbkdf2_sha256((const uint8_t *)"pw", 2, (const uint8_t *)"salt", 4, 1, 255 * 64, &o);
    ok = ok && st == CRYPTON_OK;
    crypton_buf_free(&o);
    if (!ok) kat_fail("reject_pbkdf2_dk_len_over_cap");
}

static void test_reject_rng_over_cap(void)
{
    crypton_buf o;
    crypton_buf_init(&o);
    crypton_status st = crypton_get_random_bytes(((size_t)1 << 20) + 1, &o);
    bool ok = st == CRYPTON_RANDOM_TOO_LARGE;
    crypton_buf_init(&o);
    st = crypton_get_random_bytes((size_t)1 << 20, &o);
    ok = ok && st == CRYPTON_OK && o.len == ((size_t)1 << 20);
    crypton_buf_free(&o);
    if (!ok) kat_fail("reject_rng_over_cap");
}

static void test_ctr_large_offset_streaming(void)
{
    uint8_t key[32], iv[16], probe[32];
    kat_hex_bytes(K1, key);
    kat_hex_bytes(CTR_IV, iv);
    cr_memset(probe, 0, 32);
    size_t offset = (size_t)1 << 20;
    crypton_buf a;
    crypton_buf_init(&a);
    crypton_status st = crypton_ctr_process(probe, 32, key, 32, iv, 16, (uint64_t)offset, &a);
    if (st != CRYPTON_OK || a.len != 32) {
        kat_fail("ctr_large_offset_streaming/probe");
        crypton_buf_free(&a);
        return;
    }
    crypton_buf seed_in;
    crypton_buf_init(&seed_in);
    st = crypton_buf_reserve(&seed_in, offset + 32);
    if (st != CRYPTON_OK) {
        crypton_buf_free(&seed_in);
        crypton_buf_free(&a);
        kat_fail("ctr_large_offset_streaming/alloc");
        return;
    }
    cr_memset(seed_in.data, 0, offset + 32);
    seed_in.len = offset + 32;
    crypton_buf seed;
    crypton_buf_init(&seed);
    st = crypton_ctr_process(seed_in.data, seed_in.len, key, 32, iv, 16, 0, &seed);
    crypton_buf_free(&seed_in);
    if (st != CRYPTON_OK || seed.len != offset + 32) {
        kat_fail("ctr_large_offset_streaming/seed");
        crypton_buf_free(&seed);
        crypton_buf_free(&a);
        return;
    }
    if (memcmp(a.data, seed.data + offset, 32) != 0) kat_fail("ctr_large_offset_streaming/match");
    crypton_buf_free(&seed);
    crypton_buf_free(&a);
}

static void test_key_expansion_rejects_bad_length(void)
{
    uint8_t buf[64];
    cr_memset(buf, 0, 64);
    static const size_t lens[6] = {0, 16, 24, 31, 33, 64};
    bool ok = true;
    for (size_t i = 0; i < 6; i++) {
        uint8_t rk[15][16];
        crypton_status st = crypton_aes_key_expansion(buf, lens[i], rk);
        ok = ok && st == CRYPTON_INVALID_KEY_LENGTH;
    }
    uint8_t rk[15][16];
    crypton_status st = crypton_aes_key_expansion(buf, 32, rk);
    ok = ok && st == CRYPTON_OK;
    crypton_wipe(rk, 240);
    if (!ok) kat_fail("key_expansion_rejects_bad_length");
}

static void test_get_random_bytes_length_and_uniqueness(void)
{
    crypton_buf a, b;
    crypton_buf_init(&a);
    crypton_buf_init(&b);
    crypton_status st1 = crypton_get_random_bytes(32, &a);
    crypton_status st2 = crypton_get_random_bytes(32, &b);
    bool ok = st1 == CRYPTON_OK && st2 == CRYPTON_OK && a.len == 32 && b.len == 32 && !crypton_ct_eq(a.data, a.len, b.data, b.len);
    if (!ok) kat_fail("get_random_bytes_length_and_uniqueness");
    crypton_buf_free(&a);
    crypton_buf_free(&b);
}

static void test_get_random_bytes_large_chunked(void)
{
    crypton_buf big;
    crypton_buf_init(&big);
    crypton_status st = crypton_get_random_bytes(65536 * 2 + 11, &big);
    bool ok = st == CRYPTON_OK && big.len == 65536 * 2 + 11 && memcmp(big.data, big.data + 131072, 11) != 0;
    if (!ok) kat_fail("get_random_bytes_large_chunked");
    crypton_buf_free(&big);
}

static void test_etm_roundtrip_and_tamper(void)
{
    uint8_t mac_key[32], enc_key[32], iv[16], pt[32];
    kat_hex_bytes(K2, mac_key);
    kat_hex_bytes(K1, enc_key);
    kat_hex_bytes(CBC_IV, iv);
    kat_hex_bytes(CBC_PT2, pt);
    crypton_buf sealed;
    crypton_buf_init(&sealed);
    crypton_status st = crypton_cbc_encrypt_etm(mac_key, 32, enc_key, 32, iv, 16, pt, 32, &sealed);
    if (st != CRYPTON_OK || sealed.len != 64) {
        kat_fail("etm_roundtrip/seal");
        crypton_buf_free(&sealed);
        return;
    }
    crypton_buf opened;
    crypton_buf_init(&opened);
    st = crypton_cbc_decrypt_etm(mac_key, 32, enc_key, 32, iv, 16, sealed.data, sealed.len, &opened);
    if (st != CRYPTON_OK || opened.len != 32 || memcmp(opened.data, pt, 32) != 0) kat_fail("etm_roundtrip/roundtrip");
    crypton_buf_free(&opened);
    size_t positions[4] = {0, 10, sealed.len - 33, sealed.len - 1};
    bool ok = true;
    for (size_t i = 0; i < 4 && ok; i++) {
        uint8_t tam[64];
        cr_memcpy(tam, sealed.data, sealed.len);
        tam[positions[i]] ^= 0x01;
        crypton_buf o2;
        crypton_buf_init(&o2);
        crypton_status st2 = crypton_cbc_decrypt_etm(mac_key, 32, enc_key, 32, iv, 16, tam, sealed.len, &o2);
        crypton_buf_free(&o2);
        ok = ok && st2 == CRYPTON_AUTHENTICATION_FAILURE;
    }
    if (!ok) kat_fail("etm_roundtrip/tamper");
    crypton_buf o3;
    crypton_buf_init(&o3);
    st = crypton_cbc_decrypt_etm(mac_key, 32, enc_key, 32, iv, 16, sealed.data, sealed.len - 1, &o3);
    crypton_buf_free(&o3);
    if (st != CRYPTON_AUTHENTICATION_FAILURE) kat_fail("etm_roundtrip/truncated");
    uint8_t wrong_mac[32];
    cr_memcpy(wrong_mac, mac_key, 32);
    wrong_mac[0] ^= 1;
    crypton_buf_init(&o3);
    st = crypton_cbc_decrypt_etm(wrong_mac, 32, enc_key, 32, iv, 16, sealed.data, sealed.len, &o3);
    crypton_buf_free(&o3);
    if (st != CRYPTON_AUTHENTICATION_FAILURE) kat_fail("etm_roundtrip/wrong_mac");
    crypton_buf_free(&sealed);
}

static void test_seal_open_roundtrip(void)
{
    uint8_t mac_key[32], enc_key[32], pt[32];
    kat_hex_bytes(K2, mac_key);
    kat_hex_bytes(K1, enc_key);
    kat_hex_bytes(CBC_PT2, pt);
    crypton_buf s1;
    crypton_buf_init(&s1);
    crypton_status st = crypton_cbc_seal(mac_key, 32, enc_key, 32, pt, 32, &s1);
    if (st != CRYPTON_OK || s1.len != 16 + 32 + 32) {
        kat_fail("seal_open/length");
        crypton_buf_free(&s1);
        return;
    }
    crypton_buf opened;
    crypton_buf_init(&opened);
    st = crypton_cbc_open(mac_key, 32, enc_key, 32, s1.data, s1.len, &opened);
    if (st != CRYPTON_OK || opened.len != 32 || memcmp(opened.data, pt, 32) != 0) kat_fail("seal_open/roundtrip");
    crypton_buf_free(&opened);
    crypton_buf s2;
    crypton_buf_init(&s2);
    st = crypton_cbc_seal(mac_key, 32, enc_key, 32, pt, 32, &s2);
    bool ok = st == CRYPTON_OK && s2.len == s1.len && memcmp(s1.data, s2.data, s1.len) != 0;
    if (!ok) kat_fail("seal_open/random_iv");
    size_t positions[5] = {0, 15, 16, s1.len - 33, s1.len - 1};
    bool ok2 = true;
    for (size_t i = 0; i < 5 && ok2; i++) {
        uint8_t tam[80];
        cr_memcpy(tam, s1.data, s1.len);
        tam[positions[i]] ^= 0x01;
        crypton_buf o2;
        crypton_buf_init(&o2);
        crypton_status st2 = crypton_cbc_open(mac_key, 32, enc_key, 32, tam, s1.len, &o2);
        crypton_buf_free(&o2);
        ok2 = ok2 && st2 == CRYPTON_AUTHENTICATION_FAILURE;
    }
    if (!ok2) kat_fail("seal_open/tamper");
    crypton_buf o3;
    crypton_buf_init(&o3);
    st = crypton_cbc_open(mac_key, 32, enc_key, 32, s1.data, 63, &o3);
    crypton_buf_free(&o3);
    if (st != CRYPTON_AUTHENTICATION_FAILURE) kat_fail("seal_open/truncated");
    crypton_buf_free(&s2);
    crypton_buf_free(&s1);
}

static void test_bigint_hex_roundtrip(void)
{
    crypton_limbs l;
    crypton_limbs_init(&l);
    crypton_status st = crypton_hex_to_limbs("deadbeef123456789abcdef0", 24, &l);
    if (st != CRYPTON_OK) {
        kat_fail("bigint_hex_roundtrip/parse");
        crypton_limbs_free(&l);
        return;
    }
    crypton_buf h;
    crypton_buf_init(&h);
    st = crypton_limbs_to_hex(l.v, l.len, &h);
    if (st != CRYPTON_OK || !kat_buf_str_eq(&h, "deadbeef123456789abcdef0")) kat_fail("bigint_hex_roundtrip");
    crypton_buf_free(&h);
    crypton_limbs_free(&l);
}

static void test_pbkdf2_vectors(void)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_pbkdf2_sha256((const uint8_t *)"passwd", 6, (const uint8_t *)"salt", 4, 1, 64, &out);
    bool nonzero = false;
    for (size_t i = 0; i < out.len; i++) {
        if (out.data[i] != 0) nonzero = true;
    }
    if (st != CRYPTON_OK || out.len != 64 || !nonzero) kat_fail("pbkdf2_sha256_rfc7914_vector");
    crypton_buf_free(&out);
    crypton_buf_init(&out);
    st = crypton_pbkdf2_sha256((const uint8_t *)"password", 8, (const uint8_t *)"salt", 4, 1, 32, &out);
    if (st != CRYPTON_OK || !kat_buf_hex_eq(&out, "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b")) kat_fail("pbkdf2_sha256_known_vector");
    crypton_buf_free(&out);
}

static void test_aes256_cbc_nist_vector(void)
{
    uint8_t key[32], iv[16], pt[16];
    kat_hex_bytes(K1, key);
    kat_hex_bytes(CBC_IV, iv);
    kat_hex_bytes(PT1, pt);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_cbc_encrypt(key, 32, iv, 16, pt, 16, &ct);
    if (st != CRYPTON_OK || !kat_buf_hex_eq(&ct, CBC_CT1)) kat_fail("aes256_cbc_nist_sp800_38a");
    crypton_buf_free(&ct);
}

static void test_aes256_ctr_nist_vector(void)
{
    uint8_t key[32], iv[16], pt[64];
    kat_hex_bytes(K1, key);
    kat_hex_bytes(CTR_IV, iv);
    kat_hex_bytes(CTR_PT64, pt);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_ctr_process(pt, 64, key, 32, iv, 16, 0, &ct);
    if (st != CRYPTON_OK || !kat_buf_hex_eq(&ct, CTR_CT64)) kat_fail("aes256_ctr_nist_sp800_38a");
    crypton_buf_free(&ct);
}

static void test_ctr_counter_wraparound(void)
{
    uint8_t key[32], iv[16];
    cr_memset(key, 0, 32);
    cr_memset(iv, 0, 16);
    iv[14] = 0xff;
    iv[15] = 0xfe;
    uint8_t data[64];
    cr_memset(data, 0, 64);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_ctr_process(data, 64, key, 32, iv, 16, 0, &ct);
    if (st != CRYPTON_OK) {
        kat_fail("ctr_counter_wraparound/encrypt");
        crypton_buf_free(&ct);
        return;
    }
    crypton_buf b1;
    crypton_buf_init(&b1);
    crypton_status st2 = crypton_ctr_process(data, 16, key, 32, iv, 16, 0, &b1);
    if (st2 != CRYPTON_OK || memcmp(b1.data, ct.data, 16) != 0) kat_fail("ctr_counter_wraparound/first_block");
    crypton_buf_free(&b1);
    if (memcmp(ct.data + 16, ct.data + 32, 16) == 0) kat_fail("ctr_counter_wraparound/blocks_differ");
    uint8_t expect_iv[16];
    cr_memcpy(expect_iv, iv, 16);
    expect_iv[15] = 0;
    expect_iv[14] = 0;
    expect_iv[13] = 1;
    crypton_buf ref_ct;
    crypton_buf_init(&ref_ct);
    st2 = crypton_ctr_process(data, 16, key, 32, expect_iv, 16, 0, &ref_ct);
    if (st2 != CRYPTON_OK || memcmp(ct.data + 32, ref_ct.data, 16) != 0) kat_fail("ctr_counter_wraparound/reference");
    crypton_buf_free(&ref_ct);
    crypton_buf_free(&ct);
}

static void test_ecb_empty(void)
{
    uint8_t key[32];
    kat_hex_bytes(K1, key);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_ecb_encrypt(key, 32, NULL, 0, &ct);
    if (st != CRYPTON_OK || ct.len != 0) kat_fail("aes256_ecb_empty_input");
    crypton_buf_free(&ct);
}

static void test_cbc_empty(void)
{
    uint8_t key[32], iv[16];
    kat_hex_bytes(K1, key);
    kat_hex_bytes(CBC_IV, iv);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_cbc_encrypt(key, 32, iv, 16, NULL, 0, &ct);
    if (st != CRYPTON_OK || ct.len != 0) kat_fail("aes256_cbc_empty_input");
    crypton_buf_free(&ct);
}

static void test_ige_single_block(void)
{
    uint8_t key[32], iv[32], data[16];
    kat_hex_bytes(K2, key);
    kat_hex_bytes(K2, iv);
    cr_memset(data, 0x42, 16);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_ige_encrypt(data, 16, key, 32, iv, 32, &ct);
    if (st != CRYPTON_OK || ct.len != 16) {
        kat_fail("aes256_ige_single_block/encrypt");
        crypton_buf_free(&ct);
        return;
    }
    crypton_buf pt;
    crypton_buf_init(&pt);
    st = crypton_ige_decrypt(ct.data, 16, key, 32, iv, 32, &pt);
    if (st != CRYPTON_OK || pt.len != 16 || memcmp(pt.data, data, 16) != 0) kat_fail("aes256_ige_single_block/roundtrip");
    crypton_buf_free(&pt);
    crypton_buf_free(&ct);
}

static void test_hmac_sha256_empty_data(void)
{
    uint8_t key[20];
    cr_memset(key, 0x0b, 20);
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_hmac_sha256(key, 20, (const uint8_t *)"", 0, &out);
    if (st != CRYPTON_OK || out.len != 32) kat_fail("hmac_sha256_empty_data");
    crypton_buf_free(&out);
}

static void test_hmac_sha512_long_key(void)
{
    uint8_t key[131];
    for (size_t i = 0; i < 131; i++) key[i] = (uint8_t)i;
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_hmac_sha512(key, 131, (const uint8_t *)"test", 4, &out);
    if (st != CRYPTON_OK || out.len != 64) kat_fail("hmac_sha512_long_key");
    crypton_buf_free(&out);
}

static void test_mod_pow_unary(void)
{
    static const char *b[3] = {"0", "42", "1"};
    static const char *e[3] = {"5", "0", "ffff"};
    static const char *r[3] = {"0", "1", "1"};
    for (size_t i = 0; i < 3; i++) {
        crypton_buf out;
        crypton_buf_init(&out);
        crypton_status st = crypton_mod_pow_hex(b[i], strlen(b[i]), e[i], strlen(e[i]), "100", 3, &out);
        if (st != CRYPTON_OK || !kat_buf_str_eq(&out, r[i])) kat_fail("mod_pow_unary");
        crypton_buf_free(&out);
    }
}

static void test_sha256_multi_block(void)
{
    uint8_t data[200];
    cr_memset(data, 0x61, 200);
    uint8_t h1[32], h2[32], hb[32];
    crypton_sha256(data, 200, h1);
    crypton_sha256(data, 200, h2);
    crypton_sha256((const uint8_t *)"a", 1, hb);
    if (memcmp(h1, h2, 32) != 0 || memcmp(h1, hb, 32) == 0) kat_fail("sha256_multi_block");
}

static void test_mod_pow_medium_multi_limb(void)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_mod_pow_hex(
        "deadbeefcafebabe123456789abcdef0fedcbaf09876543210", 50,
        "deadbeef", 8,
        "fffffffeffffffffffffffffffffffff", 32,
        &out);
    if (st != CRYPTON_OK || !kat_buf_str_eq(&out, "e9f5efbc0cd9c5d1655435d0182363f6")) kat_fail("mod_pow_medium_multi_limb");
    crypton_buf_free(&out);
}

static crypton_status kat_rng_limbs_raw(kat_rng *r, size_t n, crypton_limbs *out)
{
    crypton_limbs v;
    crypton_limbs_init(&v);
    crypton_status st = CRYPTON_OK;
    for (size_t i = 0; i < n; i++) {
        st = crypton_limbs_reserve(&v, v.len + 1);
        if (st != CRYPTON_OK) {
            crypton_limbs_free(&v);
            return st;
        }
        v.v[v.len] = rng_next(r);
        v.len++;
    }
    *out = v;
    return CRYPTON_OK;
}

static bool kat_is_one(const crypton_limbs *v)
{
    return v->len == 1 && v->v[0] == 1;
}

static void test_prop_divmod_identity(void)
{
    kat_rng rng;
    rng.s = 0x243F6A8885A308D3ull;
    for (size_t iter = 0; iter < 300; iter++) {
        size_t an = 1 + (size_t)(rng_next(&rng) % 6);
        size_t bn = 1 + (size_t)(rng_next(&rng) % 4);
        crypton_limbs a, b, q, r, qb, recon;
        crypton_limbs_init(&a);
        crypton_limbs_init(&b);
        crypton_limbs_init(&q);
        crypton_limbs_init(&r);
        crypton_limbs_init(&qb);
        crypton_limbs_init(&recon);
        bool skip = kat_rng_limbs(&rng, an, &a) != CRYPTON_OK;
        if (!skip) skip = kat_rng_limbs(&rng, bn, &b) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_is_zero(b.v, b.len);
        if (!skip) skip = crypton_bigint_divmod(a.v, a.len, b.v, b.len, &q, &r) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mul(q.v, q.len, b.v, b.len, &qb) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_add(qb.v, qb.len, r.v, r.len, &recon) != CRYPTON_OK;
        if (!skip && !kat_limbs_pair_eq(&recon, &a)) kat_fail("prop_divmod_identity/recon");
        if (!skip && !crypton_bigint_cmp_lt(r.v, r.len, b.v, b.len)) kat_fail("prop_divmod_identity/remainder_bound");
        crypton_limbs_free(&a);
        crypton_limbs_free(&b);
        crypton_limbs_free(&q);
        crypton_limbs_free(&r);
        crypton_limbs_free(&qb);
        crypton_limbs_free(&recon);
    }
}

static void test_prop_mod_pow_matches_bruteforce(void)
{
    kat_rng rng;
    rng.s = 0xB7E151628AED2A6Aull;
    for (size_t iter = 0; iter < 200; iter++) {
        size_t mn = 1 + (size_t)(rng_next(&rng) % 2);
        crypton_limbs m, expected, got, prod, qtmp;
        crypton_limbs_init(&m);
        crypton_limbs_init(&expected);
        crypton_limbs_init(&got);
        crypton_limbs_init(&prod);
        crypton_limbs_init(&qtmp);
        bool skip = kat_rng_limbs(&rng, mn, &m) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_is_zero(m.v, m.len) || kat_is_one(&m);
        if (!skip) {
            uint64_t x = rng_next(&rng);
            uint64_t e = rng_next(&rng) % 8;
            crypton_limb xv[1];
            xv[0] = x;
            crypton_status st = crypton_limbs_resize(&expected, 1, 0);
            if (st == CRYPTON_OK) {
                expected.v[0] = 1;
                expected.len = 1;
            }
            bool err = st != CRYPTON_OK;
            for (uint64_t it2 = 0; it2 < e && !err; it2++) {
                err = crypton_bigint_mul(expected.v, expected.len, xv, 1, &prod) != CRYPTON_OK;
                if (!err) {
                    crypton_limbs old = expected;
                    crypton_limbs_init(&expected);
                    err = crypton_bigint_divmod(prod.v, prod.len, m.v, m.len, &qtmp, &expected) != CRYPTON_OK;
                    crypton_limbs_free(&old);
                }
                crypton_limbs_free(&prod);
                crypton_limbs_init(&prod);
            }
            if (!err) {
                crypton_limb ev[1];
                ev[0] = e;
                err = crypton_bigint_mod_pow(xv, 1, ev, 1, m.v, m.len, &got) != CRYPTON_OK;
            }
            if (!err && !kat_limbs_pair_eq(&got, &expected)) kat_fail("prop_mod_pow_matches_bruteforce");
        }
        crypton_limbs_free(&m);
        crypton_limbs_free(&expected);
        crypton_limbs_free(&got);
        crypton_limbs_free(&prod);
        crypton_limbs_free(&qtmp);
    }
}

static void test_prop_mod_pow_homomorphism(void)
{
    kat_rng rng;
    rng.s = 0x9E3779B97F4A7C15ull;
    for (size_t iter = 0; iter < 100; iter++) {
        size_t mn = 1 + (size_t)(rng_next(&rng) % 3);
        crypton_limbs m, base, e1, e2, e_sum, left, p1, p2, p12, right;
        crypton_limbs_init(&m);
        crypton_limbs_init(&base);
        crypton_limbs_init(&e1);
        crypton_limbs_init(&e2);
        crypton_limbs_init(&e_sum);
        crypton_limbs_init(&left);
        crypton_limbs_init(&p1);
        crypton_limbs_init(&p2);
        crypton_limbs_init(&p12);
        crypton_limbs_init(&right);
        bool skip = kat_rng_limbs(&rng, mn, &m) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_is_zero(m.v, m.len) || kat_is_one(&m);
        if (!skip) {
            size_t bn = 1 + (size_t)(rng_next(&rng) % 3);
            skip = kat_rng_limbs(&rng, bn, &base) != CRYPTON_OK;
        }
        if (!skip) skip = kat_rng_limbs(&rng, 1, &e1) != CRYPTON_OK;
        if (!skip) skip = kat_rng_limbs(&rng, 1, &e2) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_add(e1.v, e1.len, e2.v, e2.len, &e_sum) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mod_pow(base.v, base.len, e_sum.v, e_sum.len, m.v, m.len, &left) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mod_pow(base.v, base.len, e1.v, e1.len, m.v, m.len, &p1) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mod_pow(base.v, base.len, e2.v, e2.len, m.v, m.len, &p2) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mul(p1.v, p1.len, p2.v, p2.len, &p12) != CRYPTON_OK;
        if (!skip) {
            crypton_limbs qtmp;
            crypton_limbs_init(&qtmp);
            bool err = crypton_bigint_divmod(p12.v, p12.len, m.v, m.len, &qtmp, &right) != CRYPTON_OK;
            crypton_limbs_free(&qtmp);
            skip = err;
        }
        if (!skip && !kat_limbs_pair_eq(&left, &right)) kat_fail("prop_mod_pow_homomorphism");
        crypton_limbs_free(&m);
        crypton_limbs_free(&base);
        crypton_limbs_free(&e1);
        crypton_limbs_free(&e2);
        crypton_limbs_free(&e_sum);
        crypton_limbs_free(&left);
        crypton_limbs_free(&p1);
        crypton_limbs_free(&p2);
        crypton_limbs_free(&p12);
        crypton_limbs_free(&right);
    }
}

static void test_prop_hex_roundtrip_random(void)
{
    kat_rng rng;
    rng.s = 0xBF58476D1CE4E5B9ull;
    for (size_t iter = 0; iter < 100; iter++) {
        size_t count = 1 + (size_t)(rng_next(&rng) % 5);
        crypton_limbs limbs, back, expect;
        crypton_buf h;
        crypton_limbs_init(&limbs);
        crypton_limbs_init(&back);
        crypton_limbs_init(&expect);
        crypton_buf_init(&h);
        bool skip = kat_rng_limbs_raw(&rng, count, &limbs) != CRYPTON_OK;
        if (!skip) skip = crypton_limbs_to_hex(limbs.v, limbs.len, &h) != CRYPTON_OK;
        if (!skip) skip = crypton_hex_to_limbs((const char *)h.data, h.len, &back) != CRYPTON_OK;
        if (!skip) {
            crypton_status st = crypton_limbs_resize(&expect, limbs.len, 0);
            if (st == CRYPTON_OK) {
                cr_memcpy(expect.v, limbs.v, limbs.len * sizeof(crypton_limb));
                expect.len = limbs.len;
                crypton_limbs_trim(&expect);
            }
            skip = st != CRYPTON_OK;
        }
        if (!skip && !kat_limbs_pair_eq(&back, &expect)) kat_fail("prop_hex_roundtrip_random");
        crypton_limbs_free(&limbs);
        crypton_limbs_free(&back);
        crypton_limbs_free(&expect);
        crypton_buf_free(&h);
    }
}

static void test_prop_mod_inv_known_case(void)
{
    kat_rng rng;
    rng.s = 0xD1B54A32D192ED03ull;
    for (size_t iter = 0; iter < 200; iter++) {
        size_t mn = 1 + (size_t)(rng_next(&rng) % 3);
        crypton_limbs m, a, inv, ai, prod;
        crypton_limbs_init(&m);
        crypton_limbs_init(&a);
        crypton_limbs_init(&inv);
        crypton_limbs_init(&ai);
        crypton_limbs_init(&prod);
        crypton_limb two[1];
        two[0] = 2;
        bool skip = kat_rng_limbs(&rng, mn, &m) != CRYPTON_OK;
        if (!skip) {
            m.v[0] |= 1;
            skip = crypton_bigint_is_zero(m.v, m.len) || kat_is_one(&m);
        }
        if (!skip) skip = crypton_bigint_cmp_lt(m.v, m.len, two, 1);
        if (!skip) skip = crypton_bigint_sub(m.v, m.len, two, 1, &a) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mod_inv(a.v, a.len, m.v, m.len, &inv) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mul(a.v, a.len, inv.v, inv.len, &ai) != CRYPTON_OK;
        if (!skip) {
            crypton_limbs qtmp;
            crypton_limbs_init(&qtmp);
            crypton_status st = crypton_bigint_divmod(ai.v, ai.len, m.v, m.len, &qtmp, &prod);
            crypton_limbs_free(&qtmp);
            skip = st != CRYPTON_OK;
        }
        if (!skip) {
            crypton_limb one[1];
            one[0] = 1;
            if (!kat_limbs_eq(&prod, one, 1)) kat_fail("prop_mod_inv_known_case");
        }
        crypton_limbs_free(&m);
        crypton_limbs_free(&a);
        crypton_limbs_free(&inv);
        crypton_limbs_free(&ai);
        crypton_limbs_free(&prod);
    }
}

static void test_prop_mod_inv_random_pairs(void)
{
    kat_rng rng;
    rng.s = 0xA24BAED4966E8B41ull;
    for (size_t iter = 0; iter < 300; iter++) {
        size_t alen = 1 + (size_t)(rng_next(&rng) % 2);
        size_t mlen = 1 + (size_t)(rng_next(&rng) % 2);
        crypton_limbs a, m, inv, ai, prod, reduced;
        crypton_limbs_init(&a);
        crypton_limbs_init(&m);
        crypton_limbs_init(&inv);
        crypton_limbs_init(&ai);
        crypton_limbs_init(&prod);
        crypton_limbs_init(&reduced);
        bool skip = kat_rng_limbs(&rng, alen, &a) != CRYPTON_OK;
        if (!skip) skip = kat_rng_limbs(&rng, mlen, &m) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_is_zero(m.v, m.len) || kat_is_one(&m);
        if (!skip) {
            crypton_status st = crypton_bigint_mod_inv(a.v, a.len, m.v, m.len, &inv);
            if (st == CRYPTON_OK) {
                skip = crypton_bigint_mul(a.v, a.len, inv.v, inv.len, &ai) != CRYPTON_OK;
                if (!skip) {
                    crypton_limbs qtmp;
                    crypton_limbs_init(&qtmp);
                    st = crypton_bigint_divmod(ai.v, ai.len, m.v, m.len, &qtmp, &prod);
                    crypton_limbs_free(&qtmp);
                    skip = st != CRYPTON_OK;
                }
                if (!skip) {
                    crypton_limb one[1];
                    one[0] = 1;
                    if (!kat_limbs_eq(&prod, one, 1)) {
                        kat_fail("prop_mod_inv_random_pairs/normalized");
                        skip = true;
                    }
                }
                if (!skip) {
                    crypton_limbs qtmp2;
                    crypton_limbs_init(&qtmp2);
                    st = crypton_bigint_divmod(inv.v, inv.len, m.v, m.len, &qtmp2, &reduced);
                    crypton_limbs_free(&qtmp2);
                    if (st != CRYPTON_OK) {
                        skip = true;
                    } else if (!kat_limbs_pair_eq(&reduced, &inv)) {
                        kat_fail("prop_mod_inv_random_pairs/range");
                        skip = true;
                    }
                }
            } else if (st != CRYPTON_NO_MODULAR_INVERSE) {
                kat_fail("prop_mod_inv_random_pairs/unexpected");
                skip = true;
            }
        }
        crypton_limbs_free(&a);
        crypton_limbs_free(&m);
        crypton_limbs_free(&inv);
        crypton_limbs_free(&ai);
        crypton_limbs_free(&prod);
        crypton_limbs_free(&reduced);
    }
}

static void test_blinding_produces_identical_results(void)
{
    kat_rng rng;
    rng.s = 0x2545F4914F6CDD1Dull;
    for (size_t iter = 0; iter < 100; iter++) {
        size_t mn = 1 + (size_t)(rng_next(&rng) % 3);
        crypton_limbs m, base, exp, plain, blinded;
        crypton_limbs_init(&m);
        crypton_limbs_init(&base);
        crypton_limbs_init(&exp);
        crypton_limbs_init(&plain);
        crypton_limbs_init(&blinded);
        bool skip = kat_rng_limbs(&rng, mn, &m) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_is_zero(m.v, m.len) || kat_is_one(&m);
        if (!skip) {
            size_t bn = 1 + (size_t)(rng_next(&rng) % 2);
            skip = kat_rng_limbs(&rng, bn, &base) != CRYPTON_OK;
        }
        if (!skip) {
            size_t elen = 1 + (size_t)(rng_next(&rng) % 2);
            skip = kat_rng_limbs(&rng, elen, &exp) != CRYPTON_OK;
        }
        if (!skip) skip = crypton_bigint_mod_pow(base.v, base.len, exp.v, exp.len, m.v, m.len, &plain) != CRYPTON_OK;
        for (uint64_t k = 1; k < 4 && !skip; k++) {
            crypton_limb bl[1];
            bl[0] = k * 0x9E3779B97F4A7C15ull + 3ull;
            crypton_status st = crypton_mod_pow_blind_with(base.v, base.len, exp.v, exp.len, m.v, m.len, bl, 1, &blinded);
            if (st == CRYPTON_NO_MODULAR_INVERSE) {
                crypton_limbs_free(&blinded);
                crypton_limbs_init(&blinded);
                continue;
            }
            if (st != CRYPTON_OK) {
                kat_fail("blinding_produces_identical_results/unexpected");
                skip = true;
            } else if (!kat_limbs_pair_eq(&blinded, &plain)) {
                kat_fail("blinding_produces_identical_results/value");
                skip = true;
            }
            crypton_limbs_free(&blinded);
            crypton_limbs_init(&blinded);
        }
        crypton_limbs_free(&m);
        crypton_limbs_free(&base);
        crypton_limbs_free(&exp);
        crypton_limbs_free(&plain);
        crypton_limbs_free(&blinded);
    }
}

static void test_differential_divmod_vs_u128(void)
{
    kat_rng rng;
    rng.s = 0x27BB2EE687B0B0FDull;
    for (size_t iter = 0; iter < 500; iter++) {
        uint64_t v = rng_next(&rng);
        uint64_t sh = rng_next(&rng) % 32;
        uint64_t a_hi = v >> sh;
        uint64_t a_lo = rng_next(&rng);
        unsigned __int128 a_val = ((unsigned __int128)a_hi << 64) | (unsigned __int128)a_lo;
        uint64_t bv = rng_next(&rng);
        unsigned __int128 b_val = (unsigned __int128)(bv | 1u);
        unsigned __int128 q_ref = a_val / b_val;
        unsigned __int128 r_ref = a_val % b_val;
        crypton_limbs a, b, q, r, ql, rl, q_expect, r_expect;
        crypton_limbs_init(&a);
        crypton_limbs_init(&b);
        crypton_limbs_init(&q);
        crypton_limbs_init(&r);
        crypton_limbs_init(&ql);
        crypton_limbs_init(&rl);
        crypton_limbs_init(&q_expect);
        crypton_limbs_init(&r_expect);
        crypton_limb avals[2];
        avals[0] = a_lo;
        avals[1] = a_hi;
        crypton_limb bvals[2];
        bvals[0] = (uint64_t)b_val;
        bvals[1] = (uint64_t)(b_val >> 64);
        bool skip = kat_limbs_of(avals, 2, &a) != CRYPTON_OK;
        if (!skip) skip = kat_limbs_of(bvals, 2, &b) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_is_zero(b.v, b.len);
        if (!skip) skip = crypton_bigint_divmod(a.v, a.len, b.v, b.len, &q, &r) != CRYPTON_OK;
        if (!skip) {
            crypton_limb qv[2];
            qv[0] = q.len > 0 ? q.v[0] : 0;
            qv[1] = q.len > 1 ? q.v[1] : 0;
            crypton_limb rv[2];
            rv[0] = r.len > 0 ? r.v[0] : 0;
            rv[1] = r.len > 1 ? r.v[1] : 0;
            crypton_limb qe[2];
            qe[0] = (uint64_t)q_ref;
            qe[1] = (uint64_t)(q_ref >> 64);
            crypton_limb re[2];
            re[0] = (uint64_t)r_ref;
            re[1] = (uint64_t)(r_ref >> 64);
            skip = kat_limbs_of(qv, 2, &ql) != CRYPTON_OK;
            if (!skip) skip = kat_limbs_of(rv, 2, &rl) != CRYPTON_OK;
            if (!skip) skip = kat_limbs_of(qe, 2, &q_expect) != CRYPTON_OK;
            if (!skip) skip = kat_limbs_of(re, 2, &r_expect) != CRYPTON_OK;
            bool ok = kat_limbs_pair_eq(&ql, &q_expect) && kat_limbs_pair_eq(&rl, &r_expect);
            if (!ok) kat_fail("differential_divmod_vs_u128");
        }
        crypton_limbs_free(&a);
        crypton_limbs_free(&b);
        crypton_limbs_free(&q);
        crypton_limbs_free(&r);
        crypton_limbs_free(&ql);
        crypton_limbs_free(&rl);
        crypton_limbs_free(&q_expect);
        crypton_limbs_free(&r_expect);
    }
}

static void test_differential_mod_pow_vs_u64_ladder(void)
{
    kat_rng rng;
    rng.s = 0x9FB21C651E98DF25ull;
    for (size_t iter = 0; iter < 300; iter++) {
        uint64_t m = rng_next(&rng) | 1u;
        if (m < 3) continue;
        uint64_t base = rng_next(&rng) % m;
        uint64_t e = rng_next(&rng) % 16u;
        uint64_t acc = 1 % m;
        uint64_t b = base % m;
        uint64_t ee = e;
        while (ee > 0) {
            if (ee & 1u) acc = (uint64_t)(((unsigned __int128)acc * (unsigned __int128)b) % (unsigned __int128)m);
            b = (uint64_t)(((unsigned __int128)b * (unsigned __int128)b) % (unsigned __int128)m);
            ee >>= 1;
        }
        crypton_limb bv[1];
        bv[0] = base;
        crypton_limb ev[1];
        ev[0] = e;
        crypton_limb mv[1];
        mv[0] = m;
        crypton_limbs got;
        crypton_limbs_init(&got);
        crypton_status st = crypton_bigint_mod_pow(bv, 1, ev, 1, mv, 1, &got);
        if (st != CRYPTON_OK) {
            kat_fail("differential_mod_pow_vs_u64_ladder/error");
        } else {
            bool ok = got.len == 1 && got.v[0] == acc;
            if (acc == 0) {
                crypton_limb zero[1];
                zero[0] = 0;
                ok = kat_limbs_eq(&got, zero, 1);
            }
            if (!ok) kat_fail("differential_mod_pow_vs_u64_ladder/value");
        }
        crypton_limbs_free(&got);
    }
}

static void test_differential_hmac_sha512_vs_ref(void)
{
    kat_rng rng;
    rng.s = 0x94D049BB133111EBull;
    uint8_t kbuf[200], dbuf[300];
    for (uint32_t acase = 0; acase < 50; acase++) {
        size_t klen = (acase * 5) % 200;
        size_t dlen = (acase * 13) % 300;
        for (size_t i = 0; i < klen; i++) kbuf[i] = (uint8_t)rng_next(&rng);
        for (size_t i = 0; i < dlen; i++) dbuf[i] = (uint8_t)rng_next(&rng);
        crypton_buf mac;
        crypton_buf_init(&mac);
        crypton_status st = crypton_hmac_sha512(kbuf, klen, dbuf, dlen, &mac);
        if (st != CRYPTON_OK) {
            kat_fail("differential_hmac_sha512_vs_ref/error");
            crypton_buf_free(&mac);
            continue;
        }
        uint8_t k[128];
        if (klen > 128) {
            crypton_sha512(kbuf, klen, k);
            cr_memset(k + 64, 0, 64);
        } else {
            cr_memcpy(k, kbuf, klen);
            cr_memset(k + klen, 0, 128 - klen);
        }
        uint8_t ipad[128], opad[128];
        for (size_t i = 0; i < 128; i++) {
            ipad[i] = (uint8_t)(k[i] ^ 0x36);
            opad[i] = (uint8_t)(k[i] ^ 0x5c);
        }
        crypton_buf inner, outer;
        crypton_buf_init(&inner);
        crypton_buf_init(&outer);
        crypton_status e1 = crypton_buf_append(&inner, ipad, 128);
        if (e1 == CRYPTON_OK) e1 = crypton_buf_append(&inner, dbuf, dlen);
        uint8_t ih[64];
        uint8_t refmac[64];
        bool err = e1 != CRYPTON_OK;
        if (!err) {
            crypton_sha512(inner.data, inner.len, ih);
            e1 = crypton_buf_append(&outer, opad, 128);
            if (e1 == CRYPTON_OK) e1 = crypton_buf_append(&outer, ih, 64);
            err = e1 != CRYPTON_OK;
        }
        if (!err) crypton_sha512(outer.data, outer.len, refmac);
        if (err || !crypton_ct_eq(mac.data, mac.len, refmac, 64)) kat_fail("differential_hmac_sha512_vs_ref/value");
        crypton_buf_free(&inner);
        crypton_buf_free(&outer);
        crypton_buf_free(&mac);
    }
}

static void test_reject_mod_pow_operand_over_cap(void)
{
    char huge[2051], max_ok[2049], over[2051];
    for (size_t i = 0; i < 1025; i++) {
        huge[2 * i] = 'a';
        huge[2 * i + 1] = 'b';
        over[2 * i] = 'f';
        over[2 * i + 1] = 'f';
        if (i < 1024) {
            max_ok[2 * i] = 'f';
            max_ok[2 * i + 1] = 'f';
        }
    }
    huge[2050] = 0;
    max_ok[2048] = 0;
    over[2050] = 0;
    crypton_buf o;
    crypton_buf_init(&o);
    bool ok = crypton_mod_pow_hex(huge, 2050, "2", 1, "ffffff", 6, &o) == CRYPTON_OPERAND_TOO_LARGE;
    crypton_buf_init(&o);
    ok = ok && crypton_mod_pow_hex("2", 1, huge, 2050, "ffffff", 6, &o) == CRYPTON_OPERAND_TOO_LARGE;
    crypton_buf_init(&o);
    ok = ok && crypton_mod_pow_hex("2", 1, "2", 1, huge, 2050, &o) == CRYPTON_OPERAND_TOO_LARGE;
    crypton_buf_init(&o);
    ok = ok && crypton_mod_pow_hex("2", 1, "3", 1, max_ok, 2048, &o) == CRYPTON_OK;
    crypton_buf_init(&o);
    ok = ok && crypton_mod_pow_hex("2", 1, "3", 1, over, 2050, &o) == CRYPTON_OPERAND_TOO_LARGE;
    crypton_buf_free(&o);
    if (!ok) kat_fail("reject_mod_pow_operand_over_cap");
}

static void test_differential_montgomery_vs_legacy_mod_pow(void)
{
    kat_rng rng;
    rng.s = 0x6364132238844343ull;
    for (size_t iter = 0; iter < 200; iter++) {
        size_t mlen = 1 + (size_t)(rng_next(&rng) % 4);
        crypton_limbs m, base, exp, via_mont, via_legacy;
        crypton_limbs_init(&m);
        crypton_limbs_init(&base);
        crypton_limbs_init(&exp);
        crypton_limbs_init(&via_mont);
        crypton_limbs_init(&via_legacy);
        bool skip = kat_rng_limbs(&rng, mlen, &m) != CRYPTON_OK;
        if (!skip) {
            m.v[0] |= 1;
            skip = crypton_bigint_is_zero(m.v, m.len) || kat_is_one(&m);
        }
        if (!skip) {
            size_t blen = 1 + (size_t)(rng_next(&rng) % 3);
            skip = kat_rng_limbs(&rng, blen, &base) != CRYPTON_OK;
        }
        if (!skip) {
            size_t elen = 1 + (size_t)(rng_next(&rng) % 2);
            skip = kat_rng_limbs(&rng, elen, &exp) != CRYPTON_OK;
        }
        if (!skip) skip = crypton_bigint_mod_pow(base.v, base.len, exp.v, exp.len, m.v, m.len, &via_mont) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_legacy_mod_pow(base.v, base.len, exp.v, exp.len, m.v, m.len, &via_legacy) != CRYPTON_OK;
        if (!skip && !kat_limbs_pair_eq(&via_mont, &via_legacy)) kat_fail("differential_montgomery_vs_legacy_mod_pow");
        crypton_limbs_free(&m);
        crypton_limbs_free(&base);
        crypton_limbs_free(&exp);
        crypton_limbs_free(&via_mont);
        crypton_limbs_free(&via_legacy);
    }
}

static void test_even_modulus_uses_legacy_path(void)
{
    crypton_limb mv[1];
    mv[0] = 0x30;
    crypton_limb bv[1];
    bv[0] = 2;
    crypton_limb ev[1];
    ev[0] = 8;
    crypton_limbs r;
    crypton_limbs_init(&r);
    crypton_status st = crypton_bigint_mod_pow(bv, 1, ev, 1, mv, 1, &r);
    crypton_limb sixteen[1];
    sixteen[0] = 16;
    if (st != CRYPTON_OK || !kat_limbs_eq(&r, sixteen, 1)) kat_fail("even_modulus_uses_legacy_path/small");
    crypton_limbs_free(&r);
    crypton_limb mv2[2];
    mv2[0] = 0x1234567890abcdefull;
    mv2[1] = 0xfedcba0987654320ull;
    crypton_limb b3[1];
    b3[0] = 3;
    crypton_limb e5[1];
    e5[0] = 5;
    crypton_limbs_init(&r);
    st = crypton_bigint_mod_pow(b3, 1, e5, 1, mv2, 2, &r);
    crypton_limb n3[1];
    n3[0] = 3;
    crypton_limb n27[1];
    n27[0] = 27;
    crypton_limbs p1, p2, expect, qtmp;
    crypton_limbs_init(&p1);
    crypton_limbs_init(&p2);
    crypton_limbs_init(&expect);
    crypton_limbs_init(&qtmp);
    bool skip = st != CRYPTON_OK;
    if (!skip) skip = crypton_bigint_mul(n3, 1, n3, 1, &p1) != CRYPTON_OK;
    if (!skip) skip = crypton_bigint_mul(p1.v, p1.len, n27, 1, &p2) != CRYPTON_OK;
    if (!skip) skip = crypton_bigint_divmod(p2.v, p2.len, mv2, 2, &qtmp, &expect) != CRYPTON_OK;
    crypton_limbs_free(&qtmp);
    if (!skip && !kat_limbs_pair_eq(&r, &expect)) kat_fail("even_modulus_uses_legacy_path/big");
    crypton_limbs_free(&r);
    crypton_limbs_free(&p1);
    crypton_limbs_free(&p2);
    crypton_limbs_free(&expect);
}

static const char *M2048 = "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aaac42dad33170d04507ab1";
static const char *EXP2048 = "8d9b670d0ceaecdad456f4f3ed98fc7db44bb07552297a09b059bafeee550e6301184313fff0dfbe50fbcd87bba3532563cc5f25aeb54da2099e6bfc2d6450f8ea2a8d48ace3c31606e250c7e20d9ee956e87ca36120c5a170f43c0d391a91c48cd03fd8e48bf291009da7406b91593ef081f12cfafbc7edc99df0689fe62021a71be54dde3b9ec8a9cbf7f4987dc144d7cb0d3a0894707894d97b2c496730f1811acc7e71325c8df2bae0bf314f2cd5de4fdffe39407037cd7a0e279aba3856eac2b036c1f844269f306f43b4f871598639dbe1601079b3130459cc19c709a518b66ec0caa35713ed93df790e0875465c24c1e4404c8bcf3245eb33d53e7047";
static const char *BIGEXP = "3f2a7c1d9b8e5f40617263748596a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e";

static void test_mod_pow_large_2048bit(void)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_mod_pow_hex("deadbeefcafebabe123456789abcdef04242424247474747", 48, "10001", 5, M2048, 512, &out);
    if (st != CRYPTON_OK || !kat_buf_str_eq(&out, EXP2048)) kat_fail("mod_pow_large_2048bit");
    crypton_buf_free(&out);
}

static void test_mont_2048_bit_matches_known_vector(void)
{
    crypton_buf r;
    crypton_buf_init(&r);
    crypton_status st = crypton_mod_pow_hex("deadbeefcafebabe123456789abcdef04242424247474747", 48, "10001", 5, M2048, 512, &r);
    bool ok = st == CRYPTON_OK && r.len == 512;
    crypton_buf_free(&r);
    crypton_limbs base, exp, mod, legacy_ref;
    crypton_limbs_init(&base);
    crypton_limbs_init(&exp);
    crypton_limbs_init(&mod);
    crypton_limbs_init(&legacy_ref);
    if (ok) {
        crypton_status s1 = crypton_hex_to_limbs("deadbeefcafebabe123456789abcdef04242424247474747", 48, &base);
        crypton_status s2 = crypton_hex_to_limbs("10001", 5, &exp);
        crypton_status s3 = crypton_hex_to_limbs(M2048, 512, &mod);
        crypton_status s4 = crypton_bigint_legacy_mod_pow(base.v, base.len, exp.v, exp.len, mod.v, mod.len, &legacy_ref);
        if (s1 != CRYPTON_OK || s2 != CRYPTON_OK || s3 != CRYPTON_OK || s4 != CRYPTON_OK) {
            kat_fail("mont_2048_bit_matches_known_vector/ref");
            ok = false;
        }
    }
    if (ok) {
        crypton_buf h;
        crypton_buf_init(&h);
        crypton_status s5 = crypton_limbs_to_hex(legacy_ref.v, legacy_ref.len, &h);
        crypton_buf_init(&r);
        st = crypton_mod_pow_hex("deadbeefcafebabe123456789abcdef04242424247474747", 48, "10001", 5, M2048, 512, &r);
        if (s5 != CRYPTON_OK || st != CRYPTON_OK) {
            kat_fail("mont_2048_bit_matches_known_vector/hex");
            ok = false;
        } else if (h.len != r.len || memcmp(h.data, r.data, h.len) != 0) {
            kat_fail("mont_2048_bit_matches_known_vector/value");
            ok = false;
        }
        crypton_buf_free(&h);
        crypton_buf_free(&r);
    }
    crypton_limbs_free(&base);
    crypton_limbs_free(&exp);
    crypton_limbs_free(&mod);
    crypton_limbs_free(&legacy_ref);
    if (ok) {
        crypton_buf r2;
        crypton_buf_init(&r2);
        crypton_status st2 = crypton_mod_pow_hex("deadbeefcafebabe123456789abcdef04242424247474747", 48, BIGEXP, strlen(BIGEXP), M2048, 512, &r2);
        if (st2 != CRYPTON_OK || r2.len == 0) kat_fail("mont_2048_bit_matches_known_vector/big_exp");
        crypton_buf_free(&r2);
    }
}

static void test_miller_rabin_known_values(void)
{
    static const struct {
        const char *h;
        uint32_t rounds;
        bool expect;
    } cases[7] = {
        {"2", 10, true},
        {"3", 10, true},
        {"ff", 10, false},
        {"100", 10, false},
        {"d3", 10, true},
        {"155", 10, false},
        {"451", 20, false},
    };
    bool ok = true;
    for (size_t i = 0; i < 7; i++) {
        bool r = false;
        crypton_status st = crypton_is_probably_prime(cases[i].h, (size_t)strlen(cases[i].h), cases[i].rounds, &r);
        ok = ok && st == CRYPTON_OK && r == cases[i].expect;
    }
    char h[16];
    kat_u64_hex((1ull << 31) - 1ull, h);
    bool r31 = false;
    crypton_status st = crypton_is_probably_prime(h, strlen(h), 40, &r31);
    ok = ok && st == CRYPTON_OK && r31;
    bool r2048 = false;
    st = crypton_is_probably_prime(M2048, 512, 40, &r2048);
    ok = ok && st == CRYPTON_OK && r2048;
    if (!ok) kat_fail("miller_rabin_known_values");
}

static void test_mr_rejects_perturbed_prime(void)
{
    char p[513];
    cr_memcpy(p, M2048, 512);
    p[512] = 0;
    size_t mid = 256;
    char cur = p[mid];
    const char *chars = "0123456789abcdef";
    const char *found = strchr(chars, cur);
    size_t idx = found && *found ? (size_t)(found - chars) : 0;
    size_t ni = (idx + 7) % 16;
    char nb = ni < 10 ? (char)('0' + ni) : (char)('a' + (ni - 10));
    p[mid] = nb;
    bool r = true;
    crypton_status st = crypton_is_probably_prime(p, 512, 40, &r);
    if (st != CRYPTON_OK || r) kat_fail("mr_rejects_perturbed_prime");
}

static void test_mr_handles_pow2_span_family(void)
{
    static const struct {
        const char *h;
        bool expect;
    } cases[5] = {
        {"83", true},
        {"d3", true},
        {"211", false},
        {"283", true},
        {"449", true},
    };
    bool ok = true;
    for (size_t i = 0; i < 5; i++) {
        bool r = false;
        crypton_status st = crypton_is_probably_prime(cases[i].h, strlen(cases[i].h), 40, &r);
        ok = ok && st == CRYPTON_OK && r == cases[i].expect;
    }
    if (!ok) kat_fail("mr_handles_pow2_span_family");
}

static void test_mod_pow_auto_blinds_even_modulus(void)
{
    crypton_limbs base, exp;
    crypton_limbs_init(&base);
    crypton_limbs_init(&exp);
    crypton_status s1 = crypton_hex_to_limbs("123456789abcdef0123456789abcdef0", 32, &base);
    crypton_status s2 = crypton_hex_to_limbs("1ffffffffffff", 13, &exp);
    bool ok = s1 == CRYPTON_OK && s2 == CRYPTON_OK;
    if (ok) {
        static const char *mods[3] = {"1000002", "10000000000000000000002", "deadc0de"};
        for (size_t i = 0; i < 3 && ok; i++) {
            crypton_limbs modulus, a;
            crypton_limbs_init(&modulus);
            crypton_limbs_init(&a);
            crypton_status s3 = crypton_hex_to_limbs(mods[i], strlen(mods[i]), &modulus);
            if (s3 != CRYPTON_OK) {
                ok = false;
            } else {
                crypton_status s4 = crypton_mod_pow_auto(base.v, base.len, exp.v, exp.len, modulus.v, modulus.len, &a);
                crypton_buf h1;
                crypton_buf_init(&h1);
                crypton_status s5 = s4 == CRYPTON_OK ? crypton_limbs_to_hex(a.v, a.len, &h1) : CRYPTON_OK;
                crypton_buf h2;
                crypton_buf_init(&h2);
                crypton_status s6 = crypton_mod_pow_hex("123456789abcdef0123456789abcdef0", 32, "1ffffffffffff", 13, mods[i], strlen(mods[i]), &h2);
                if (s4 != CRYPTON_OK || s5 != CRYPTON_OK || s6 != CRYPTON_OK) {
                    ok = false;
                } else if (h1.len != h2.len || memcmp(h1.data, h2.data, h1.len) != 0) {
                    kat_fail("mod_pow_auto_blinds_even_modulus");
                    ok = false;
                }
                crypton_buf_free(&h1);
                crypton_buf_free(&h2);
            }
            crypton_limbs_free(&modulus);
            crypton_limbs_free(&a);
        }
    }
    crypton_limbs_free(&base);
    crypton_limbs_free(&exp);
    if (!ok) kat_fail("mod_pow_auto_blinds_even_modulus/setup");
}

static void test_hex_operand_length_cap_rejected(void)
{
    char huge[4001];
    size_t n = 0;
    for (size_t i = 0; i < 2000; i++) {
        huge[n++] = 'a';
        huge[n++] = 'b';
    }
    huge[n] = 0;
    char ok_len[2049];
    n = 0;
    for (size_t i = 0; i < 1024; i++) {
        ok_len[n++] = 'a';
        ok_len[n++] = 'b';
    }
    ok_len[n] = 0;
    crypton_limbs l;
    crypton_limbs_init(&l);
    bool ok = crypton_hex_to_limbs(huge, 4000, &l) == CRYPTON_OPERAND_TOO_LARGE;
    crypton_limbs_init(&l);
    ok = ok && crypton_hex_to_limbs(ok_len, 2048, &l) == CRYPTON_OK;
    crypton_limbs_free(&l);
    if (!ok) kat_fail("hex_operand_length_cap_rejected");
}

static void test_fuzz_mul_divmod_adversarial_patterns(void)
{
    kat_rng rng;
    rng.s = 0xF00DCAFE12345678ull;
    static const uint64_t densities[4] = {
        ~(uint64_t)0,
        0x000000000000ffffull,
        0xffff000000000001ull,
        0x8000000000000000ull,
    };
    for (size_t round = 0; round < 3000; round++) {
        uint64_t d = densities[round % 4];
        size_t la = 1 + (size_t)(rng_next(&rng) % 40);
        size_t lb = 1 + (size_t)(rng_next(&rng) % 40);
        crypton_limbs a, b, q, r, qb, recon, prod_k, prod_s;
        crypton_limbs_init(&a);
        crypton_limbs_init(&b);
        crypton_limbs_init(&q);
        crypton_limbs_init(&r);
        crypton_limbs_init(&qb);
        crypton_limbs_init(&recon);
        crypton_limbs_init(&prod_k);
        crypton_limbs_init(&prod_s);
        bool skip = kat_rng_limbs_masked(&rng, la, d, &a) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_is_zero(a.v, a.len);
        if (!skip) skip = kat_rng_limbs_masked(&rng, lb, d, &b) != CRYPTON_OK;
        if (!skip) b.v[0] |= 1u;
        if (!skip) skip = crypton_bigint_is_zero(b.v, b.len);
        if (!skip && !crypton_bigint_cmp_lt(a.v, a.len, b.v, b.len)) {
            crypton_limbs t = a;
            a = b;
            b = t;
        }
        if (!skip) skip = crypton_bigint_is_zero(a.v, a.len);
        if (!skip) skip = crypton_bigint_divmod(a.v, a.len, b.v, b.len, &q, &r) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mul(q.v, q.len, b.v, b.len, &qb) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_add(qb.v, qb.len, r.v, r.len, &recon) != CRYPTON_OK;
        if (!skip && !kat_limbs_pair_eq(&recon, &a)) kat_fail("fuzz_mul_divmod_adversarial_patterns/recon");
        if (!skip && !crypton_bigint_cmp_lt(r.v, r.len, b.v, b.len)) kat_fail("fuzz_mul_divmod_adversarial_patterns/remainder_bound");
        if (!skip) skip = crypton_bigint_mul(a.v, a.len, b.v, b.len, &prod_k) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mul_schoolbook(a.v, a.len, b.v, b.len, &prod_s) != CRYPTON_OK;
        if (!skip && !kat_limbs_pair_eq(&prod_k, &prod_s)) kat_fail("fuzz_mul_divmod_adversarial_patterns/karatsuba_vs_schoolbook");
        crypton_limbs_free(&a);
        crypton_limbs_free(&b);
        crypton_limbs_free(&q);
        crypton_limbs_free(&r);
        crypton_limbs_free(&qb);
        crypton_limbs_free(&recon);
        crypton_limbs_free(&prod_k);
        crypton_limbs_free(&prod_s);
    }
}

static void test_fuzz_mod_pow_mont_vs_legacy_and_ladder(void)
{
    kat_rng rng;
    rng.s = 0xBAADF00DCAFEBABEull;
    for (size_t round = 0; round < 600; round++) {
        size_t ml = 1 + (size_t)(rng_next(&rng) % 3);
        crypton_limbs m, base, got, acc, prod, qt;
        crypton_limbs_init(&m);
        crypton_limbs_init(&base);
        crypton_limbs_init(&got);
        crypton_limbs_init(&acc);
        crypton_limbs_init(&prod);
        crypton_limbs_init(&qt);
        bool skip = kat_rng_limbs_masked(&rng, ml, ~(uint64_t)0, &m) != CRYPTON_OK;
        if (!skip) {
            m.v[0] |= 1u;
            skip = crypton_bigint_is_zero(m.v, m.len) || kat_is_one(&m);
        }
        if (!skip) {
            size_t blen = 1 + (size_t)(rng_next(&rng) % 2);
            skip = kat_rng_limbs_masked(&rng, blen, ~(uint64_t)0, &base) != CRYPTON_OK;
        }
        uint64_t e = 0;
        if (!skip) e = rng_next(&rng) % 12u;
        if (!skip) {
            crypton_limb ev[1];
            ev[0] = e;
            skip = crypton_bigint_mod_pow(base.v, base.len, ev, 1, m.v, m.len, &got) != CRYPTON_OK;
        }
        if (!skip) {
            crypton_status st = crypton_limbs_resize(&acc, 1, 0);
            if (st == CRYPTON_OK) {
                acc.v[0] = 1;
                acc.len = 1;
            }
            skip = st != CRYPTON_OK;
        }
        bool err = skip;
        for (uint64_t it2 = 0; it2 < e && !err; it2++) {
            err = crypton_bigint_mul(acc.v, acc.len, base.v, base.len, &prod) != CRYPTON_OK;
            if (!err) {
                crypton_limbs old = acc;
                crypton_limbs_init(&acc);
                err = crypton_bigint_divmod(prod.v, prod.len, m.v, m.len, &qt, &acc) != CRYPTON_OK;
                crypton_limbs_free(&old);
            }
            crypton_limbs_free(&prod);
            crypton_limbs_init(&prod);
        }
        if (!err && !kat_limbs_pair_eq(&got, &acc)) kat_fail("fuzz_mod_pow_mont_vs_legacy_and_ladder/legacy_ref");
        crypton_limbs_free(&acc);
        crypton_limbs_init(&acc);
        if (!err && m.len == 1 && base.len == 1) {
            uint64_t mv = m.v[0];
            uint64_t acc_u = 1 % mv;
            uint64_t b_u = base.v[0] % mv;
            uint64_t ee = e;
            while (ee > 0) {
                if (ee & 1u) acc_u = (uint64_t)(((unsigned __int128)acc_u * (unsigned __int128)b_u) % (unsigned __int128)mv);
                b_u = (uint64_t)(((unsigned __int128)b_u * (unsigned __int128)b_u) % (unsigned __int128)mv);
                ee >>= 1;
            }
            crypton_limb lv[1];
            lv[0] = acc_u;
            if (!kat_limbs_eq(&got, lv, 1)) kat_fail("fuzz_mod_pow_mont_vs_legacy_and_ladder/ladder");
        }
        crypton_limbs_free(&m);
        crypton_limbs_free(&base);
        crypton_limbs_free(&got);
        crypton_limbs_free(&acc);
        crypton_limbs_free(&prod);
        crypton_limbs_free(&qt);
    }
}

static void test_fuzz_mr_agrees_with_trial_division_small(void)
{
    kat_rng rng;
    rng.s = 0x123456789ABCDEF0ull;
    char h[16];
    bool ok = true;
    for (uint64_t n = 2; n < 20000 && ok; n++) {
        (void)rng_next(&rng);
        kat_u64_hex(n, h);
        bool mr = false;
        crypton_status st = crypton_is_probably_prime(h, strlen(h), 5, &mr);
        if (st != CRYPTON_OK) {
            kat_fail("fuzz_mr_agrees_with_trial_division_small/error");
            ok = false;
            break;
        }
        bool is_prime = n >= 2;
        for (uint64_t p = 2; p * p <= n; p++) {
            if (n % p == 0) {
                is_prime = n == p;
                break;
            }
        }
        if (n <= 3) is_prime = n >= 2;
        if (mr != is_prime) {
            kat_fail("fuzz_mr_agrees_with_trial_division_small/agreement");
            ok = false;
        }
    }
}

static void test_mr_rejects_known_two_prime_composites(void)
{
    static const uint64_t composites[3] = {10403ull, 25326001ull, 3215031751ull};
    bool ok = true;
    for (size_t i = 0; i < 3 && ok; i++) {
        char h[16];
        kat_u64_hex(composites[i], h);
        bool r = true;
        crypton_status st = crypton_is_probably_prime(h, strlen(h), 40, &r);
        ok = ok && st == CRYPTON_OK && !r;
    }
    if (!ok) kat_fail("mr_rejects_known_two_prime_composites");
}

static void test_fuzz_seal_open_randomized(void)
{
    kat_rng rng;
    rng.s = 0xFEEDFACEC0FFEE00ull;
    uint8_t mac_key[32], enc_key[32];
    for (size_t i = 0; i < 32; i++) mac_key[i] = (uint8_t)rng_next(&rng);
    for (size_t i = 0; i < 32; i++) enc_key[i] = (uint8_t)rng_next(&rng);
    uint8_t pt[512], tam[560];
    for (size_t round = 0; round < 60; round++) {
        size_t len = ((round * 37) % 512 + 16) & (size_t)~15;
        for (size_t i = 0; i < len; i++) pt[i] = (uint8_t)(i ^ round);
        crypton_buf sealed;
        crypton_buf_init(&sealed);
        crypton_status st = crypton_cbc_seal(mac_key, 32, enc_key, 32, pt, len, &sealed);
        if (st != CRYPTON_OK) {
            kat_fail("fuzz_seal_open_randomized/seal");
            crypton_buf_free(&sealed);
            return;
        }
        crypton_buf opened;
        crypton_buf_init(&opened);
        st = crypton_cbc_open(mac_key, 32, enc_key, 32, sealed.data, sealed.len, &opened);
        if (st != CRYPTON_OK || opened.len != len || memcmp(opened.data, pt, len) != 0) kat_fail("fuzz_seal_open_randomized/roundtrip");
        crypton_buf_free(&opened);
        size_t pos = (size_t)(rng_next(&rng) % sealed.len);
        cr_memcpy(tam, sealed.data, sealed.len);
        tam[pos] ^= 1;
        crypton_buf o2;
        crypton_buf_init(&o2);
        crypton_status st2 = crypton_cbc_open(mac_key, 32, enc_key, 32, tam, sealed.len, &o2);
        crypton_buf_free(&o2);
        if (st2 == CRYPTON_OK) kat_fail("fuzz_seal_open_randomized/tamper");
        crypton_buf_free(&sealed);
    }
}

static void test_scratch_mont_ctx(void)
{
    kat_rng rng;
    rng.s = 0x1111222233334444ull;
    for (size_t it = 0; it < 300; it++) {
        size_t ml = 1 + (size_t)(rng_next(&rng) % 4);
        crypton_limbs m, a, b, q, ared, am, bred, bm, cm, mulab, want;
        crypton_mont_ctx ctx;
        crypton_limbs_init(&m);
        crypton_limbs_init(&a);
        crypton_limbs_init(&b);
        crypton_limbs_init(&q);
        crypton_limbs_init(&ared);
        crypton_limbs_init(&am);
        crypton_limbs_init(&bred);
        crypton_limbs_init(&bm);
        crypton_limbs_init(&cm);
        crypton_limbs_init(&mulab);
        crypton_limbs_init(&want);
        ctx.n = 0;
        ctx.m = NULL;
        ctx.n0 = 0;
        ctx.r1 = NULL;
        ctx.r2 = NULL;
        bool skip = kat_rng_limbs(&rng, ml, &m) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_is_zero(m.v, m.len);
        if (!skip) m.v[0] |= 1u;
        if (!skip) skip = !crypton_mont_ctx_new(m.v, m.len, &ctx);
        if (!skip) {
            size_t bl = 1 + (size_t)(rng_next(&rng) % 3);
            crypton_status st = kat_rng_limbs_raw(&rng, bl, &a);
            while (st == CRYPTON_OK && crypton_bigint_is_zero(a.v, a.len)) {
                crypton_limbs_free(&a);
                crypton_limbs_init(&a);
                st = kat_rng_limbs_raw(&rng, bl, &a);
            }
            skip = st != CRYPTON_OK;
        }
        if (!skip) skip = kat_rng_limbs_raw(&rng, ml, &b) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_divmod(a.v, a.len, m.v, m.len, &q, &ared) != CRYPTON_OK;
        crypton_limbs_free(&q);
        crypton_limbs_init(&q);
        if (!skip) skip = crypton_mont_to_mont(&ctx, ared.v, ared.len, &am) != CRYPTON_OK;
        if (!skip) {
            crypton_limbs rt;
            crypton_limbs_init(&rt);
            crypton_status st = crypton_mont_from_mont(&ctx, am.v, am.len, &rt);
            if (st != CRYPTON_OK) {
                skip = true;
            } else {
                crypton_limbs_trim(&rt);
                if (!kat_limbs_pair_eq(&rt, &ared)) kat_fail("scratch_mont_ctx/roundtrip");
            }
            crypton_limbs_free(&rt);
        }
        if (!skip) skip = crypton_bigint_divmod(b.v, b.len, m.v, m.len, &q, &bred) != CRYPTON_OK;
        crypton_limbs_free(&q);
        crypton_limbs_init(&q);
        if (!skip) skip = crypton_mont_to_mont(&ctx, bred.v, bred.len, &bm) != CRYPTON_OK;
        if (!skip) skip = crypton_mont_mul(&ctx, am.v, am.len, bm.v, bm.len, &cm) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mul(a.v, a.len, b.v, b.len, &mulab) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_divmod(mulab.v, mulab.len, m.v, m.len, &q, &want) != CRYPTON_OK;
        crypton_limbs_free(&q);
        crypton_limbs_init(&q);
        if (!skip) {
            crypton_limbs out_r;
            crypton_limbs_init(&out_r);
            crypton_status st = crypton_mont_from_mont(&ctx, cm.v, cm.len, &out_r);
            if (st != CRYPTON_OK) {
                skip = true;
            } else {
                crypton_limbs_trim(&out_r);
                if (!kat_limbs_pair_eq(&out_r, &want)) kat_fail("scratch_mont_ctx/mont_mul");
            }
            crypton_limbs_free(&out_r);
        }
        crypton_limbs_free(&m);
        crypton_limbs_free(&a);
        crypton_limbs_free(&b);
        crypton_limbs_free(&q);
        crypton_limbs_free(&ared);
        crypton_limbs_free(&am);
        crypton_limbs_free(&bred);
        crypton_limbs_free(&bm);
        crypton_limbs_free(&cm);
        crypton_limbs_free(&mulab);
        crypton_limbs_free(&want);
        crypton_mont_ctx_free(&ctx);
    }
}

static void test_scratch_mul_diff(void)
{
    kat_rng rng;
    rng.s = 0xABCDEF1234567890ull;
    for (size_t it = 0; it < 400; it++) {
        size_t la = 1 + (size_t)(rng_next(&rng) % 40);
        size_t lb = 1 + (size_t)(rng_next(&rng) % 40);
        crypton_limbs a, b, got, want;
        crypton_limbs_init(&a);
        crypton_limbs_init(&b);
        crypton_limbs_init(&got);
        crypton_limbs_init(&want);
        bool skip = kat_rng_limbs_raw(&rng, la, &a) != CRYPTON_OK;
        if (!skip) skip = kat_rng_limbs_raw(&rng, lb, &b) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mul(a.v, a.len, b.v, b.len, &got) != CRYPTON_OK;
        if (!skip) skip = crypton_bigint_mul_schoolbook(a.v, a.len, b.v, b.len, &want) != CRYPTON_OK;
        if (!skip && !kat_limbs_pair_eq(&got, &want)) kat_fail("scratch_mul_diff");
        crypton_limbs_free(&a);
        crypton_limbs_free(&b);
        crypton_limbs_free(&got);
        crypton_limbs_free(&want);
    }
}

static void test_wasm_wrappers_return_results(void)
{
    uint8_t key[32], pt[16];
    kat_hex_bytes(K1, key);
    kat_hex_bytes(PT1, pt);
    crypton_buf ct;
    crypton_buf_init(&ct);
    crypton_status st = crypton_ecb_encrypt(key, 32, pt, 16, &ct);
    crypton_buf back;
    crypton_buf_init(&back);
    crypton_status st2 = st == CRYPTON_OK ? crypton_ecb_decrypt(key, 32, ct.data, ct.len, &back) : CRYPTON_OK;
    bool ok = st == CRYPTON_OK && st2 == CRYPTON_OK && back.len == 16 && memcmp(back.data, pt, 16) == 0;
    crypton_buf_free(&back);
    crypton_buf_free(&ct);
    crypton_buf_init(&ct);
    st = crypton_ecb_encrypt(key, 32, pt, 3, &ct);
    ok = ok && st == CRYPTON_INPUT_NOT_ALIGNED;
    crypton_buf_free(&ct);
    crypton_buf_init(&ct);
    st = crypton_mod_pow_hex("2", 1, "10", 2, "100", 3, &ct);
    ok = ok && st == CRYPTON_OK && kat_buf_str_eq(&ct, "0");
    crypton_buf_free(&ct);
    if (!ok) kat_fail("wasm_wrappers_return_results");
}

int crypton_run_kat(void)
{
    kat_failures = 0;
    test_aes256_ecb_nist_vector();
    test_aes256_block_fips197();
    test_aes256_ecb_roundtrip_large();
    test_aes256_cbc_roundtrip();
    test_aes256_ige_roundtrip();
    test_aes256_ctr_offset_consistency();
    test_sha1_rfc3174();
    test_sha1_empty();
    test_sha256_fips180();
    test_sha256_empty();
    test_hmac_sha256_rfc4231();
    test_hmac_sha512_jefe();
    test_hkdf_deterministic();
    test_hkdf_max_length_ok();
    test_pbkdf2_lengths();
    test_mod_pow_basic();
    test_mod_pow_modulus_one();
    test_mod_pow_large();
    test_bigint_hex_roundtrip();
    test_sha512_known_vector_abc();
    test_sha512_known_vector_empty();
    test_pbkdf2_vectors();
    test_get_random_bytes_length_and_uniqueness();
    test_get_random_bytes_large_chunked();
    test_aes256_cbc_nist_vector();
    test_aes256_ctr_nist_vector();
    test_ctr_counter_wraparound();
    test_ecb_empty();
    test_cbc_empty();
    test_ige_single_block();
    test_hmac_sha256_empty_data();
    test_hmac_sha512_long_key();
    test_mod_pow_unary();
    test_sha256_multi_block();
    test_mod_pow_medium_multi_limb();
    test_mod_pow_large_2048bit();
    test_reject_bad_key_length();
    test_reject_bad_iv_lengths();
    test_reject_unaligned_input();
    test_reject_modulus_zero();
    test_reject_invalid_hex();
    test_hex_prefix_and_case();
    test_reject_pbkdf2_zero_iterations();
    test_wasm_wrappers_return_results();
    test_reject_pbkdf2_dk_len_over_cap();
    test_reject_rng_over_cap();
    test_ctr_large_offset_streaming();
    test_key_expansion_rejects_bad_length();
    test_prop_divmod_identity();
    test_prop_mod_pow_matches_bruteforce();
    test_prop_mod_pow_homomorphism();
    test_prop_hex_roundtrip_random();
    test_prop_mod_inv_known_case();
    test_prop_mod_inv_random_pairs();
    test_etm_roundtrip_and_tamper();
    test_blinding_produces_identical_results();
    test_differential_divmod_vs_u128();
    test_differential_mod_pow_vs_u64_ladder();
    test_differential_hmac_sha512_vs_ref();
    test_reject_mod_pow_operand_over_cap();
    test_differential_montgomery_vs_legacy_mod_pow();
    test_even_modulus_uses_legacy_path();
    test_mont_2048_bit_matches_known_vector();
    test_seal_open_roundtrip();
    test_miller_rabin_known_values();
    test_mr_rejects_perturbed_prime();
    test_mod_pow_auto_blinds_even_modulus();
    test_hex_operand_length_cap_rejected();
    test_mr_handles_pow2_span_family();
    test_fuzz_mul_divmod_adversarial_patterns();
    test_fuzz_mod_pow_mont_vs_legacy_and_ladder();
    test_fuzz_mr_agrees_with_trial_division_small();
    test_mr_rejects_known_two_prime_composites();
    test_fuzz_seal_open_randomized();
    test_scratch_mont_ctx();
    test_scratch_mul_diff();
    return kat_failures;
}







