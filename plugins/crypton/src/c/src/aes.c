#include "crypton.h"

static const uint8_t SBOX[256] = {
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
};

static uint8_t INV_SBOX[256];
static int inv_sbox_ready;

static void inv_sbox_build(void)
{
    for (int i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = (uint8_t)i;
    inv_sbox_ready = 1;
}

static uint8_t gmul(uint8_t a, uint8_t b)
{
    uint8_t p = 0;
    for (int i = 0; i < 8; i++) {
        uint8_t lo_mask = (uint8_t)(0u - (uint8_t)(b & 1));
        p ^= a & lo_mask;
        uint8_t hi = a & 0x80;
        a <<= 1;
        uint8_t reduce = (uint8_t)(0u - (uint8_t)(hi >> 7));
        a ^= 0x1b & reduce;
        b >>= 1;
    }
    return p;
}

uint8_t crypton_aes_sbox_byte(uint8_t b)
{
    return SBOX[b];
}

uint8_t crypton_aes_inv_sbox_byte(uint8_t y)
{
    if (!inv_sbox_ready) inv_sbox_build();
    return INV_SBOX[y];
}

crypton_status crypton_aes_key_expansion(const uint8_t *key, size_t key_len, uint8_t round_keys[15][16])
{
    static const uint8_t RCON[7] = {0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40};
    if (key_len != 32) return CRYPTON_INVALID_KEY_LENGTH;
    uint8_t w[240];
    cr_memcpy(w, key, 32);
    cr_memset(w + 32, 0, 240 - 32);
    size_t rcon_i = 0;
    for (size_t i = 32; i < 240; i += 4) {
        uint8_t t[4];
        t[0] = w[i - 4];
        t[1] = w[i - 3];
        t[2] = w[i - 2];
        t[3] = w[i - 1];
        if (i % 32 == 0) {
            uint8_t s0 = crypton_aes_sbox_byte(t[1]);
            uint8_t s1 = crypton_aes_sbox_byte(t[2]);
            uint8_t s2 = crypton_aes_sbox_byte(t[3]);
            uint8_t s3 = crypton_aes_sbox_byte(t[0]);
            t[0] = s0;
            t[1] = s1;
            t[2] = s2;
            t[3] = s3;
            t[0] ^= RCON[rcon_i];
            rcon_i++;
        } else if (i % 32 == 16) {
            uint8_t s0 = crypton_aes_sbox_byte(t[0]);
            uint8_t s1 = crypton_aes_sbox_byte(t[1]);
            uint8_t s2 = crypton_aes_sbox_byte(t[2]);
            uint8_t s3 = crypton_aes_sbox_byte(t[3]);
            t[0] = s0;
            t[1] = s1;
            t[2] = s2;
            t[3] = s3;
        }
        for (size_t j = 0; j < 4; j++) w[i + j] = (uint8_t)(w[i - 32 + j] ^ t[j]);
    }
    for (size_t r = 0; r < 15; r++) cr_memcpy(round_keys[r], w + r * 16, 16);
    crypton_wipe(w, 240);
    return CRYPTON_OK;
}

static void xor_round_key(uint8_t *b, const uint8_t *k)
{
    for (size_t i = 0; i < 16; i++) b[i] ^= k[i];
}

static void sub_bytes(uint8_t *b)
{
    for (size_t i = 0; i < 16; i++) b[i] = crypton_aes_sbox_byte(b[i]);
}

static void inv_sub_bytes(uint8_t *b)
{
    for (size_t i = 0; i < 16; i++) b[i] = crypton_aes_inv_sbox_byte(b[i]);
}

static void shift_rows(uint8_t *b)
{
    uint8_t t[16];
    cr_memcpy(t, b, 16);
    b[1] = t[5];
    b[5] = t[9];
    b[9] = t[13];
    b[13] = t[1];
    b[2] = t[10];
    b[6] = t[14];
    b[10] = t[2];
    b[14] = t[6];
    b[3] = t[15];
    b[7] = t[3];
    b[11] = t[7];
    b[15] = t[11];
}

static void inv_shift_rows(uint8_t *b)
{
    uint8_t t[16];
    cr_memcpy(t, b, 16);
    b[5] = t[1];
    b[9] = t[5];
    b[13] = t[9];
    b[1] = t[13];
    b[10] = t[2];
    b[14] = t[6];
    b[2] = t[10];
    b[6] = t[14];
    b[15] = t[3];
    b[3] = t[7];
    b[7] = t[11];
    b[11] = t[15];
}

static void mix_columns(uint8_t *b)
{
    for (size_t c = 0; c < 4; c++) {
        size_t o = c * 4;
        uint8_t a0 = b[o], a1 = b[o + 1], a2 = b[o + 2], a3 = b[o + 3];
        b[o] = (uint8_t)(gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3);
        b[o + 1] = (uint8_t)(a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3);
        b[o + 2] = (uint8_t)(a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3));
        b[o + 3] = (uint8_t)(gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2));
    }
}

static void inv_mix_columns(uint8_t *b)
{
    for (size_t c = 0; c < 4; c++) {
        size_t o = c * 4;
        uint8_t a0 = b[o], a1 = b[o + 1], a2 = b[o + 2], a3 = b[o + 3];
        b[o] = (uint8_t)(gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9));
        b[o + 1] = (uint8_t)(gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13));
        b[o + 2] = (uint8_t)(gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11));
        b[o + 3] = (uint8_t)(gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14));
    }
}

void crypton_aes256_encrypt_block(const uint8_t rk[15][16], uint8_t block[16])
{
    xor_round_key(block, rk[0]);
    for (size_t r = 1; r < 14; r++) {
        sub_bytes(block);
        shift_rows(block);
        mix_columns(block);
        xor_round_key(block, rk[r]);
    }
    sub_bytes(block);
    shift_rows(block);
    xor_round_key(block, rk[14]);
}

void crypton_aes256_decrypt_block(const uint8_t rk[15][16], uint8_t block[16])
{
    xor_round_key(block, rk[14]);
    for (size_t r = 13; r >= 1; r--) {
        inv_shift_rows(block);
        inv_sub_bytes(block);
        xor_round_key(block, rk[r]);
        inv_mix_columns(block);
    }
    inv_shift_rows(block);
    inv_sub_bytes(block);
    xor_round_key(block, rk[0]);
}
