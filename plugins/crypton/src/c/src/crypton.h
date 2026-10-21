#ifndef CRYPTON_H
#define CRYPTON_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    CRYPTON_OK = 0,
    CRYPTON_INVALID_KEY_LENGTH,
    CRYPTON_INVALID_IV_LENGTH,
    CRYPTON_INPUT_NOT_ALIGNED,
    CRYPTON_EMPTY_HEX,
    CRYPTON_INVALID_HEX_CHAR,
    CRYPTON_DIVISION_BY_ZERO,
    CRYPTON_MODULUS_IS_ZERO,
    CRYPTON_ZERO_ITERATIONS,
    CRYPTON_TOO_MANY_ITERATIONS,
    CRYPTON_DERIVED_KEY_TOO_LONG,
    CRYPTON_RANDOM_TOO_LARGE,
    CRYPTON_AUTHENTICATION_FAILURE,
    CRYPTON_NO_MODULAR_INVERSE,
    CRYPTON_BLINDING_EXHAUSTED,
    CRYPTON_OPERAND_TOO_LARGE,
    CRYPTON_ENTROPY_FAILURE,
    CRYPTON_INVALID_ROUNDS,
    CRYPTON_ARITHMETIC_VIOLATION,
    CRYPTON_OUTPUT_TOO_LARGE
} crypton_status;

enum {
    CRYPTON_MAX_RANDOM_CHUNK = 65536,
    CRYPTON_MAX_RANDOM_BYTES = 1 << 20,
    CRYPTON_MAX_DERIVED_LEN = 255 * 64,
    CRYPTON_MAX_MODPOW_LIMBS = 128,
    CRYPTON_MAX_HEX_DIGITS = CRYPTON_MAX_MODPOW_LIMBS * 16 + 2,
    CRYPTON_MAX_PBKDF2_ITERATIONS = 10000000
};

typedef struct {
    uint8_t *data;
    size_t len;
    size_t cap;
} crypton_buf;

typedef uint64_t crypton_limb;

typedef struct {
    crypton_limb *v;
    size_t len;
    size_t cap;
} crypton_limbs;

typedef struct {
    size_t n;
    crypton_limb *m;
    crypton_limb n0;
    crypton_limb *r1;
    crypton_limb *r2;
} crypton_mont_ctx;

const char *crypton_status_string(crypton_status status);

void crypton_wipe(void *ptr, size_t len);
bool crypton_ct_eq(const uint8_t *a, size_t alen, const uint8_t *b, size_t blen);

void *cr_alloc(size_t size);
void *cr_realloc(void *ptr, size_t old_size, size_t new_size);
void cr_free(void *ptr, size_t size);

void cr_memset(void *dst, uint8_t value, size_t len);
void cr_memcpy(void *dst, const void *src, size_t len);
void cr_mul64(uint64_t a, uint64_t b, uint64_t *lo, uint64_t *hi);

crypton_status crypton_random_fill(uint8_t *dst, size_t n);

static inline void cr_compiler_fence(void)
{
    __asm__ __volatile__ ("" ::: "memory");
}

void crypton_buf_init(crypton_buf *buf);
void crypton_buf_free(crypton_buf *buf);
crypton_status crypton_buf_reserve(crypton_buf *buf, size_t need);
crypton_status crypton_buf_append(crypton_buf *buf, const uint8_t *src, size_t len);
void crypton_buf_truncate(crypton_buf *buf, size_t len);

void crypton_limbs_init(crypton_limbs *v);
void crypton_limbs_free(crypton_limbs *v);
crypton_status crypton_limbs_reserve(crypton_limbs *v, size_t need);
crypton_status crypton_limbs_resize(crypton_limbs *v, size_t need, crypton_limb fill);
void crypton_limbs_trim(crypton_limbs *v);

crypton_status crypton_get_random_bytes(size_t len, crypton_buf *out);

uint8_t crypton_aes_sbox_byte(uint8_t b);
uint8_t crypton_aes_inv_sbox_byte(uint8_t y);
crypton_status crypton_aes_key_expansion(const uint8_t *key, size_t key_len, uint8_t round_keys[15][16]);
void crypton_aes256_encrypt_block(const uint8_t rk[15][16], uint8_t block[16]);
void crypton_aes256_decrypt_block(const uint8_t rk[15][16], uint8_t block[16]);

void crypton_sha1(const uint8_t *data, size_t len, uint8_t out[20]);
void crypton_sha256(const uint8_t *data, size_t len, uint8_t out[32]);
void crypton_sha512(const uint8_t *data, size_t len, uint8_t out[64]);

bool crypton_bigint_is_zero(const crypton_limb *a, size_t an);
bool crypton_bigint_cmp_lt(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn);
int crypton_bigint_cmp(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn);
crypton_status crypton_bigint_add(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out);
crypton_status crypton_bigint_sub(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out);
crypton_status crypton_bigint_mul(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out);
crypton_status crypton_bigint_mul_schoolbook(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out);
crypton_status crypton_bigint_divmod(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *q, crypton_limbs *r);
crypton_status crypton_bigint_mod_inv(const crypton_limb *a, size_t an, const crypton_limb *m, size_t mn, crypton_limbs *out);
crypton_status crypton_bigint_mod_pow(const crypton_limb *base, size_t bn, const crypton_limb *exp, size_t en, const crypton_limb *mod, size_t mn, crypton_limbs *out);
crypton_status crypton_bigint_legacy_mod_pow(const crypton_limb *base, size_t bn, const crypton_limb *exp, size_t en, const crypton_limb *mod, size_t mn, crypton_limbs *out);
crypton_status crypton_bytes_to_limbs_be(const uint8_t *bytes, size_t len, crypton_limbs *out);
crypton_status crypton_hex_to_limbs(const char *hex, size_t hex_len, crypton_limbs *out);
crypton_status crypton_limbs_to_hex(const crypton_limb *v, size_t vn, crypton_buf *out);

bool crypton_mont_ctx_new(const crypton_limb *m, size_t mn, crypton_mont_ctx *ctx);
void crypton_mont_ctx_free(crypton_mont_ctx *ctx);
crypton_status crypton_mont_mul(const crypton_mont_ctx *ctx, const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out);
crypton_status crypton_mont_to_mont(const crypton_mont_ctx *ctx, const crypton_limb *a, size_t an, crypton_limbs *out);
crypton_status crypton_mont_from_mont(const crypton_mont_ctx *ctx, const crypton_limb *a, size_t an, crypton_limbs *out);
crypton_status crypton_mont_mod_pow(const crypton_limb *base, size_t bn, const crypton_limb *exp, size_t en, const crypton_mont_ctx *ctx, crypton_limbs *out);

crypton_status crypton_ecb_encrypt(const uint8_t *key, size_t key_len, const uint8_t *data, size_t data_len, crypton_buf *out);
crypton_status crypton_ecb_decrypt(const uint8_t *key, size_t key_len, const uint8_t *data, size_t data_len, crypton_buf *out);
crypton_status crypton_cbc_encrypt(const uint8_t *key, size_t key_len, const uint8_t *iv, size_t iv_len, const uint8_t *data, size_t data_len, crypton_buf *out);
crypton_status crypton_cbc_decrypt(const uint8_t *key, size_t key_len, const uint8_t *iv, size_t iv_len, const uint8_t *data, size_t data_len, crypton_buf *out);
crypton_status crypton_cbc_encrypt_etm(const uint8_t *mac_key, size_t mac_len, const uint8_t *enc_key, size_t enc_len, const uint8_t *iv, size_t iv_len, const uint8_t *pt, size_t pt_len, crypton_buf *out);
crypton_status crypton_cbc_decrypt_etm(const uint8_t *mac_key, size_t mac_len, const uint8_t *enc_key, size_t enc_len, const uint8_t *iv, size_t iv_len, const uint8_t *data, size_t data_len, crypton_buf *out);
crypton_status crypton_cbc_seal(const uint8_t *mac_key, size_t mac_len, const uint8_t *enc_key, size_t enc_len, const uint8_t *pt, size_t pt_len, crypton_buf *out);
crypton_status crypton_cbc_open(const uint8_t *mac_key, size_t mac_len, const uint8_t *enc_key, size_t enc_len, const uint8_t *sealed, size_t sealed_len, crypton_buf *out);
crypton_status crypton_ige_encrypt(const uint8_t *data, size_t data_len, const uint8_t *key, size_t key_len, const uint8_t *iv, size_t iv_len, crypton_buf *out);
crypton_status crypton_ige_decrypt(const uint8_t *data, size_t data_len, const uint8_t *key, size_t key_len, const uint8_t *iv, size_t iv_len, crypton_buf *out);
crypton_status crypton_ctr_process(const uint8_t *data, size_t data_len, const uint8_t *key, size_t key_len, const uint8_t *iv, size_t iv_len, uint64_t byte_offset, crypton_buf *out);

crypton_status crypton_hmac_sha256(const uint8_t *key, size_t key_len, const uint8_t *data, size_t data_len, crypton_buf *out);
crypton_status crypton_hmac_sha512(const uint8_t *key, size_t key_len, const uint8_t *data, size_t data_len, crypton_buf *out);
crypton_status crypton_hkdf_sha512_extract(const uint8_t *salt, size_t salt_len, const uint8_t *ikm, size_t ikm_len, crypton_buf *out);
crypton_status crypton_hkdf_sha512_expand(const uint8_t *prk, size_t prk_len, const uint8_t *info, size_t info_len, size_t len, crypton_buf *out);
crypton_status crypton_pbkdf2_sha256(const uint8_t *password, size_t password_len, const uint8_t *salt, size_t salt_len, size_t iterations, size_t dk_len, crypton_buf *out);

crypton_status crypton_mod_pow_hex(const char *base_hex, size_t base_len, const char *exp_hex, size_t exp_len, const char *mod_hex, size_t mod_len, crypton_buf *out_hex);
crypton_status crypton_is_probably_prime(const char *n_hex, size_t n_len, uint32_t rounds, bool *result);
crypton_status crypton_mod_pow_auto(const crypton_limb *base, size_t bn, const crypton_limb *exp, size_t en, const crypton_limb *mod, size_t mn, crypton_limbs *out);
crypton_status crypton_mod_pow_blind_with(const crypton_limb *base, size_t bn, const crypton_limb *exp, size_t en, const crypton_limb *mod, size_t mn, const crypton_limb *blinder, size_t fn, crypton_limbs *out);
crypton_status crypton_miller_rabin(const crypton_limb *n, size_t nn, uint32_t rounds, bool *result);
crypton_status crypton_mul_mod(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, const crypton_limb *m, size_t mn, crypton_limbs *out);

int crypton_run_kat(void);

#ifdef __cplusplus
}
#endif

#endif
