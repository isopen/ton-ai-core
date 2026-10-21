#include "crypton.h"

#ifdef __wasm__

#define CR_DATA_CAP ((uint32_t)1 << 20)

static uint8_t cr_block[12 + CR_DATA_CAP];

static void cr_store(crypton_status st, const uint8_t *src, size_t len)
{
    uint32_t flen = (uint32_t)len;
    if (st == CRYPTON_OK && flen > CR_DATA_CAP) st = CRYPTON_OUTPUT_TOO_LARGE;
    cr_block[0] = (uint8_t)(st & 0xffu);
    cr_block[1] = 0;
    cr_block[2] = 0;
    cr_block[3] = 0;
    cr_block[4] = (uint8_t)(flen & 0xffu);
    cr_block[5] = (uint8_t)((flen >> 8) & 0xffu);
    cr_block[6] = (uint8_t)((flen >> 16) & 0xffu);
    cr_block[7] = (uint8_t)((flen >> 24) & 0xffu);
    cr_block[8] = (uint8_t)(CR_DATA_CAP & 0xffu);
    cr_block[9] = (uint8_t)((CR_DATA_CAP >> 8) & 0xffu);
    cr_block[10] = (uint8_t)((CR_DATA_CAP >> 16) & 0xffu);
    cr_block[11] = (uint8_t)((CR_DATA_CAP >> 24) & 0xffu);
    if (st == CRYPTON_OK) {
        cr_memcpy(cr_block + 12, src, len);
        return;
    }
    cr_block[4] = 0;
    cr_block[5] = 0;
    cr_block[6] = 0;
    cr_block[7] = 0;
}

__attribute__((export_name("crw_alloc"))) void *crw_alloc(uint32_t n)
{
    return cr_alloc((size_t)n);
}

__attribute__((export_name("crw_free"))) void crw_free(void *ptr, uint32_t n)
{
    cr_free(ptr, (size_t)n);
}

__attribute__((export_name("crw_result_ptr"))) uint32_t crw_result_ptr(void)
{
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_kat"))) int32_t crw_kat(void)
{
    return (int32_t)crypton_run_kat();
}

__attribute__((export_name("crw_get_random_bytes"))) uint32_t crw_get_random_bytes(uint32_t len)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_get_random_bytes((size_t)len, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

static uint32_t cr_hash_op(void (*fn)(const uint8_t *, size_t, uint8_t *), uint32_t dp, uint32_t dl, uint32_t outlen)
{
    uint8_t digest[64];
    fn((const uint8_t *)(uintptr_t)dp, (size_t)dl, digest);
    cr_store(CRYPTON_OK, digest, outlen);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_sha1_hash"))) uint32_t crw_sha1_hash(uint32_t dp, uint32_t dl)
{
    return cr_hash_op(crypton_sha1, dp, dl, 20);
}

__attribute__((export_name("crw_sha256_hash"))) uint32_t crw_sha256_hash(uint32_t dp, uint32_t dl)
{
    return cr_hash_op(crypton_sha256, dp, dl, 32);
}

__attribute__((export_name("crw_sha512_hash"))) uint32_t crw_sha512_hash(uint32_t dp, uint32_t dl)
{
    return cr_hash_op(crypton_sha512, dp, dl, 64);
}

__attribute__((export_name("crw_hmac_sha256"))) uint32_t crw_hmac_sha256(uint32_t kp, uint32_t kl, uint32_t dp, uint32_t dl)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_hmac_sha256((const uint8_t *)(uintptr_t)kp, (size_t)kl, (const uint8_t *)(uintptr_t)dp, (size_t)dl, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_hmac_sha512"))) uint32_t crw_hmac_sha512(uint32_t kp, uint32_t kl, uint32_t dp, uint32_t dl)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_hmac_sha512((const uint8_t *)(uintptr_t)kp, (size_t)kl, (const uint8_t *)(uintptr_t)dp, (size_t)dl, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_hkdf_sha512_extract"))) uint32_t crw_hkdf_sha512_extract(uint32_t sp, uint32_t sl, uint32_t ip, uint32_t il)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_hkdf_sha512_extract((const uint8_t *)(uintptr_t)sp, (size_t)sl, (const uint8_t *)(uintptr_t)ip, (size_t)il, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_hkdf_sha512_expand"))) uint32_t crw_hkdf_sha512_expand(uint32_t pp, uint32_t pl, uint32_t ip, uint32_t il, uint32_t len)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_hkdf_sha512_expand((const uint8_t *)(uintptr_t)pp, (size_t)pl, (const uint8_t *)(uintptr_t)ip, (size_t)il, (size_t)len, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_pbkdf2_sha256"))) uint32_t crw_pbkdf2_sha256(uint32_t pp, uint32_t pl, uint32_t sp, uint32_t sl, uint32_t iters, uint32_t dklen)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_pbkdf2_sha256((const uint8_t *)(uintptr_t)pp, (size_t)pl, (const uint8_t *)(uintptr_t)sp, (size_t)sl, (size_t)iters, (size_t)dklen, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_mod_pow"))) uint32_t crw_mod_pow(uint32_t bp, uint32_t bl, uint32_t ep, uint32_t el, uint32_t mp, uint32_t ml)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_mod_pow_hex((const char *)(uintptr_t)bp, (size_t)bl, (const char *)(uintptr_t)ep, (size_t)el, (const char *)(uintptr_t)mp, (size_t)ml, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_is_probably_prime"))) uint32_t crw_is_probably_prime(uint32_t np, uint32_t nl, uint32_t rounds)
{
    bool r = false;
    crypton_status st = crypton_is_probably_prime((const char *)(uintptr_t)np, (size_t)nl, rounds, &r);
    if (st == CRYPTON_OK) {
        uint8_t b = r ? 1u : 0u;
        cr_store(st, &b, 1);
    } else {
        cr_store(st, 0, 0);
    }
    return (uint32_t)(uintptr_t)cr_block;
}

static uint32_t cr_aes_op(crypton_status (*fn)(const uint8_t *, size_t, const uint8_t *, size_t, crypton_buf *), uint32_t kp, uint32_t kl, uint32_t dp, uint32_t dl)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = fn((const uint8_t *)(uintptr_t)kp, (size_t)kl, (const uint8_t *)(uintptr_t)dp, (size_t)dl, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_aes256_ecb_encrypt"))) uint32_t crw_aes256_ecb_encrypt(uint32_t kp, uint32_t kl, uint32_t dp, uint32_t dl)
{
    return cr_aes_op(crypton_ecb_encrypt, kp, kl, dp, dl);
}

__attribute__((export_name("crw_aes256_ecb_decrypt"))) uint32_t crw_aes256_ecb_decrypt(uint32_t kp, uint32_t kl, uint32_t dp, uint32_t dl)
{
    return cr_aes_op(crypton_ecb_decrypt, kp, kl, dp, dl);
}

static uint32_t cr_cbc_op(crypton_status (*fn)(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, crypton_buf *), uint32_t kp, uint32_t kl, uint32_t ip, uint32_t il, uint32_t dp, uint32_t dl)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = fn((const uint8_t *)(uintptr_t)kp, (size_t)kl, (const uint8_t *)(uintptr_t)ip, (size_t)il, (const uint8_t *)(uintptr_t)dp, (size_t)dl, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_aes256_cbc_encrypt"))) uint32_t crw_aes256_cbc_encrypt(uint32_t kp, uint32_t kl, uint32_t ip, uint32_t il, uint32_t dp, uint32_t dl)
{
    return cr_cbc_op(crypton_cbc_encrypt, kp, kl, ip, il, dp, dl);
}

__attribute__((export_name("crw_aes256_cbc_decrypt"))) uint32_t crw_aes256_cbc_decrypt(uint32_t kp, uint32_t kl, uint32_t ip, uint32_t il, uint32_t dp, uint32_t dl)
{
    return cr_cbc_op(crypton_cbc_decrypt, kp, kl, ip, il, dp, dl);
}

static uint32_t cr_etm_op(crypton_status (*fn)(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, crypton_buf *), uint32_t mk, uint32_t mkl, uint32_t ek, uint32_t ekl, uint32_t ip, uint32_t il, uint32_t dp, uint32_t dl)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = fn((const uint8_t *)(uintptr_t)mk, (size_t)mkl, (const uint8_t *)(uintptr_t)ek, (size_t)ekl, (const uint8_t *)(uintptr_t)ip, (size_t)il, (const uint8_t *)(uintptr_t)dp, (size_t)dl, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_aes256_cbc_encrypt_etm"))) uint32_t crw_aes256_cbc_encrypt_etm(uint32_t mk, uint32_t mkl, uint32_t ek, uint32_t ekl, uint32_t ip, uint32_t il, uint32_t dp, uint32_t dl)
{
    return cr_etm_op(crypton_cbc_encrypt_etm, mk, mkl, ek, ekl, ip, il, dp, dl);
}

__attribute__((export_name("crw_aes256_cbc_decrypt_etm"))) uint32_t crw_aes256_cbc_decrypt_etm(uint32_t mk, uint32_t mkl, uint32_t ek, uint32_t ekl, uint32_t ip, uint32_t il, uint32_t dp, uint32_t dl)
{
    return cr_etm_op(crypton_cbc_decrypt_etm, mk, mkl, ek, ekl, ip, il, dp, dl);
}

__attribute__((export_name("crw_aes256_cbc_seal"))) uint32_t crw_aes256_cbc_seal(uint32_t mk, uint32_t mkl, uint32_t ek, uint32_t ekl, uint32_t dp, uint32_t dl)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_cbc_seal((const uint8_t *)(uintptr_t)mk, (size_t)mkl, (const uint8_t *)(uintptr_t)ek, (size_t)ekl, (const uint8_t *)(uintptr_t)dp, (size_t)dl, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_aes256_cbc_open"))) uint32_t crw_aes256_cbc_open(uint32_t mk, uint32_t mkl, uint32_t ek, uint32_t ekl, uint32_t dp, uint32_t dl)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_cbc_open((const uint8_t *)(uintptr_t)mk, (size_t)mkl, (const uint8_t *)(uintptr_t)ek, (size_t)ekl, (const uint8_t *)(uintptr_t)dp, (size_t)dl, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

static uint32_t cr_ige_op(crypton_status (*fn)(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, crypton_buf *), uint32_t dp, uint32_t dl, uint32_t kp, uint32_t kl, uint32_t ip, uint32_t il)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = fn((const uint8_t *)(uintptr_t)dp, (size_t)dl, (const uint8_t *)(uintptr_t)kp, (size_t)kl, (const uint8_t *)(uintptr_t)ip, (size_t)il, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

__attribute__((export_name("crw_aes256_ige_encrypt"))) uint32_t crw_aes256_ige_encrypt(uint32_t dp, uint32_t dl, uint32_t kp, uint32_t kl, uint32_t ip, uint32_t il)
{
    return cr_ige_op(crypton_ige_encrypt, dp, dl, kp, kl, ip, il);
}

__attribute__((export_name("crw_aes256_ige_decrypt"))) uint32_t crw_aes256_ige_decrypt(uint32_t dp, uint32_t dl, uint32_t kp, uint32_t kl, uint32_t ip, uint32_t il)
{
    return cr_ige_op(crypton_ige_decrypt, dp, dl, kp, kl, ip, il);
}

__attribute__((export_name("crw_aes256_ctr_process"))) uint32_t crw_aes256_ctr_process(uint32_t dp, uint32_t dl, uint32_t kp, uint32_t kl, uint32_t ip, uint32_t il, int64_t byte_offset)
{
    crypton_buf out;
    crypton_buf_init(&out);
    crypton_status st = crypton_ctr_process((const uint8_t *)(uintptr_t)dp, (size_t)dl, (const uint8_t *)(uintptr_t)kp, (size_t)kl, (const uint8_t *)(uintptr_t)ip, (size_t)il, (uint64_t)byte_offset, &out);
    if (st == CRYPTON_OK) cr_store(st, out.data, out.len);
    else cr_store(st, 0, 0);
    crypton_buf_free(&out);
    return (uint32_t)(uintptr_t)cr_block;
}

#endif
