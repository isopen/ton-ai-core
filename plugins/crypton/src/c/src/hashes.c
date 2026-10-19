#include "crypton.h"

static uint32_t rotr32(uint32_t x, uint32_t n)
{
    if (n == 0) return x;
    return (x >> n) | (x << (32 - n));
}

static uint64_t rotr64(uint64_t x, uint32_t n)
{
    if (n == 0) return x;
    return (x >> n) | (x << (64 - n));
}

static uint32_t load_be32(const uint8_t *p)
{
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

static uint64_t load_be64(const uint8_t *p)
{
    uint64_t v = 0;
    for (size_t i = 0; i < 8; i++) v = (v << 8) | p[i];
    return v;
}

static void store_be32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v >> 24);
    p[1] = (uint8_t)(v >> 16);
    p[2] = (uint8_t)(v >> 8);
    p[3] = (uint8_t)v;
}

static void store_be64(uint8_t *p, uint64_t v)
{
    for (size_t i = 0; i < 8; i++) p[i] = (uint8_t)(v >> (56 - 8 * i));
}

static const uint32_t SHA1_H0[5] = {0x67452301u, 0xefcdab89u, 0x98badcfeu, 0x10325476u, 0xc3d2e1f0u};

static void sha1_compress(uint32_t h[5], const uint8_t *block)
{
    uint32_t w[80];
    for (size_t i = 0; i < 16; i++) w[i] = load_be32(block + i * 4);
    for (size_t i = 16; i < 80; i++)
        w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]) << 1 | (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]) >> 31;
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
    for (size_t i = 0; i < 80; i++) {
        uint32_t f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999u; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1u; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdcu; }
        else { f = b ^ c ^ d; k = 0xca62c1d6u; }
        uint32_t tmp = (a << 5 | a >> 27) + f + e + k + w[i];
        e = d;
        d = c;
        c = b << 30 | b >> 2;
        b = a;
        a = tmp;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
}

void crypton_sha1(const uint8_t *data, size_t len, uint8_t out[20])
{
    uint32_t h[5];
    cr_memcpy(h, SHA1_H0, sizeof(h));
    uint64_t bit_len = (uint64_t)len * 8u;
    for (size_t off = 0; off + 64 <= len; off += 64) sha1_compress(h, data + off);
    size_t rem = len % 64;
    size_t tail_len = rem + 9 <= 64 ? 64 : 128;
    uint8_t tail[128];
    cr_memset(tail, 0, sizeof(tail));
    cr_memcpy(tail, data + (len - rem), rem);
    tail[rem] = 0x80;
    store_be64(tail + tail_len - 8, bit_len);
    sha1_compress(h, tail);
    if (tail_len == 128) sha1_compress(h, tail + 64);
    for (size_t i = 0; i < 5; i++) store_be32(out + i * 4, h[i]);
    crypton_wipe(h, sizeof(h));
    crypton_wipe(tail, sizeof(tail));
}

static const uint32_t K256[64] = {
    0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
    0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
    0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
    0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
    0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
    0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
    0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
    0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
};

static void sha256_compress(uint32_t h[8], const uint8_t *block)
{
    uint32_t w[64];
    for (size_t i = 0; i < 16; i++) w[i] = load_be32(block + i * 4);
    for (size_t i = 16; i < 64; i++) {
        uint32_t x = w[i - 15];
        uint32_t s0 = rotr32(x, 7) ^ rotr32(x, 18) ^ (x >> 3);
        uint32_t y = w[i - 2];
        uint32_t s1 = rotr32(y, 17) ^ rotr32(y, 19) ^ (y >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t v[8];
    cr_memcpy(v, h, sizeof(v));
    for (size_t i = 0; i < 64; i++) {
        uint32_t s1 = rotr32(v[4], 6) ^ rotr32(v[4], 11) ^ rotr32(v[4], 25);
        uint32_t ch = (v[4] & v[5]) | (~v[4] & v[6]);
        uint32_t t1 = v[7] + s1 + ch + K256[i] + w[i];
        uint32_t s0 = rotr32(v[0], 2) ^ rotr32(v[0], 13) ^ rotr32(v[0], 22);
        uint32_t maj = (v[0] & v[1]) | (v[0] & v[2]) | (v[1] & v[2]);
        uint32_t t2 = s0 + maj;
        v[7] = v[6];
        v[6] = v[5];
        v[5] = v[4];
        v[4] = v[3] + t1;
        v[3] = v[2];
        v[2] = v[1];
        v[1] = v[0];
        v[0] = t1 + t2;
    }
    for (size_t i = 0; i < 8; i++) h[i] += v[i];
}

void crypton_sha256(const uint8_t *data, size_t len, uint8_t out[32])
{
    static const uint32_t H0[8] = {
        0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,
        0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u
    };
    uint32_t h[8];
    cr_memcpy(h, H0, sizeof(h));
    uint64_t bit_len = (uint64_t)len * 8u;
    for (size_t off = 0; off + 64 <= len; off += 64) sha256_compress(h, data + off);
    size_t rem = len % 64;
    size_t tail_len = rem + 9 <= 64 ? 64 : 128;
    uint8_t tail[128];
    cr_memset(tail, 0, sizeof(tail));
    cr_memcpy(tail, data + (len - rem), rem);
    tail[rem] = 0x80;
    store_be64(tail + tail_len - 8, bit_len);
    sha256_compress(h, tail);
    if (tail_len == 128) sha256_compress(h, tail + 64);
    for (size_t i = 0; i < 8; i++) store_be32(out + i * 4, h[i]);
    crypton_wipe(h, sizeof(h));
    crypton_wipe(tail, sizeof(tail));
}

static const uint64_t K512[80] = {
    0x428a2f98d728ae22ull,0x7137449123ef65cdull,0xb5c0fbcfec4d3b2full,0xe9b5dba58189dbbcull,
    0x3956c25bf348b538ull,0x59f111f1b605d019ull,0x923f82a4af194f9bull,0xab1c5ed5da6d8118ull,
    0xd807aa98a3030242ull,0x12835b0145706fbeull,0x243185be4ee4b28cull,0x550c7dc3d5ffb4e2ull,
    0x72be5d74f27b896full,0x80deb1fe3b1696b1ull,0x9bdc06a725c71235ull,0xc19bf174cf692694ull,
    0xe49b69c19ef14ad2ull,0xefbe4786384f25e3ull,0x0fc19dc68b8cd5b5ull,0x240ca1cc77ac9c65ull,
    0x2de92c6f592b0275ull,0x4a7484aa6ea6e483ull,0x5cb0a9dcbd41fbd4ull,0x76f988da831153b5ull,
    0x983e5152ee66dfabull,0xa831c66d2db43210ull,0xb00327c898fb213full,0xbf597fc7beef0ee4ull,
    0xc6e00bf33da88fc2ull,0xd5a79147930aa725ull,0x06ca6351e003826full,0x142929670a0e6e70ull,
    0x27b70a8546d22ffcull,0x2e1b21385c26c926ull,0x4d2c6dfc5ac42aedull,0x53380d139d95b3dfull,
    0x650a73548baf63deull,0x766a0abb3c77b2a8ull,0x81c2c92e47edaee6ull,0x92722c851482353bull,
    0xa2bfe8a14cf10364ull,0xa81a664bbc423001ull,0xc24b8b70d0f89791ull,0xc76c51a30654be30ull,
    0xd192e819d6ef5218ull,0xd69906245565a910ull,0xf40e35855771202aull,0x106aa07032bbd1b8ull,
    0x19a4c116b8d2d0c8ull,0x1e376c085141ab53ull,0x2748774cdf8eeb99ull,0x34b0bcb5e19b48a8ull,
    0x391c0cb3c5c95a63ull,0x4ed8aa4ae3418acbull,0x5b9cca4f7763e373ull,0x682e6ff3d6b2b8a3ull,
    0x748f82ee5defb2fcull,0x78a5636f43172f60ull,0x84c87814a1f0ab72ull,0x8cc702081a6439ecull,
    0x90befffa23631e28ull,0xa4506cebde82bde9ull,0xbef9a3f7b2c67915ull,0xc67178f2e372532bull,
    0xca273eceea26619cull,0xd186b8c721c0c207ull,0xeada7dd6cde0eb1eull,0xf57d4f7fee6ed178ull,
    0x06f067aa72176fbaull,0x0a637dc5a2c898a6ull,0x113f9804bef90daeull,0x1b710b35131c471bull,
    0x28db77f523047d84ull,0x32caab7b40c72493ull,0x3c9ebe0a15c9bebcull,0x431d67c49c100d4cull,
    0x4cc5d4becb3e42b6ull,0x597f299cfc657e2aull,0x5fcb6fab3ad6faecull,0x6c44198c4a475817ull
};

static void sha512_compress(uint64_t h[8], const uint8_t *block)
{
    uint64_t w[80];
    for (size_t i = 0; i < 16; i++) w[i] = load_be64(block + i * 8);
    for (size_t i = 16; i < 80; i++) {
        uint64_t x = w[i - 15];
        uint64_t s0 = rotr64(x, 1) ^ rotr64(x, 8) ^ (x >> 7);
        uint64_t y = w[i - 2];
        uint64_t s1 = rotr64(y, 19) ^ rotr64(y, 61) ^ (y >> 6);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint64_t v[8];
    cr_memcpy(v, h, sizeof(v));
    for (size_t i = 0; i < 80; i++) {
        uint64_t s1 = rotr64(v[4], 14) ^ rotr64(v[4], 18) ^ rotr64(v[4], 41);
        uint64_t ch = (v[4] & v[5]) | (~v[4] & v[6]);
        uint64_t t1 = v[7] + s1 + ch + K512[i] + w[i];
        uint64_t s0 = rotr64(v[0], 28) ^ rotr64(v[0], 34) ^ rotr64(v[0], 39);
        uint64_t maj = (v[0] & v[1]) | (v[0] & v[2]) | (v[1] & v[2]);
        uint64_t t2 = s0 + maj;
        v[7] = v[6];
        v[6] = v[5];
        v[5] = v[4];
        v[4] = v[3] + t1;
        v[3] = v[2];
        v[2] = v[1];
        v[1] = v[0];
        v[0] = t1 + t2;
    }
    for (size_t i = 0; i < 8; i++) h[i] += v[i];
}

void crypton_sha512(const uint8_t *data, size_t len, uint8_t out[64])
{
    static const uint64_t H0[8] = {
        0x6a09e667f3bcc908ull,0xbb67ae8584caa73bull,0x3c6ef372fe94f82bull,0xa54ff53a5f1d36f1ull,
        0x510e527fade682d1ull,0x9b05688c2b3e6c1full,0x1f83d9abfb41bd6bull,0x5be0cd19137e2179ull
    };
    uint64_t h[8];
    cr_memcpy(h, H0, sizeof(h));
    for (size_t off = 0; off + 128 <= len; off += 128) sha512_compress(h, data + off);
    size_t rem = len % 128;
    size_t tail_len = rem + 17 <= 128 ? 128 : 256;
    uint8_t tail[256];
    cr_memset(tail, 0, sizeof(tail));
    cr_memcpy(tail, data + (len - rem), rem);
    tail[rem] = 0x80;
    uint64_t len_hi = (uint64_t)len >> 61;
    uint64_t len_lo = (uint64_t)len << 3;
    store_be64(tail + tail_len - 16, len_hi);
    store_be64(tail + tail_len - 8, len_lo);
    sha512_compress(h, tail);
    if (tail_len == 256) sha512_compress(h, tail + 128);
    for (size_t i = 0; i < 8; i++) store_be64(out + i * 8, h[i]);
    crypton_wipe(h, sizeof(h));
    crypton_wipe(tail, sizeof(tail));
}
