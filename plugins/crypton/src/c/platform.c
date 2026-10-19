#ifndef __wasm__
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <unistd.h>
#endif

#include "crypton.h"

const char *crypton_status_string(crypton_status status)
{
    switch (status) {
    case CRYPTON_OK: return "ok";
    case CRYPTON_INVALID_KEY_LENGTH: return "invalid AES-256 key length: expected 32 bytes";
    case CRYPTON_INVALID_IV_LENGTH: return "invalid IV length";
    case CRYPTON_INPUT_NOT_ALIGNED: return "input length must be a multiple of 16 bytes";
    case CRYPTON_EMPTY_HEX: return "empty hex string";
    case CRYPTON_INVALID_HEX_CHAR: return "invalid character in hex string";
    case CRYPTON_DIVISION_BY_ZERO: return "division by zero";
    case CRYPTON_MODULUS_IS_ZERO: return "modulus must be non-zero";
    case CRYPTON_ZERO_ITERATIONS: return "PBKDF2 iteration count must be greater than zero";
    case CRYPTON_TOO_MANY_ITERATIONS: return "PBKDF2 iteration count exceeds the allowed maximum";
    case CRYPTON_DERIVED_KEY_TOO_LONG: return "derived output length exceeds 255 * 64 bytes";
    case CRYPTON_RANDOM_TOO_LARGE: return "random length exceeds 1 MiB limit";
    case CRYPTON_AUTHENTICATION_FAILURE: return "authentication failed: MAC mismatch";
    case CRYPTON_NO_MODULAR_INVERSE: return "input has no modular inverse for the given modulus";
    case CRYPTON_BLINDING_EXHAUSTED: return "unable to select a blinding factor for the given modulus";
    case CRYPTON_OPERAND_TOO_LARGE: return "mod_pow operand exceeds 8192 bits";
    case CRYPTON_ENTROPY_FAILURE: return "secure entropy source is unavailable";
    case CRYPTON_INVALID_ROUNDS: return "Miller-Rabin round count must be greater than zero";
    case CRYPTON_ARITHMETIC_VIOLATION: return "internal bignum arithmetic invariant violated";
    default: return "ok";
    }
}

void crypton_wipe(void *ptr, size_t len)
{
    volatile uint8_t *p = (volatile uint8_t *)ptr;
    for (size_t i = 0; i < len; i++) p[i] = 0;
    cr_compiler_fence();
}

void cr_memset(void *dst, uint8_t value, size_t len)
{
    uint8_t *d = (uint8_t *)dst;
    for (size_t i = 0; i < len; i++) d[i] = value;
}

void cr_memcpy(void *dst, const void *src, size_t len)
{
    uint8_t *d = (uint8_t *)dst;
    const uint8_t *s = (const uint8_t *)src;
    if ((uintptr_t)d >= (uintptr_t)s && (uintptr_t)d < (uintptr_t)s + len) {
        while (len--) d[len] = s[len];
    } else {
        for (size_t i = 0; i < len; i++) d[i] = s[i];
    }
}

bool crypton_ct_eq(const uint8_t *a, size_t alen, const uint8_t *b, size_t blen)
{
    uint8_t diff = ((alen ^ blen) != 0);
    size_t n = alen > blen ? alen : blen;
    for (size_t i = 0; i < n; i++) {
        uint8_t x = i < alen ? a[i] : 0;
        uint8_t y = i < blen ? b[i] : 0;
        diff |= (uint8_t)(x ^ y);
    }
    return diff == 0;
}

void crypton_buf_init(crypton_buf *buf)
{
    buf->data = NULL;
    buf->len = 0;
    buf->cap = 0;
}

crypton_status crypton_buf_reserve(crypton_buf *buf, size_t need)
{
    if (need <= buf->cap) return CRYPTON_OK;
    size_t want = buf->cap ? buf->cap * 2 : 16;
    while (want < need) want *= 2;
    uint8_t *p = cr_realloc(buf->data, buf->cap, want);
    buf->data = p;
    buf->cap = want;
    return CRYPTON_OK;
}

crypton_status crypton_buf_append(crypton_buf *buf, const uint8_t *src, size_t len)
{
    crypton_status st = crypton_buf_reserve(buf, buf->len + len);
    if (st != CRYPTON_OK) return st;
    cr_memcpy(buf->data + buf->len, src, len);
    buf->len += len;
    return CRYPTON_OK;
}

void crypton_buf_truncate(crypton_buf *buf, size_t len)
{
    if (len < buf->len) buf->len = len;
}

void crypton_buf_free(crypton_buf *buf)
{
    if (buf->data) crypton_wipe(buf->data, buf->cap);
    cr_free(buf->data, buf->cap);
    buf->data = NULL;
    buf->len = 0;
    buf->cap = 0;
}

void crypton_limbs_init(crypton_limbs *v)
{
    v->v = NULL;
    v->len = 0;
    v->cap = 0;
}

crypton_status crypton_limbs_reserve(crypton_limbs *v, size_t need)
{
    if (need <= v->cap) return CRYPTON_OK;
    size_t want = v->cap ? v->cap * 2 : 4;
    while (want < need) want *= 2;
    crypton_limb *p = cr_realloc(v->v, v->cap * sizeof(crypton_limb), want * sizeof(crypton_limb));
    v->v = p;
    v->cap = want;
    return CRYPTON_OK;
}

crypton_status crypton_limbs_resize(crypton_limbs *v, size_t need, crypton_limb fill)
{
    crypton_status st = crypton_limbs_reserve(v, need);
    if (st != CRYPTON_OK) return st;
    if (need > v->len) {
        for (size_t i = v->len; i < need; i++) v->v[i] = fill;
        v->len = need;
    } else if (need < v->len) {
        crypton_wipe(v->v + need, (v->len - need) * sizeof(crypton_limb));
        v->len = need;
    }
    return CRYPTON_OK;
}

void crypton_limbs_trim(crypton_limbs *v)
{
    while (v->len > 1 && v->v[v->len - 1] == 0) v->len--;
}

void crypton_limbs_free(crypton_limbs *v)
{
    if (v->v) crypton_wipe(v->v, v->cap * sizeof(crypton_limb));
    cr_free(v->v, v->cap * sizeof(crypton_limb));
    v->v = NULL;
    v->len = 0;
    v->cap = 0;
}

crypton_status crypton_get_random_bytes(size_t len, crypton_buf *out)
{
    if (len > (size_t)CRYPTON_MAX_RANDOM_BYTES) return CRYPTON_RANDOM_TOO_LARGE;
    if (len == 0) {
        crypton_buf_init(out);
        return CRYPTON_OK;
    }
    crypton_status st = crypton_buf_reserve(out, len);
    if (st != CRYPTON_OK) return st;
    size_t off = 0;
    while (off < len) {
        size_t chunk = len - off > (size_t)CRYPTON_MAX_RANDOM_CHUNK ? (size_t)CRYPTON_MAX_RANDOM_CHUNK : len - off;
        crypton_status rs = crypton_random_fill(out->data + off, chunk);
        if (rs != CRYPTON_OK) {
            crypton_buf_free(out);
            return rs;
        }
        off += chunk;
    }
    out->len = len;
    return CRYPTON_OK;
}

void cr_mul64(uint64_t a, uint64_t b, uint64_t *lo, uint64_t *hi)
{
    uint64_t alo = a & 0xffffffffULL;
    uint64_t ahi = a >> 32;
    uint64_t blo = b & 0xffffffffULL;
    uint64_t bhi = b >> 32;
    uint64_t p0 = alo * blo;
    uint64_t p1 = alo * bhi;
    uint64_t p2 = ahi * blo;
    uint64_t p3 = ahi * bhi;
    uint64_t m1 = (p0 >> 32) + (p1 & 0xffffffffULL) + (p2 & 0xffffffffULL);
    *lo = (p0 & 0xffffffffULL) | (m1 << 32);
    uint64_t m2 = (p1 >> 32) + (p2 >> 32) + (p3 & 0xffffffffULL) + (m1 >> 32);
    uint64_t limb3 = (p3 >> 32) + (m2 >> 32);
    *hi = (limb3 << 32) | (m2 & 0xffffffffULL);
}

#ifdef __wasm__

__attribute__((import_module("env"), import_name("js_get_random_values")))
void js_get_random_values(uint8_t *dst, uint32_t n);

crypton_status crypton_random_fill(uint8_t *dst, size_t n)
{
    if (n == 0) return CRYPTON_OK;
    js_get_random_values(dst, (uint32_t)n);
    return CRYPTON_OK;
}

void *memset(void *dst, int c, size_t n)
{
    uint8_t *d = (uint8_t *)dst;
    while (n--) *d++ = (uint8_t)c;
    return dst;
}

void *memcpy(void *dst, const void *src, size_t n)
{
    cr_memcpy(dst, src, n);
    return dst;
}

void *memmove(void *dst, const void *src, size_t n)
{
    cr_memcpy(dst, src, n);
    return dst;
}

static void cr_trap(void)
{
    __builtin_trap();
}

#define CR_MIN_BLOCK ((size_t)16)
#define CR_TOP_CLASS ((size_t)27)

typedef struct cr_node {
    size_t size;
    struct cr_node *next;
} cr_node;

static cr_node *cr_class[CR_TOP_CLASS + 1];
static uint8_t *cr_top;
static uint8_t *cr_lim;
static int cr_ready;

static size_t cr_total_for(size_t n)
{
    size_t total = n + sizeof(cr_node);
    if (total < CR_MIN_BLOCK) total = CR_MIN_BLOCK;
    return total;
}

static size_t cr_class_of(size_t total)
{
    size_t s = CR_MIN_BLOCK;
    size_t c = 4;
    while (s < total) {
        s <<= 1;
        c++;
    }
    return c;
}

static size_t cr_mem_bytes(void)
{
    return (size_t)__builtin_wasm_memory_size(0) << 16;
}

static void cr_ensure(size_t total)
{
    while ((uintptr_t)cr_top + total > (uintptr_t)cr_lim) {
        size_t need = ((uintptr_t)cr_top + total) - (uintptr_t)cr_lim;
        size_t pages = (need >> 16) + 2;
        if ((size_t)__builtin_wasm_memory_grow(0, (int)pages) == (size_t)-1) cr_trap();
        cr_lim = (uint8_t *)cr_mem_bytes();
    }
}

static void cr_heap_init(void)
{
    cr_top = (uint8_t *)cr_mem_bytes();
    cr_lim = cr_top;
    for (size_t i = 0; i <= CR_TOP_CLASS; i++) cr_class[i] = NULL;
    cr_ready = 1;
}

void *cr_alloc(size_t size)
{
    if (!cr_ready) cr_heap_init();
    size_t total = cr_total_for(size);
    size_t cls = cr_class_of(total);
    for (size_t k = cls; k <= CR_TOP_CLASS; k++) {
        cr_node *node = cr_class[k];
        if (node) {
            cr_class[k] = node->next;
            node->next = NULL;
            return (uint8_t *)node + sizeof(cr_node);
        }
    }
    if (cls > CR_TOP_CLASS) cr_trap();
    size_t block = (size_t)1 << cls;
    cr_ensure(block);
    cr_node *node = (cr_node *)cr_top;
    node->size = block;
    cr_top += block;
    return (uint8_t *)node + sizeof(cr_node);
}

void cr_free(void *ptr, size_t size)
{
    (void)size;
    if (!ptr) return;
    cr_node *node = (cr_node *)((uint8_t *)ptr - sizeof(cr_node));
    size_t cls = cr_class_of(node->size);
    node->next = cr_class[cls];
    cr_class[cls] = node;
}

void *cr_realloc(void *ptr, size_t old_size, size_t new_size)
{
    void *q = cr_alloc(new_size);
    cr_memcpy(q, ptr, old_size < new_size ? old_size : new_size);
    crypton_wipe(ptr, old_size);
    cr_free(ptr, old_size);
    return q;
}

unsigned __int128 __multi3(unsigned __int128 a, unsigned __int128 b)
{
    uint64_t t0lo, t0hi, p1lo, p2lo, junk;
    cr_mul64((uint64_t)a, (uint64_t)b, &t0lo, &t0hi);
    cr_mul64((uint64_t)a, (uint64_t)(b >> 64), &p1lo, &junk);
    cr_mul64((uint64_t)(a >> 64), (uint64_t)b, &p2lo, &junk);    uint64_t hi = t0hi + p1lo + p2lo;
    return ((unsigned __int128)hi << 64) | t0lo;
}

unsigned __int128 __udivti3(unsigned __int128 a, unsigned __int128 b)
{
    uint64_t ah = (uint64_t)(a >> 64), al = (uint64_t)a;
    uint64_t bh = (uint64_t)(b >> 64), bl = (uint64_t)b;
    uint64_t qh = 0, ql = 0, rh = 0, rl = 0;
    for (int i = 127; i >= 0; i--) {
        rh = (rh << 1) | (rl >> 63);
        rl <<= 1;
        uint64_t bit;
        if (i < 64) bit = (al >> i) & 1u;
        else bit = (ah >> (i - 64)) & 1u;
        rl |= bit;
        uint64_t ge = (rh > bh) || (rh == bh && rl >= bl);
        if (ge) {
            uint64_t borrow = (rl < bl);
            rl -= bl;
            rh -= bh + borrow;
            if (i < 64) ql |= (uint64_t)1 << i;
            else qh |= (uint64_t)1 << (i - 64);
        }
    }
    return ((unsigned __int128)qh << 64) | ql;
}

unsigned __int128 __umodti3(unsigned __int128 a, unsigned __int128 b)
{
    unsigned __int128 q = __udivti3(a, b);
    unsigned __int128 qb = __multi3(q, b);
    unsigned __int128 r = a - qb;
    return r;
}

size_t strlen(const char *s)
{
    size_t n = 0;
    while (s[n] != 0) n++;
    return n;
}

int memcmp(const void *a, const void *b, size_t n)
{
    const uint8_t *x = (const uint8_t *)a;
    const uint8_t *y = (const uint8_t *)b;
    for (size_t i = 0; i < n; i++) {
        if (x[i] != y[i]) return x[i] < y[i] ? -1 : 1;
    }
    return 0;
}

int strcmp(const char *a, const char *b)
{
    for (size_t i = 0;; i++) {
        uint8_t x = (uint8_t)a[i];
        uint8_t y = (uint8_t)b[i];
        if (x != y) return x < y ? -1 : 1;
        if (x == 0) return 0;
    }
}

int strncmp(const char *a, const char *b, size_t n)
{
    for (size_t i = 0; i < n; i++) {
        uint8_t x = (uint8_t)a[i];
        uint8_t y = (uint8_t)b[i];
        if (x != y) return x < y ? -1 : 1;
        if (x == 0) return 0;
    }
    return 0;
}

const char *strchr(const char *s, int c)
{
    uint8_t ch = (uint8_t)c;
    for (size_t i = 0;; i++) {
        if ((uint8_t)s[i] == ch) return s + i;
        if (s[i] == 0) return NULL;
    }
}

#else

static void cr_trap(void)
{
    abort();
}

void *cr_alloc(size_t size)
{
    void *p = malloc(size ? size : 1);
    if (!p) cr_trap();
    return p;
}

void cr_free(void *ptr, size_t size)
{
    (void)size;
    free(ptr);
}

void *cr_realloc(void *ptr, size_t old_size, size_t new_size)
{
    if (!ptr) return cr_alloc(new_size);
    void *q = malloc(new_size ? new_size : 1);
    if (!q) cr_trap();
    cr_memcpy(q, ptr, old_size < new_size ? old_size : new_size);
    crypton_wipe(ptr, old_size);
    free(ptr);
    return q;
}

crypton_status crypton_random_fill(uint8_t *dst, size_t n)
{
    if (n == 0) return CRYPTON_OK;
    int fd = open("/dev/urandom", O_RDONLY);
    if (fd < 0) return CRYPTON_ENTROPY_FAILURE;
    size_t done = 0;
    while (done < n) {
        ssize_t r = read(fd, dst + done, n - done);
        if (r <= 0) {
            if (r < 0 && errno == EINTR) continue;
            close(fd);
            return CRYPTON_ENTROPY_FAILURE;
        }
        done += (size_t)r;
    }
    close(fd);
    return CRYPTON_OK;
}

#endif
