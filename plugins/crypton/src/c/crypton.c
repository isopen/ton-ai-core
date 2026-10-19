#include "crypton.h"

static void add_ctr(uint8_t *counter, uint64_t amount)
{
    uint64_t c_lo = amount;
    uint64_t c_hi = 0;
    for (int i = 15; i >= 0; i--) {
        if (c_lo == 0 && c_hi == 0) break;
        uint64_t add_byte = c_lo & 0xffu;
        uint64_t sum = (uint64_t)counter[i] + add_byte;
        counter[i] = (uint8_t)sum;
        c_lo = (c_lo >> 8) | (c_hi << 56);
        c_hi >>= 8;
        uint64_t cbit = sum >> 8;
        uint64_t before = c_lo;
        c_lo += cbit;
        if (c_lo < before) c_hi += 1;
    }
}

static const uint8_t SMALL_PRIMES[25] = {
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97
};

static bool crl_eq_limb(const crypton_limb *v, size_t vn, crypton_limb w)
{
    size_t count = 0;
    size_t last = 0;
    for (size_t i = 0; i < vn; i++) {
        if (v[i] != 0) {
            count++;
            last = i;
        }
    }
    if (count == 0) return w == 0;
    if (last == 0) return v[0] == w;
    return false;
}

static bool crl_vec_eq(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn)
{
    if (an != bn) return false;
    for (size_t i = 0; i < an; i++) {
        if (a[i] != b[i]) return false;
    }
    return true;
}

static crypton_status crl_sub_one(const crypton_limb *n, size_t nn, crypton_limbs *out)
{
    crypton_status st = crypton_limbs_resize(out, nn, 0);
    if (st != CRYPTON_OK) return st;
    cr_memcpy(out->v, n, nn * sizeof(crypton_limb));
    for (size_t i = 0; i < nn; i++) {
        if (out->v[i] != 0) {
            out->v[i] -= 1;
            break;
        }
        out->v[i] = ~(uint64_t)0;
    }
    crypton_limbs_trim(out);
    return CRYPTON_OK;
}

static crypton_status crl_shr1(const crypton_limb *n, size_t nn, crypton_limbs *out)
{
    crypton_status st = crypton_limbs_resize(out, nn, 0);
    if (st != CRYPTON_OK) return st;
    uint64_t carry = 0;
    for (size_t i = nn; i-- > 0;) {
        out->v[i] = (n[i] >> 1) | (carry << 63);
        carry = n[i] & 1u;
    }
    crypton_limbs_trim(out);
    return CRYPTON_OK;
}

static crypton_status hmac_core_sha256(const uint8_t *key, size_t klen, const uint8_t *data, size_t dlen, uint8_t mac[32])
{
    uint8_t k[64];
    if (klen > 64) {
        crypton_sha256(key, klen, k);
        cr_memset(k + 32, 0, 32);
    } else {
        cr_memcpy(k, key, klen);
        cr_memset(k + klen, 0, 64 - klen);
    }
    uint8_t ipad[64], opad[64];
    for (size_t i = 0; i < 64; i++) {
        ipad[i] = (uint8_t)(k[i] ^ 0x36);
        opad[i] = (uint8_t)(k[i] ^ 0x5c);
    }
    crypton_wipe(k, 64);
    crypton_buf inner;
    crypton_buf_init(&inner);
    crypton_status st = crypton_buf_append(&inner, ipad, 64);
    if (st == CRYPTON_OK) st = crypton_buf_append(&inner, data, dlen);
    if (st != CRYPTON_OK) {
        crypton_wipe(ipad, 64);
        crypton_wipe(opad, 64);
        crypton_buf_free(&inner);
        return st;
    }
    uint8_t innerhash[32];
    crypton_sha256(inner.data, inner.len, innerhash);
    crypton_buf_free(&inner);
    crypton_wipe(ipad, 64);
    crypton_buf outer;
    crypton_buf_init(&outer);
    st = crypton_buf_append(&outer, opad, 64);
    if (st == CRYPTON_OK) st = crypton_buf_append(&outer, innerhash, 32);
    crypton_wipe(opad, 64);
    crypton_wipe(innerhash, 32);
    if (st != CRYPTON_OK) {
        crypton_buf_free(&outer);
        return st;
    }
    crypton_sha256(outer.data, outer.len, mac);
    crypton_buf_free(&outer);
    return CRYPTON_OK;
}

static crypton_status hmac_core_sha512(const uint8_t *key, size_t klen, const uint8_t *data, size_t dlen, uint8_t mac[64])
{
    uint8_t k[128];
    if (klen > 128) {
        crypton_sha512(key, klen, k);
        cr_memset(k + 64, 0, 64);
    } else {
        cr_memcpy(k, key, klen);
        cr_memset(k + klen, 0, 128 - klen);
    }
    uint8_t ipad[128], opad[128];
    for (size_t i = 0; i < 128; i++) {
        ipad[i] = (uint8_t)(k[i] ^ 0x36);
        opad[i] = (uint8_t)(k[i] ^ 0x5c);
    }
    crypton_wipe(k, 128);
    crypton_buf inner;
    crypton_buf_init(&inner);
    crypton_status st = crypton_buf_append(&inner, ipad, 128);
    if (st == CRYPTON_OK) st = crypton_buf_append(&inner, data, dlen);
    if (st != CRYPTON_OK) {
        crypton_wipe(ipad, 128);
        crypton_wipe(opad, 128);
        crypton_buf_free(&inner);
        return st;
    }
    uint8_t innerhash[64];
    crypton_sha512(inner.data, inner.len, innerhash);
    crypton_buf_free(&inner);
    crypton_wipe(ipad, 128);
    crypton_buf outer;
    crypton_buf_init(&outer);
    st = crypton_buf_append(&outer, opad, 128);
    if (st == CRYPTON_OK) st = crypton_buf_append(&outer, innerhash, 64);
    crypton_wipe(opad, 128);
    crypton_wipe(innerhash, 64);
    if (st != CRYPTON_OK) {
        crypton_buf_free(&outer);
        return st;
    }
    crypton_sha512(outer.data, outer.len, mac);
    crypton_buf_free(&outer);
    return CRYPTON_OK;
}

crypton_status crypton_hmac_sha256(const uint8_t *key, size_t key_len, const uint8_t *data, size_t data_len, crypton_buf *out)
{
    crypton_buf_init(out);
    uint8_t mac[32];
    crypton_status st = hmac_core_sha256(key, key_len, data, data_len, mac);
    if (st != CRYPTON_OK) return st;
    st = crypton_buf_append(out, mac, 32);
    crypton_wipe(mac, 32);
    if (st != CRYPTON_OK) {
        crypton_buf_free(out);
        return st;
    }
    return CRYPTON_OK;
}

crypton_status crypton_hmac_sha512(const uint8_t *key, size_t key_len, const uint8_t *data, size_t data_len, crypton_buf *out)
{
    crypton_buf_init(out);
    uint8_t mac[64];
    crypton_status st = hmac_core_sha512(key, key_len, data, data_len, mac);
    if (st != CRYPTON_OK) return st;
    st = crypton_buf_append(out, mac, 64);
    crypton_wipe(mac, 64);
    if (st != CRYPTON_OK) {
        crypton_buf_free(out);
        return st;
    }
    return CRYPTON_OK;
}

crypton_status crypton_hkdf_sha512_extract(const uint8_t *salt, size_t salt_len, const uint8_t *ikm, size_t ikm_len, crypton_buf *out)
{
    crypton_buf_init(out);
    uint8_t prk[64];
    crypton_status st = hmac_core_sha512(salt, salt_len, ikm, ikm_len, prk);
    if (st != CRYPTON_OK) return st;
    st = crypton_buf_append(out, prk, 64);
    crypton_wipe(prk, 64);
    if (st != CRYPTON_OK) {
        crypton_buf_free(out);
        return st;
    }
    return CRYPTON_OK;
}

crypton_status crypton_hkdf_sha512_expand(const uint8_t *prk, size_t prk_len, const uint8_t *info, size_t info_len, size_t len, crypton_buf *out)
{
    if (len > (size_t)CRYPTON_MAX_DERIVED_LEN) return CRYPTON_DERIVED_KEY_TOO_LONG;
    size_t n_blocks = len == 0 ? 0 : (len + 63) / 64;
    crypton_buf t, input;
    crypton_buf_init(&t);
    crypton_buf_init(out);
    crypton_status st = CRYPTON_OK;
    uint8_t next[64];
    for (size_t i = 1; i <= n_blocks; i++) {
        crypton_buf_init(&input);
        st = crypton_buf_append(&input, t.data, t.len);
        if (st == CRYPTON_OK) st = crypton_buf_append(&input, info, info_len);
        uint8_t ib = (uint8_t)i;
        if (st == CRYPTON_OK) st = crypton_buf_append(&input, &ib, 1);
        if (st != CRYPTON_OK) {
            crypton_buf_free(&input);
            goto fail;
        }
        st = hmac_core_sha512(prk, prk_len, input.data, input.len, next);
        crypton_buf_free(&input);
        if (st != CRYPTON_OK) {
            crypton_wipe(next, 64);
            goto fail;
        }
        crypton_buf_free(&t);
        crypton_buf_init(&t);
        st = crypton_buf_append(&t, next, 64);
        crypton_wipe(next, 64);
        if (st != CRYPTON_OK) goto fail;
        st = crypton_buf_append(out, t.data, t.len);
        if (st != CRYPTON_OK) goto fail;
    }
    crypton_buf_free(&t);
    crypton_buf_truncate(out, len);
    return CRYPTON_OK;
fail:
    crypton_buf_free(&t);
    crypton_buf_free(out);
    return st;
}

crypton_status crypton_pbkdf2_sha256(const uint8_t *password, size_t password_len, const uint8_t *salt, size_t salt_len, size_t iterations, size_t dk_len, crypton_buf *out)
{
    if (iterations == 0) return CRYPTON_ZERO_ITERATIONS;
    if (iterations > (size_t)CRYPTON_MAX_PBKDF2_ITERATIONS) return CRYPTON_TOO_MANY_ITERATIONS;
    if (dk_len > (size_t)CRYPTON_MAX_DERIVED_LEN) return CRYPTON_DERIVED_KEY_TOO_LONG;
    crypton_buf_init(out);
    crypton_buf input;
    crypton_buf_init(&input);
    crypton_status st = CRYPTON_OK;
    uint32_t block_index = 1;
    uint8_t u[32], acc[32], next[32];
    while (out->len < dk_len) {
        crypton_buf_truncate(&input, 0);
        st = crypton_buf_append(&input, salt, salt_len);
        if (st == CRYPTON_OK) {
            uint8_t bi[4];
            bi[0] = (uint8_t)(block_index >> 24);
            bi[1] = (uint8_t)(block_index >> 16);
            bi[2] = (uint8_t)(block_index >> 8);
            bi[3] = (uint8_t)block_index;
            st = crypton_buf_append(&input, bi, 4);
        }
        if (st != CRYPTON_OK) goto fail;
        st = hmac_core_sha256(password, password_len, input.data, input.len, u);
        if (st != CRYPTON_OK) goto fail;
        cr_memcpy(acc, u, 32);
        for (size_t it = 1; it < iterations; it++) {
            st = hmac_core_sha256(password, password_len, u, 32, next);
            if (st != CRYPTON_OK) goto fail;
            crypton_wipe(u, 32);
            cr_memcpy(u, next, 32);
            crypton_wipe(next, 32);
            for (size_t p = 0; p < 32; p++) acc[p] ^= u[p];
        }
        if (input.data) crypton_wipe(input.data, input.len);
        crypton_wipe(u, 32);
        st = crypton_buf_append(out, acc, 32);
        crypton_wipe(acc, 32);
        if (st != CRYPTON_OK) goto fail;
        block_index += 1;
    }
    crypton_buf_free(&input);
    crypton_buf_truncate(out, dk_len);
    return CRYPTON_OK;
fail:
    crypton_wipe(u, 32);
    crypton_wipe(acc, 32);
    crypton_wipe(next, 32);
    crypton_buf_free(&input);
    crypton_buf_free(out);
    return st;
}

crypton_status crypton_ecb_encrypt(const uint8_t *key, size_t key_len, const uint8_t *data, size_t data_len, crypton_buf *out)
{
    if (key_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    if (data_len % 16 != 0) return CRYPTON_INPUT_NOT_ALIGNED;
    uint8_t rk[15][16];
    crypton_status st = crypton_aes_key_expansion(key, key_len, rk);
    if (st != CRYPTON_OK) return st;
    crypton_buf_init(out);
    st = crypton_buf_reserve(out, data_len);
    if (st != CRYPTON_OK) {
        crypton_wipe(rk, 240);
        return st;
    }
    out->len = data_len;
    uint8_t block[16];
    for (size_t i = 0; i * 16 < data_len; i++) {
        cr_memcpy(block, data + i * 16, 16);
        crypton_aes256_encrypt_block(rk, block);
        cr_memcpy(out->data + i * 16, block, 16);
    }
    crypton_wipe(block, 16);
    crypton_wipe(rk, 240);
    return CRYPTON_OK;
}

crypton_status crypton_ecb_decrypt(const uint8_t *key, size_t key_len, const uint8_t *data, size_t data_len, crypton_buf *out)
{
    if (key_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    if (data_len % 16 != 0) return CRYPTON_INPUT_NOT_ALIGNED;
    uint8_t rk[15][16];
    crypton_status st = crypton_aes_key_expansion(key, key_len, rk);
    if (st != CRYPTON_OK) return st;
    crypton_buf_init(out);
    st = crypton_buf_reserve(out, data_len);
    if (st != CRYPTON_OK) {
        crypton_wipe(rk, 240);
        return st;
    }
    out->len = data_len;
    uint8_t block[16];
    for (size_t i = 0; i * 16 < data_len; i++) {
        cr_memcpy(block, data + i * 16, 16);
        crypton_aes256_decrypt_block(rk, block);
        cr_memcpy(out->data + i * 16, block, 16);
    }
    crypton_wipe(block, 16);
    crypton_wipe(rk, 240);
    return CRYPTON_OK;
}

crypton_status crypton_cbc_encrypt(const uint8_t *key, size_t key_len, const uint8_t *iv, size_t iv_len, const uint8_t *data, size_t data_len, crypton_buf *out)
{
    if (key_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    if (iv_len != 16) return CRYPTON_INVALID_IV_LENGTH;
    if (data_len % 16 != 0) return CRYPTON_INPUT_NOT_ALIGNED;
    uint8_t rk[15][16];
    crypton_status st = crypton_aes_key_expansion(key, key_len, rk);
    if (st != CRYPTON_OK) return st;
    crypton_buf_init(out);
    st = crypton_buf_reserve(out, data_len);
    if (st != CRYPTON_OK) {
        crypton_wipe(rk, 240);
        return st;
    }
    out->len = data_len;
    uint8_t prev[16];
    cr_memcpy(prev, iv, 16);
    for (size_t i = 0; i * 16 < data_len; i++) {
        for (size_t j = 0; j < 16; j++) prev[j] ^= data[i * 16 + j];
        crypton_aes256_encrypt_block(rk, prev);
        cr_memcpy(out->data + i * 16, prev, 16);
    }
    crypton_wipe(prev, 16);
    crypton_wipe(rk, 240);
    return CRYPTON_OK;
}

crypton_status crypton_cbc_decrypt(const uint8_t *key, size_t key_len, const uint8_t *iv, size_t iv_len, const uint8_t *data, size_t data_len, crypton_buf *out)
{
    if (key_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    if (iv_len != 16) return CRYPTON_INVALID_IV_LENGTH;
    if (data_len % 16 != 0) return CRYPTON_INPUT_NOT_ALIGNED;
    uint8_t rk[15][16];
    crypton_status st = crypton_aes_key_expansion(key, key_len, rk);
    if (st != CRYPTON_OK) return st;
    crypton_buf_init(out);
    st = crypton_buf_reserve(out, data_len);
    if (st != CRYPTON_OK) {
        crypton_wipe(rk, 240);
        return st;
    }
    out->len = data_len;
    uint8_t prev[16], ct[16], pt[16];
    cr_memcpy(prev, iv, 16);
    for (size_t i = 0; i * 16 < data_len; i++) {
        cr_memcpy(ct, data + i * 16, 16);
        cr_memcpy(pt, ct, 16);
        crypton_aes256_decrypt_block(rk, ct);
        for (size_t j = 0; j < 16; j++) ct[j] ^= prev[j];
        cr_memcpy(out->data + i * 16, ct, 16);
        cr_memcpy(prev, pt, 16);
    }
    crypton_wipe(prev, 16);
    crypton_wipe(ct, 16);
    crypton_wipe(pt, 16);
    crypton_wipe(rk, 240);
    return CRYPTON_OK;
}

crypton_status crypton_ige_encrypt(const uint8_t *data, size_t data_len, const uint8_t *key, size_t key_len, const uint8_t *iv, size_t iv_len, crypton_buf *out)
{
    if (key_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    if (iv_len != 32) return CRYPTON_INVALID_IV_LENGTH;
    if (data_len % 16 != 0) return CRYPTON_INPUT_NOT_ALIGNED;
    uint8_t rk[15][16];
    crypton_status st = crypton_aes_key_expansion(key, key_len, rk);
    if (st != CRYPTON_OK) return st;
    crypton_buf_init(out);
    st = crypton_buf_reserve(out, data_len);
    if (st != CRYPTON_OK) {
        crypton_wipe(rk, 240);
        return st;
    }
    out->len = data_len;
    uint8_t enc_iv[16], dec_iv[16], pt[16], x[16];
    cr_memcpy(enc_iv, iv, 16);
    cr_memcpy(dec_iv, iv + 16, 16);
    for (size_t i = 0; i * 16 < data_len; i++) {
        cr_memcpy(pt, data + i * 16, 16);
        cr_memcpy(x, pt, 16);
        for (size_t j = 0; j < 16; j++) x[j] ^= enc_iv[j];
        crypton_aes256_encrypt_block(rk, x);
        for (size_t j = 0; j < 16; j++) x[j] ^= dec_iv[j];
        cr_memcpy(out->data + i * 16, x, 16);
        cr_memcpy(enc_iv, x, 16);
        cr_memcpy(dec_iv, pt, 16);
    }
    crypton_wipe(pt, 16);
    crypton_wipe(x, 16);
    crypton_wipe(enc_iv, 16);
    crypton_wipe(dec_iv, 16);
    crypton_wipe(rk, 240);
    return CRYPTON_OK;
}

crypton_status crypton_ige_decrypt(const uint8_t *data, size_t data_len, const uint8_t *key, size_t key_len, const uint8_t *iv, size_t iv_len, crypton_buf *out)
{
    if (key_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    if (iv_len != 32) return CRYPTON_INVALID_IV_LENGTH;
    if (data_len % 16 != 0) return CRYPTON_INPUT_NOT_ALIGNED;
    uint8_t rk[15][16];
    crypton_status st = crypton_aes_key_expansion(key, key_len, rk);
    if (st != CRYPTON_OK) return st;
    crypton_buf_init(out);
    st = crypton_buf_reserve(out, data_len);
    if (st != CRYPTON_OK) {
        crypton_wipe(rk, 240);
        return st;
    }
    out->len = data_len;
    uint8_t enc_iv[16], dec_iv[16], ct[16], x[16];
    cr_memcpy(enc_iv, iv, 16);
    cr_memcpy(dec_iv, iv + 16, 16);
    for (size_t i = 0; i * 16 < data_len; i++) {
        cr_memcpy(ct, data + i * 16, 16);
        cr_memcpy(x, ct, 16);
        for (size_t j = 0; j < 16; j++) x[j] ^= dec_iv[j];
        crypton_aes256_decrypt_block(rk, x);
        for (size_t j = 0; j < 16; j++) x[j] ^= enc_iv[j];
        cr_memcpy(out->data + i * 16, x, 16);
        cr_memcpy(enc_iv, ct, 16);
        cr_memcpy(dec_iv, x, 16);
    }
    crypton_wipe(ct, 16);
    crypton_wipe(x, 16);
    crypton_wipe(enc_iv, 16);
    crypton_wipe(dec_iv, 16);
    crypton_wipe(rk, 240);
    return CRYPTON_OK;
}

crypton_status crypton_ctr_process(const uint8_t *data, size_t data_len, const uint8_t *key, size_t key_len, const uint8_t *iv, size_t iv_len, uint64_t byte_offset, crypton_buf *out)
{
    if (key_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    if (iv_len != 16) return CRYPTON_INVALID_IV_LENGTH;
    uint8_t rk[15][16];
    crypton_status st = crypton_aes_key_expansion(key, key_len, rk);
    if (st != CRYPTON_OK) return st;
    uint8_t counter[16], block[16];
    cr_memcpy(counter, iv, 16);
    add_ctr(counter, byte_offset / 16);
    cr_memcpy(block, counter, 16);
    crypton_aes256_encrypt_block(rk, block);
    size_t pos = (size_t)(byte_offset % 16);
    crypton_buf_init(out);
    st = crypton_buf_reserve(out, data_len);
    if (st != CRYPTON_OK) {
        crypton_wipe(counter, 16);
        crypton_wipe(block, 16);
        crypton_wipe(rk, 240);
        return st;
    }
    out->len = data_len;
    size_t idx = 0;
    while (idx < data_len) {
        while (pos < 16 && idx < data_len) {
            out->data[idx] = (uint8_t)(data[idx] ^ block[pos]);
            idx++;
            pos++;
        }
        if (idx < data_len) {
            add_ctr(counter, 1);
            cr_memcpy(block, counter, 16);
            crypton_aes256_encrypt_block(rk, block);
            pos = 0;
        }
    }
    crypton_wipe(counter, 16);
    crypton_wipe(block, 16);
    crypton_wipe(rk, 240);
    return CRYPTON_OK;
}

crypton_status crypton_cbc_encrypt_etm(const uint8_t *mac_key, size_t mac_len, const uint8_t *enc_key, size_t enc_len, const uint8_t *iv, size_t iv_len, const uint8_t *pt, size_t pt_len, crypton_buf *out)
{
    if (mac_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    crypton_buf ct;
    crypton_status st = crypton_cbc_encrypt(enc_key, enc_len, iv, iv_len, pt, pt_len, &ct);
    if (st != CRYPTON_OK) return st;
    crypton_buf mac_input;
    crypton_buf_init(&mac_input);
    st = crypton_buf_append(&mac_input, iv, iv_len);
    if (st == CRYPTON_OK) st = crypton_buf_append(&mac_input, ct.data, ct.len);
    if (st != CRYPTON_OK) {
        crypton_buf_free(&mac_input);
        crypton_buf_free(&ct);
        return st;
    }
    uint8_t tag[32];
    st = hmac_core_sha256(mac_key, mac_len, mac_input.data, mac_input.len, tag);
    crypton_buf_free(&mac_input);
    if (st != CRYPTON_OK) {
        crypton_buf_free(&ct);
        return st;
    }
    st = crypton_buf_append(&ct, tag, 32);
    crypton_wipe(tag, 32);
    if (st != CRYPTON_OK) {
        crypton_buf_free(&ct);
        return st;
    }
    *out = ct;
    return CRYPTON_OK;
}

crypton_status crypton_cbc_decrypt_etm(const uint8_t *mac_key, size_t mac_len, const uint8_t *enc_key, size_t enc_len, const uint8_t *iv, size_t iv_len, const uint8_t *data, size_t data_len, crypton_buf *out)
{
    if (mac_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    if (data_len < 32 || (data_len - 32) % 16 != 0) return CRYPTON_AUTHENTICATION_FAILURE;
    size_t split = data_len - 32;
    crypton_buf mac_input;
    crypton_buf_init(&mac_input);
    crypton_status st = crypton_buf_append(&mac_input, iv, iv_len);
    if (st == CRYPTON_OK) st = crypton_buf_append(&mac_input, data, split);
    if (st != CRYPTON_OK) {
        crypton_buf_free(&mac_input);
        return st;
    }
    uint8_t expected[32];
    st = hmac_core_sha256(mac_key, mac_len, mac_input.data, mac_input.len, expected);
    crypton_buf_free(&mac_input);
    if (st != CRYPTON_OK) return st;
    bool ok = crypton_ct_eq(expected, 32, data + split, 32);
    crypton_wipe(expected, 32);
    if (!ok) return CRYPTON_AUTHENTICATION_FAILURE;
    return crypton_cbc_decrypt(enc_key, enc_len, iv, iv_len, data, split, out);
}

crypton_status crypton_cbc_seal(const uint8_t *mac_key, size_t mac_len, const uint8_t *enc_key, size_t enc_len, const uint8_t *pt, size_t pt_len, crypton_buf *out)
{
    if (mac_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    uint8_t iv[16];
    crypton_status st = crypton_random_fill(iv, 16);
    if (st != CRYPTON_OK) {
        crypton_wipe(iv, 16);
        return st;
    }
    crypton_buf enc;
    st = crypton_cbc_encrypt_etm(mac_key, mac_len, enc_key, enc_len, iv, 16, pt, pt_len, &enc);
    if (st != CRYPTON_OK) {
        crypton_wipe(iv, 16);
        return st;
    }
    crypton_buf_init(out);
    st = crypton_buf_append(out, iv, 16);
    if (st == CRYPTON_OK) st = crypton_buf_append(out, enc.data, enc.len);
    crypton_wipe(iv, 16);
    crypton_buf_free(&enc);
    if (st != CRYPTON_OK) {
        crypton_buf_free(out);
        return st;
    }
    return CRYPTON_OK;
}

crypton_status crypton_cbc_open(const uint8_t *mac_key, size_t mac_len, const uint8_t *enc_key, size_t enc_len, const uint8_t *sealed, size_t sealed_len, crypton_buf *out)
{
    if (mac_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    if (sealed_len < 16 + 32) return CRYPTON_AUTHENTICATION_FAILURE;
    return crypton_cbc_decrypt_etm(mac_key, mac_len, enc_key, enc_len, sealed, 16, sealed + 16, sealed_len - 16, out);
}

crypton_status crypton_mul_mod(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, const crypton_limb *m, size_t mn, crypton_limbs *out)
{
    crypton_limbs prod, q, r;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&prod);
    crypton_limbs_init(&q);
    crypton_limbs_init(&r);
    st = crypton_bigint_mul(a, an, b, bn, &prod);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_divmod(prod.v, prod.len, m, mn, &q, &r);
    crypton_limbs_free(&prod);
    crypton_limbs_init(&prod);
    if (st != CRYPTON_OK) goto done;
    crypton_limbs_free(&q);
    crypton_limbs_init(&q);
    *out = r;
    crypton_limbs_init(&r);
done:
    crypton_limbs_free(&prod);
    crypton_limbs_free(&q);
    crypton_limbs_free(&r);
    return st;
}

crypton_status crypton_mod_pow_blind_with(const crypton_limb *base, size_t bn, const crypton_limb *exp, size_t en, const crypton_limb *mod, size_t mn, const crypton_limb *blinder, size_t blinder_len, crypton_limbs *out)
{
    if (crypton_bigint_is_zero(mod, mn)) return CRYPTON_MODULUS_IS_ZERO;
    crypton_limbs r, r_inv, prod, qt, blinded_base, core, unblind, res;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&r);
    crypton_limbs_init(&r_inv);
    crypton_limbs_init(&prod);
    crypton_limbs_init(&qt);
    crypton_limbs_init(&blinded_base);
    crypton_limbs_init(&core);
    crypton_limbs_init(&unblind);
    crypton_limbs_init(&res);
    st = crypton_bigint_divmod(blinder, blinder_len, mod, mn, &qt, &r);
    crypton_limbs_free(&qt);
    crypton_limbs_init(&qt);
    if (st != CRYPTON_OK) goto done;
    if (crypton_bigint_is_zero(r.v, r.len)) {
        st = CRYPTON_NO_MODULAR_INVERSE;
        goto done;
    }
    st = crypton_bigint_mod_inv(r.v, r.len, mod, mn, &r_inv);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_mul(base, bn, r.v, r.len, &prod);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_divmod(prod.v, prod.len, mod, mn, &qt, &blinded_base);
    crypton_limbs_free(&prod);
    crypton_limbs_init(&prod);
    crypton_limbs_free(&qt);
    crypton_limbs_init(&qt);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_mod_pow(blinded_base.v, blinded_base.len, exp, en, mod, mn, &core);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_mod_pow(r_inv.v, r_inv.len, exp, en, mod, mn, &unblind);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_mul(core.v, core.len, unblind.v, unblind.len, &prod);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_divmod(prod.v, prod.len, mod, mn, &qt, &res);
    crypton_limbs_free(&prod);
    crypton_limbs_init(&prod);
    crypton_limbs_free(&qt);
    crypton_limbs_init(&qt);
    if (st != CRYPTON_OK) goto done;
    crypton_limbs_free(&blinded_base);
    crypton_limbs_init(&blinded_base);
    crypton_limbs_free(&unblind);
    crypton_limbs_init(&unblind);
    crypton_limbs_free(&r);
    crypton_limbs_init(&r);
    crypton_limbs_free(&r_inv);
    crypton_limbs_init(&r_inv);
    crypton_limbs_free(&core);
    crypton_limbs_init(&core);
    *out = res;
    crypton_limbs_init(&res);
done:
    crypton_limbs_free(&r);
    crypton_limbs_free(&r_inv);
    crypton_limbs_free(&prod);
    crypton_limbs_free(&qt);
    crypton_limbs_free(&blinded_base);
    crypton_limbs_free(&core);
    crypton_limbs_free(&unblind);
    crypton_limbs_free(&res);
    return st;
}

crypton_status crypton_mod_pow_auto(const crypton_limb *base, size_t bn, const crypton_limb *exp, size_t en, const crypton_limb *mod, size_t mn, crypton_limbs *out)
{
    if (crypton_bigint_is_zero(mod, mn)) return CRYPTON_MODULUS_IS_ZERO;
    if (mn == 1 && mod[0] == 1) {
        crypton_status st = crypton_limbs_resize(out, 1, 0);
        if (st != CRYPTON_OK) return st;
        out->v[0] = 0;
        out->len = 1;
        return CRYPTON_OK;
    }
    if (en > 1) {
        for (size_t attempt = 0; attempt < 128; attempt++) {
            crypton_buf raw;
            crypton_buf_init(&raw);
            crypton_status st = crypton_get_random_bytes(mn * 8, &raw);
            if (st != CRYPTON_OK) {
                crypton_buf_free(&raw);
                return st;
            }
            crypton_limbs cand;
            crypton_limbs_init(&cand);
            st = crypton_bytes_to_limbs_be(raw.data, raw.len, &cand);
            crypton_buf_free(&raw);
            if (st != CRYPTON_OK) {
                crypton_limbs_free(&cand);
                return st;
            }
            bool ok = false;
            if (!crypton_bigint_is_zero(cand.v, cand.len)) {
                crypton_limbs qt, rt;
                crypton_limbs_init(&qt);
                crypton_limbs_init(&rt);
                crypton_status dm = crypton_bigint_divmod(cand.v, cand.len, mod, mn, &qt, &rt);
                if (dm == CRYPTON_OK) ok = !crypton_bigint_is_zero(rt.v, rt.len);
                crypton_limbs_free(&qt);
                crypton_limbs_free(&rt);
            }
            if (ok) {
                crypton_limbs res;
                crypton_limbs_init(&res);
                crypton_status bst = crypton_mod_pow_blind_with(base, bn, exp, en, mod, mn, cand.v, cand.len, &res);
                if (bst == CRYPTON_NO_MODULAR_INVERSE) {
                    crypton_limbs_free(&res);
                    crypton_limbs_free(&cand);
                    continue;
                }
                crypton_limbs_free(&cand);
                if (bst != CRYPTON_OK) {
                    crypton_limbs_free(&res);
                    return bst;
                }
                *out = res;
                return CRYPTON_OK;
            }
            crypton_limbs_free(&cand);
        }
        return CRYPTON_BLINDING_EXHAUSTED;
    }
    return crypton_bigint_mod_pow(base, bn, exp, en, mod, mn, out);
}

crypton_status crypton_mod_pow_hex(const char *base_hex, size_t base_len, const char *exp_hex, size_t exp_len, const char *mod_hex, size_t mod_len, crypton_buf *out_hex)
{
    crypton_limbs b, e, m, r;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&b);
    crypton_limbs_init(&e);
    crypton_limbs_init(&m);
    crypton_limbs_init(&r);
    st = crypton_hex_to_limbs(base_hex, base_len, &b);
    if (st != CRYPTON_OK) goto done;
    st = crypton_hex_to_limbs(exp_hex, exp_len, &e);
    if (st != CRYPTON_OK) goto done;
    st = crypton_hex_to_limbs(mod_hex, mod_len, &m);
    if (st != CRYPTON_OK) goto done;
    if (b.len > (size_t)CRYPTON_MAX_MODPOW_LIMBS || e.len > (size_t)CRYPTON_MAX_MODPOW_LIMBS || m.len > (size_t)CRYPTON_MAX_MODPOW_LIMBS) {
        st = CRYPTON_OPERAND_TOO_LARGE;
        goto done;
    }
    st = crypton_mod_pow_auto(b.v, b.len, e.v, e.len, m.v, m.len, &r);
    if (st != CRYPTON_OK) goto done;
    st = crypton_limbs_to_hex(r.v, r.len, out_hex);
done:
    crypton_limbs_free(&b);
    crypton_limbs_free(&e);
    crypton_limbs_free(&m);
    crypton_limbs_free(&r);
    return st;
}

static crypton_status crl_random_in_range(const crypton_limb *n, size_t nn, crypton_limbs *out)
{
    crypton_limbs t1, t2, span, pow2, rem0, bound, cand, reduced, res, qt, rt;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&t1);
    crypton_limbs_init(&t2);
    crypton_limbs_init(&span);
    crypton_limbs_init(&pow2);
    crypton_limbs_init(&rem0);
    crypton_limbs_init(&bound);
    crypton_limbs_init(&cand);
    crypton_limbs_init(&reduced);
    crypton_limbs_init(&res);
    crypton_limbs_init(&qt);
    crypton_limbs_init(&rt);
    st = crl_sub_one(n, nn, &t1);
    if (st != CRYPTON_OK) goto done;
    st = crl_sub_one(t1.v, t1.len, &t2);
    if (st != CRYPTON_OK) goto done;
    st = crl_sub_one(t2.v, t2.len, &span);
    if (st != CRYPTON_OK) goto done;
    if (crypton_bigint_is_zero(span.v, span.len)) {
        st = CRYPTON_MODULUS_IS_ZERO;
        goto done;
    }
    size_t l = nn;
    st = crypton_limbs_resize(&pow2, l + 1, 0);
    if (st != CRYPTON_OK) goto done;
    pow2.v[l] = 1;
    pow2.len = l + 1;
    st = crypton_bigint_divmod(pow2.v, pow2.len, span.v, span.len, &qt, &rem0);
    crypton_limbs_free(&qt);
    crypton_limbs_init(&qt);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_sub(pow2.v, pow2.len, rem0.v, rem0.len, &bound);
    if (st != CRYPTON_OK) goto done;
    for (size_t attempt = 0; attempt < 512; attempt++) {
        crypton_buf raw;
        crypton_buf_init(&raw);
        st = crypton_get_random_bytes(l * 8, &raw);
        if (st != CRYPTON_OK) {
            crypton_buf_free(&raw);
            goto done;
        }
        st = crypton_bytes_to_limbs_be(raw.data, raw.len, &cand);
        crypton_buf_free(&raw);
        if (st != CRYPTON_OK) {
            crypton_limbs_free(&cand);
            crypton_limbs_init(&cand);
            goto done;
        }
        if (!crypton_bigint_cmp_lt(cand.v, cand.len, bound.v, bound.len)) {
            crypton_limbs_free(&cand);
            crypton_limbs_init(&cand);
            continue;
        }
        st = crypton_bigint_divmod(cand.v, cand.len, span.v, span.len, &qt, &reduced);
        crypton_limbs_free(&cand);
        crypton_limbs_init(&cand);
        crypton_limbs_free(&qt);
        crypton_limbs_init(&qt);
        if (st != CRYPTON_OK) goto done;
        {
            crypton_limb two[1] = {2};
            st = crypton_bigint_add(reduced.v, reduced.len, two, 1, &res);
        }
        crypton_limbs_free(&reduced);
        crypton_limbs_init(&reduced);
        if (st != CRYPTON_OK) goto done;
        *out = res;
        crypton_limbs_init(&res);
        st = CRYPTON_OK;
        goto done;
    }
    st = CRYPTON_ENTROPY_FAILURE;
done:
    crypton_limbs_free(&t1);
    crypton_limbs_free(&t2);
    crypton_limbs_free(&span);
    crypton_limbs_free(&pow2);
    crypton_limbs_free(&rem0);
    crypton_limbs_free(&bound);
    crypton_limbs_free(&cand);
    crypton_limbs_free(&reduced);
    crypton_limbs_free(&res);
    crypton_limbs_free(&qt);
    crypton_limbs_free(&rt);
    return st;
}

crypton_status crypton_miller_rabin(const crypton_limb *n, size_t nn, uint32_t rounds, bool *result)
{
    if (rounds == 0) return CRYPTON_INVALID_ROUNDS;
    if (crypton_bigint_is_zero(n, nn) || crl_eq_limb(n, nn, 1)) {
        *result = false;
        return CRYPTON_OK;
    }
    for (size_t pi = 0; pi < 25; pi++) {
        crypton_limb p = SMALL_PRIMES[pi];
        if (crl_eq_limb(n, nn, p)) {
            *result = true;
            return CRYPTON_OK;
        }
        crypton_limb pv[1];
        pv[0] = p;
        crypton_limbs qt, rt;
        crypton_limbs_init(&qt);
        crypton_limbs_init(&rt);
        crypton_status st = crypton_bigint_divmod(n, nn, pv, 1, &qt, &rt);
        crypton_limbs_free(&qt);
        crypton_limbs_init(&qt);
        if (st != CRYPTON_OK) {
            crypton_limbs_free(&rt);
            crypton_limbs_init(&rt);
            return st;
        }
        bool z = crypton_bigint_is_zero(rt.v, rt.len);
        crypton_limbs_free(&rt);
        crypton_limbs_init(&rt);
        if (z) {
            *result = false;
            return CRYPTON_OK;
        }
    }
    if ((n[0] & 1u) == 0u) {
        *result = false;
        return CRYPTON_OK;
    }
    crypton_limbs nm1, d, d_tmp, a, x, x2;
    crypton_mont_ctx ctx;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&nm1);
    crypton_limbs_init(&d);
    crypton_limbs_init(&d_tmp);
    crypton_limbs_init(&a);
    crypton_limbs_init(&x);
    crypton_limbs_init(&x2);
    ctx.n = 0;
    ctx.m = NULL;
    ctx.n0 = 0;
    ctx.r1 = NULL;
    ctx.r2 = NULL;
    st = crl_sub_one(n, nn, &nm1);
    if (st != CRYPTON_OK) goto done;
    st = crypton_limbs_resize(&d, nm1.len, 0);
    if (st != CRYPTON_OK) goto done;
    cr_memcpy(d.v, nm1.v, nm1.len * sizeof(crypton_limb));
    d.len = nm1.len;
    uint32_t s = 0;
    while (1) {
        if ((d.v[0] & 1u) != 0u) break;
        st = crl_shr1(d.v, d.len, &d_tmp);
        crypton_limbs_free(&d);
        crypton_limbs_init(&d);
        d = d_tmp;
        crypton_limbs_init(&d_tmp);
        if (st != CRYPTON_OK) goto done;
        s += 1;
    }
    if (!crypton_mont_ctx_new(n, nn, &ctx)) {
        st = CRYPTON_ARITHMETIC_VIOLATION;
        goto done;
    }
    uint32_t rounds_eff = rounds < 1u ? 1u : (rounds > 200u ? 200u : rounds);
    for (uint32_t ri = 0; ri < rounds_eff; ri++) {
        st = crl_random_in_range(n, nn, &a);
        if (st != CRYPTON_OK) goto done;
        st = crypton_mont_mod_pow(a.v, a.len, d.v, d.len, &ctx, &x);
        crypton_limbs_free(&a);
        crypton_limbs_init(&a);
        if (st != CRYPTON_OK) goto done;
        if (crl_eq_limb(x.v, x.len, 1) || crl_vec_eq(x.v, x.len, nm1.v, nm1.len)) {
            crypton_limbs_free(&x);
            crypton_limbs_init(&x);
            continue;
        }
        bool composite = true;
        uint32_t inner = s >= 1u ? s - 1u : 0u;
        for (uint32_t si = 0; si < inner; si++) {
            crypton_limb two[1];
            two[0] = 2;
            st = crypton_mont_mod_pow(x.v, x.len, two, 1, &ctx, &x2);
            crypton_limbs_free(&x);
            crypton_limbs_init(&x);
            x = x2;
            crypton_limbs_init(&x2);
            if (st != CRYPTON_OK) goto done;
            if (crl_vec_eq(x.v, x.len, nm1.v, nm1.len)) {
                composite = false;
                break;
            }
            if (crl_eq_limb(x.v, x.len, 1)) break;
        }
        if (composite) {
            *result = false;
            st = CRYPTON_OK;
            goto done;
        }
    }
    *result = true;
    st = CRYPTON_OK;
done:
    crypton_limbs_free(&nm1);
    crypton_limbs_free(&d);
    crypton_limbs_free(&d_tmp);
    crypton_limbs_free(&a);
    crypton_limbs_free(&x);
    crypton_limbs_free(&x2);
    crypton_mont_ctx_free(&ctx);
    return st;
}

crypton_status crypton_is_probably_prime(const char *n_hex, size_t n_len, uint32_t rounds, bool *result)
{
    crypton_limbs n;
    crypton_limbs_init(&n);
    crypton_status st = crypton_hex_to_limbs(n_hex, n_len, &n);
    if (st != CRYPTON_OK) {
        crypton_limbs_free(&n);
        return st;
    }
    if (n.len > (size_t)CRYPTON_MAX_MODPOW_LIMBS) {
        crypton_limbs_free(&n);
        return CRYPTON_OPERAND_TOO_LARGE;
    }
    st = crypton_miller_rabin(n.v, n.len, rounds, result);
    crypton_limbs_free(&n);
    return st;
}
