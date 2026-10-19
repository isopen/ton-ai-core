#include "crypton.h"

#define KR_THRESHOLD 24

static crypton_status bl_set(crypton_limbs *v, const crypton_limb *src, size_t n)
{
    crypton_status st = crypton_limbs_reserve(v, n);
    if (st != CRYPTON_OK) return st;
    cr_memcpy(v->v, src, n * sizeof(crypton_limb));
    v->len = n;
    return CRYPTON_OK;
}

bool crypton_bigint_is_zero(const crypton_limb *a, size_t an)
{
    uint64_t acc = 0;
    for (size_t i = 0; i < an; i++) acc |= a[i];
    return acc == 0;
}

int crypton_bigint_cmp(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn)
{
    if (an != bn) return an < bn ? -1 : 1;
    uint64_t gt = 0;
    uint64_t lt = 0;
    for (size_t i = an; i-- > 0;) {
        uint64_t agt = a[i] > b[i] ? 1u : 0u;
        uint64_t alt = a[i] < b[i] ? 1u : 0u;
        uint64_t undecided = (gt | lt) ^ 1u;
        gt |= undecided & agt;
        lt |= undecided & alt;
    }
    return gt == 1 ? 1 : (lt == 1 ? -1 : 0);
}

bool crypton_bigint_cmp_lt(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn)
{
    return crypton_bigint_cmp(a, an, b, bn) < 0;
}

crypton_status crypton_bigint_add(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out)
{
    size_t n = an > bn ? an : bn;
    crypton_limbs o;
    crypton_limbs_init(&o);
    crypton_status st = crypton_limbs_reserve(&o, n + 1);
    if (st != CRYPTON_OK) return st;
    uint64_t carry = 0;
    for (size_t i = 0; i < n; i++) {
        uint64_t x = i < an ? a[i] : 0;
        uint64_t y = i < bn ? b[i] : 0;
        uint64_t t = x + carry;
        uint64_t c1 = t < x ? 1u : 0u;
        uint64_t s = t + y;
        uint64_t c2 = s < t ? 1u : 0u;
        o.v[i] = s;
        carry = c1 + c2;
    }
    o.len = n;
    if (carry > 0) {
        o.v[n] = carry;
        o.len = n + 1;
    }
    if (o.len == 0) {
        o.v[0] = 0;
        o.len = 1;
    }
    crypton_limbs_trim(&o);
    *out = o;
    return CRYPTON_OK;
}

crypton_status crypton_bigint_sub(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out)
{
    crypton_limbs o;
    crypton_limbs_init(&o);
    crypton_status st = crypton_limbs_reserve(&o, an);
    if (st != CRYPTON_OK) return st;
    uint64_t brw = 0;
    for (size_t i = 0; i < an; i++) {
        uint64_t bv = i < bn ? b[i] : 0;
        uint64_t r1 = a[i] - bv;
        uint64_t u1 = a[i] < bv ? 1u : 0u;
        uint64_t r2 = r1 - brw;
        uint64_t u2 = r1 < brw ? 1u : 0u;
        o.v[i] = r2;
        brw = u1 | u2;
    }
    o.len = an;
    crypton_limbs_trim(&o);
    *out = o;
    return CRYPTON_OK;
}

crypton_status crypton_bigint_mul_schoolbook(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out)
{
    crypton_limbs c;
    crypton_limbs_init(&c);
    crypton_status st = crypton_limbs_reserve(&c, an + bn);
    if (st != CRYPTON_OK) return st;
    cr_memset(c.v, 0, (an + bn) * sizeof(crypton_limb));
    c.len = an + bn;
    for (size_t i = 0; i < an; i++) {
        uint64_t carry = 0;
        for (size_t j = 0; j < bn; j++) {
            uint64_t lo, hi;
            cr_mul64(a[i], b[j], &lo, &hi);
            uint64_t t = c.v[i + j];
            uint64_t s1 = t + lo;
            uint64_t c1 = s1 < t ? 1u : 0u;
            uint64_t s2 = s1 + carry;
            uint64_t c2 = s2 < s1 ? 1u : 0u;
            uint64_t hi2 = hi + c1 + c2;
            c.v[i + j] = s2;
            carry = hi2;
        }
        size_t k = i + bn;
        while (k < c.len) {
            uint64_t t = c.v[k] + carry;
            uint64_t cc = t < carry ? 1u : 0u;
            c.v[k] = t;
            carry = cc;
            k++;
        }
        if (carry != 0) {
            crypton_limbs_free(&c);
            return CRYPTON_ARITHMETIC_VIOLATION;
        }
    }
    crypton_limbs_trim(&c);
    *out = c;
    return CRYPTON_OK;
}

static crypton_status cr_add_shifted_into(crypton_limbs *acc, const crypton_limb *x, size_t xn, size_t sh)
{
    uint64_t carry = 0;
    for (size_t i = 0; i < xn; i++) {
        size_t pos = i + sh;
        if (pos >= acc->len) {
            crypton_status st = crypton_limbs_resize(acc, pos + 1, 0);
            if (st != CRYPTON_OK) return st;
        }
        uint64_t t = acc->v[pos] + x[i];
        uint64_t c1 = t < x[i] ? 1u : 0u;
        uint64_t t2 = t + carry;
        uint64_t c2 = t2 < t ? 1u : 0u;
        acc->v[pos] = t2;
        carry = c1 + c2;
    }
    size_t pos = xn + sh;
    while (pos < acc->len) {
        uint64_t t = acc->v[pos] + carry;
        uint64_t c = t < carry ? 1u : 0u;
        acc->v[pos] = t;
        carry = c;
        pos++;
    }
    if (carry != 0) return CRYPTON_ARITHMETIC_VIOLATION;
    return CRYPTON_OK;
}

static crypton_status cr_zpad_into(crypton_limbs *v, const crypton_limb *src, size_t n_src, size_t total)
{
    if (n_src > total) return CRYPTON_OPERAND_TOO_LARGE;
    crypton_status st = crypton_limbs_resize(v, total, 0);
    if (st != CRYPTON_OK) return st;
    cr_memcpy(v->v, src, n_src * sizeof(crypton_limb));
    return CRYPTON_OK;
}

static crypton_status cr_karatsuba(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out)
{
    size_t n = an > bn ? an : bn;
    size_t mn = an < bn ? an : bn;
    if (n < KR_THRESHOLD || mn < KR_THRESHOLD / 2) {
        return crypton_bigint_mul_schoolbook(a, an, b, bn, out);
    }
    size_t half = (n + 1) / 2;
    crypton_limbs pa, pb, z0, z2, sa, sb, z1, acc;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&pa);
    crypton_limbs_init(&pb);
    crypton_limbs_init(&z0);
    crypton_limbs_init(&z2);
    crypton_limbs_init(&sa);
    crypton_limbs_init(&sb);
    crypton_limbs_init(&z1);
    crypton_limbs_init(&acc);
    st = cr_zpad_into(&pa, a, an, half * 2);
    if (st != CRYPTON_OK) goto done;
    st = cr_zpad_into(&pb, b, bn, half * 2);
    if (st != CRYPTON_OK) goto done;
    st = cr_karatsuba(pa.v, half, pb.v, half, &z0);
    if (st != CRYPTON_OK) goto done;
    st = cr_karatsuba(pa.v + half, half, pb.v + half, half, &z2);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_add(pa.v, half, pa.v + half, half, &sa);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_add(pb.v, half, pb.v + half, half, &sb);
    if (st != CRYPTON_OK) goto done;
    st = cr_karatsuba(sa.v, sa.len, sb.v, sb.len, &z1);
    if (st != CRYPTON_OK) goto done;
    {
        crypton_limbs t1;
        crypton_limbs_init(&t1);
        st = crypton_bigint_sub(z1.v, z1.len, z0.v, z0.len, &t1);
        if (st != CRYPTON_OK) {
            crypton_limbs_free(&t1);
            goto done;
        }
        crypton_limbs_free(&z1);
        z1 = t1;
    }
    {
        crypton_limbs t2;
        crypton_limbs_init(&t2);
        st = crypton_bigint_sub(z1.v, z1.len, z2.v, z2.len, &t2);
        if (st != CRYPTON_OK) {
            crypton_limbs_free(&t2);
            goto done;
        }
        crypton_limbs_free(&z1);
        z1 = t2;
    }
    st = crypton_limbs_resize(&acc, half * 4, 0);
    if (st != CRYPTON_OK) goto done;
    st = cr_add_shifted_into(&acc, z0.v, z0.len, 0);
    if (st != CRYPTON_OK) goto done;
    st = cr_add_shifted_into(&acc, z1.v, z1.len, half);
    if (st != CRYPTON_OK) goto done;
    st = cr_add_shifted_into(&acc, z2.v, z2.len, half * 2);
    if (st != CRYPTON_OK) goto done;
    crypton_limbs_trim(&acc);
    *out = acc;
    crypton_limbs_init(&acc);
done:
    crypton_limbs_free(&pa);
    crypton_limbs_free(&pb);
    crypton_limbs_free(&z0);
    crypton_limbs_free(&z2);
    crypton_limbs_free(&sa);
    crypton_limbs_free(&sb);
    crypton_limbs_free(&z1);
    crypton_limbs_free(&acc);
    return st;
}

crypton_status crypton_bigint_mul(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out)
{
    size_t mn = an < bn ? an : bn;
    if (mn >= KR_THRESHOLD) return cr_karatsuba(a, an, b, bn, out);
    return crypton_bigint_mul_schoolbook(a, an, b, bn, out);
}

crypton_status crypton_bigint_divmod(const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *q_out, crypton_limbs *r_out)
{
    if (crypton_bigint_is_zero(b, bn)) return CRYPTON_DIVISION_BY_ZERO;
    size_t n = an;
    size_t width = bn + 1;
    crypton_limbs q, rem, t;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&q);
    crypton_limbs_init(&rem);
    crypton_limbs_init(&t);
    st = crypton_limbs_resize(&q, n > 1 ? n : 1, 0);
    if (st != CRYPTON_OK) goto done;
    st = crypton_limbs_resize(&rem, width, 0);
    if (st != CRYPTON_OK) goto done;
    st = crypton_limbs_resize(&t, width, 0);
    if (st != CRYPTON_OK) goto done;
    for (size_t bi = n * 64; bi-- > 0;) {
        uint64_t carry = 0;
        for (size_t j = 0; j < width; j++) {
            uint64_t nb = rem.v[j] >> 63;
            rem.v[j] = (rem.v[j] << 1) | carry;
            carry = nb;
        }
        rem.v[0] |= (a[bi / 64] >> (bi % 64)) & 1u;
        uint64_t brw = 0;
        for (size_t j = 0; j < width; j++) {
            uint64_t bv = j < bn ? b[j] : 0;
            uint64_t r1 = rem.v[j] - bv;
            uint64_t u1 = rem.v[j] < bv ? 1u : 0u;
            uint64_t r2 = r1 - brw;
            uint64_t u2 = r1 < brw ? 1u : 0u;
            t.v[j] = r2;
            brw = u1 | u2;
        }
        uint64_t mask = (uint64_t)0 - brw;
        for (size_t j = 0; j < width; j++) {
            rem.v[j] = (t.v[j] & ~mask) | (rem.v[j] & mask);
        }
        q.v[bi / 64] |= ((brw ^ 1u) & 1u) << (bi % 64);
    }
    crypton_limbs_trim(&q);
    crypton_limbs_trim(&rem);
    *q_out = q;
    crypton_limbs_init(&q);
    *r_out = rem;
    crypton_limbs_init(&rem);
done:
    crypton_limbs_free(&q);
    crypton_limbs_free(&rem);
    crypton_limbs_free(&t);
    return st;
}

static crypton_status cr_sub_signed(const crypton_limb *a, size_t an, int aneg, const crypton_limb *b, size_t bn, int bneg, crypton_limbs *out, int *out_neg)
{
    crypton_status st;
    if (aneg == bneg) {
        if (crypton_bigint_cmp(a, an, b, bn) < 0) {
            st = crypton_bigint_sub(b, bn, a, an, out);
            *out_neg = aneg ? 0 : 1;
        } else {
            st = crypton_bigint_sub(a, an, b, bn, out);
            *out_neg = aneg;
        }
    } else {
        st = crypton_bigint_add(a, an, b, bn, out);
        crypton_limbs_trim(out);
        *out_neg = aneg;
    }
    return st;
}

static crypton_status cr_mod_reduce_owned(crypton_limbs *a, const crypton_limb *m, size_t mn, crypton_limbs *out)
{
    crypton_limbs q, r;
    crypton_status st = crypton_bigint_divmod(a->v, a->len, m, mn, &q, &r);
    crypton_limbs_free(a);
    crypton_limbs_free(&q);
    if (st != CRYPTON_OK) {
        crypton_limbs_free(&r);
        return st;
    }
    *out = r;
    return CRYPTON_OK;
}

crypton_status crypton_bigint_mod_inv(const crypton_limb *a, size_t an, const crypton_limb *m, size_t mn, crypton_limbs *out)
{
    if (crypton_bigint_is_zero(m, mn)) return CRYPTON_MODULUS_IS_ZERO;
    if (mn == 1 && m[0] == 1) {
        crypton_status st = crypton_limbs_resize(out, 1, 0);
        if (st != CRYPTON_OK) return st;
        out->v[0] = 0;
        out->len = 1;
        return CRYPTON_OK;
    }
    crypton_limbs t, new_t, r, new_r, q, qnt, qr, diff, rsum, mag, red, qtmp;
    crypton_status st = CRYPTON_OK;
    int t_neg = 0, new_t_neg = 0, diff_neg = 0;
    crypton_limbs_init(&t);
    crypton_limbs_init(&new_t);
    crypton_limbs_init(&r);
    crypton_limbs_init(&new_r);
    crypton_limbs_init(&q);
    crypton_limbs_init(&qnt);
    crypton_limbs_init(&qr);
    crypton_limbs_init(&diff);
    crypton_limbs_init(&rsum);
    crypton_limbs_init(&mag);
    crypton_limbs_init(&red);
    crypton_limbs_init(&qtmp);
    do {
        st = crypton_limbs_resize(&t, 1, 0);
        if (st != CRYPTON_OK) break;
        t.v[0] = 0;
        t.len = 1;
        st = crypton_limbs_resize(&new_t, 1, 0);
        if (st != CRYPTON_OK) break;
        new_t.v[0] = 1;
        new_t.len = 1;
        st = bl_set(&r, m, mn);
        if (st != CRYPTON_OK) break;
        st = crypton_bigint_divmod(a, an, m, mn, &qtmp, &new_r);
        if (st != CRYPTON_OK) break;
        crypton_limbs_free(&qtmp);
        crypton_limbs_init(&qtmp);
        while (!crypton_bigint_is_zero(new_r.v, new_r.len)) {
            st = crypton_bigint_divmod(r.v, r.len, new_r.v, new_r.len, &q, &qtmp);
            if (st != CRYPTON_OK) break;
            crypton_limbs_free(&qtmp);
            crypton_limbs_init(&qtmp);
            st = crypton_bigint_mul(q.v, q.len, new_t.v, new_t.len, &qnt);
            if (st != CRYPTON_OK) break;
            st = cr_sub_signed(t.v, t.len, t_neg, qnt.v, qnt.len, new_t_neg, &diff, &diff_neg);
            if (st != CRYPTON_OK) break;
            crypton_limbs_free(&qnt);
            crypton_limbs_init(&qnt);
            {
                crypton_limbs tmp = t;
                t = new_t;
                new_t = tmp;
                int tn = t_neg;
                t_neg = new_t_neg;
                new_t_neg = tn;
            }
            crypton_limbs_free(&new_t);
            crypton_limbs_init(&new_t);
            new_t = diff;
            crypton_limbs_init(&diff);
            new_t_neg = diff_neg;
            st = crypton_bigint_mul(q.v, q.len, new_r.v, new_r.len, &qr);
            if (st != CRYPTON_OK) break;
            st = cr_sub_signed(r.v, r.len, 0, qr.v, qr.len, 0, &rsum, &diff_neg);
            if (st != CRYPTON_OK) break;
            crypton_limbs_free(&q);
            crypton_limbs_init(&q);
            crypton_limbs_free(&qr);
            crypton_limbs_init(&qr);
            {
                crypton_limbs tmp = r;
                r = new_r;
                new_r = tmp;
            }
            crypton_limbs_free(&new_r);
            crypton_limbs_init(&new_r);
            new_r = rsum;
            crypton_limbs_init(&rsum);
        }
        if (st != CRYPTON_OK) break;
        crypton_limbs_free(&new_t);
        crypton_limbs_init(&new_t);
        crypton_limbs_free(&new_r);
        crypton_limbs_init(&new_r);
        if (!(r.len == 1 && r.v[0] == 1)) {
            st = CRYPTON_NO_MODULAR_INVERSE;
            break;
        }
        if (t_neg) {
            st = crypton_bigint_sub(m, mn, t.v, t.len, &mag);
            if (st != CRYPTON_OK) break;
            crypton_limbs_free(&t);
            crypton_limbs_init(&t);
            st = cr_mod_reduce_owned(&mag, m, mn, &red);
            crypton_limbs_init(&mag);
        } else {
            st = cr_mod_reduce_owned(&t, m, mn, &red);
            crypton_limbs_init(&t);
        }
        if (st != CRYPTON_OK) break;
        *out = red;
        crypton_limbs_init(&red);
    } while (0);
    crypton_limbs_free(&t);
    crypton_limbs_free(&new_t);
    crypton_limbs_free(&r);
    crypton_limbs_free(&new_r);
    crypton_limbs_free(&q);
    crypton_limbs_free(&qnt);
    crypton_limbs_free(&qr);
    crypton_limbs_free(&diff);
    crypton_limbs_free(&rsum);
    crypton_limbs_free(&mag);
    crypton_limbs_free(&red);
    crypton_limbs_free(&qtmp);
    return st;
}

static crypton_status bl_push(crypton_limbs *v, crypton_limb x)
{
    crypton_status st = crypton_limbs_reserve(v, v->len + 1);
    if (st != CRYPTON_OK) return st;
    v->v[v->len] = x;
    v->len = v->len + 1;
    return CRYPTON_OK;
}

crypton_status crypton_bytes_to_limbs_be(const uint8_t *bytes, size_t len, crypton_limbs *out)
{
    crypton_limbs o;
    crypton_limbs_init(&o);
    crypton_status st = crypton_limbs_reserve(&o, len / 8 + 2);
    if (st != CRYPTON_OK) return st;
    size_t pad = (8 - len % 8) % 8;
    uint64_t acc = 0;
    size_t filled = 0;
    for (size_t i = 0; i < pad; i++) {
        acc = acc << 8;
        filled++;
        if (filled == 8) {
            st = bl_push(&o, acc);
            if (st != CRYPTON_OK) {
                crypton_limbs_free(&o);
                return st;
            }
            acc = 0;
            filled = 0;
        }
    }
    for (size_t i = 0; i < len; i++) {
        acc = (acc << 8) | (uint64_t)bytes[i];
        filled++;
        if (filled == 8) {
            st = bl_push(&o, acc);
            if (st != CRYPTON_OK) {
                crypton_limbs_free(&o);
                return st;
            }
            acc = 0;
            filled = 0;
        }
    }
    if (o.len == 0) {
        st = bl_push(&o, 0);
        if (st != CRYPTON_OK) {
            crypton_limbs_free(&o);
            return st;
        }
    }
    crypton_limbs_trim(&o);
    *out = o;
    return CRYPTON_OK;
}

static crypton_status cr_select(bool bit, const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out)
{
    uint64_t mask = bit ? ~(uint64_t)0 : 0;
    size_t n = an > bn ? an : bn;
    crypton_status st = crypton_limbs_resize(out, n, 0);
    if (st != CRYPTON_OK) return st;
    for (size_t i = 0; i < n; i++) {
        uint64_t x = i < an ? a[i] : 0;
        uint64_t y = i < bn ? b[i] : 0;
        out->v[i] = (x & mask) | (y & ~mask);
    }
    out->len = n;
    return CRYPTON_OK;
}

bool crypton_mont_ctx_new(const crypton_limb *m_raw, size_t m_raw_len, crypton_mont_ctx *ctx)
{
    ctx->n = 0;
    ctx->m = NULL;
    ctx->n0 = 0;
    ctx->r1 = NULL;
    ctx->r2 = NULL;
    if (m_raw_len == 0 || crypton_bigint_is_zero(m_raw, m_raw_len)) return false;
    if ((m_raw[0] & 1u) == 0) return false;
    size_t n = m_raw_len;
    uint64_t inv = 1;
    uint64_t m0 = m_raw[0];
    for (int i = 0; i < 6; i++) {
        inv = inv * (2ull - m0 * inv);
    }
    uint64_t n0 = (uint64_t)(0u - inv);
    crypton_limbs r_val, qq, rr, prod, r1p, r2raw, r2p;
    crypton_status st = CRYPTON_OK;
    bool ok = false;
    crypton_limbs_init(&r_val);
    crypton_limbs_init(&qq);
    crypton_limbs_init(&rr);
    crypton_limbs_init(&prod);
    crypton_limbs_init(&r1p);
    crypton_limbs_init(&r2raw);
    crypton_limbs_init(&r2p);
    st = crypton_limbs_resize(&r_val, n + 1, 0);
    if (st != CRYPTON_OK) goto done;
    r_val.v[n] = 1;
    r_val.len = n + 1;
    st = crypton_bigint_divmod(r_val.v, r_val.len, m_raw, m_raw_len, &qq, &rr);
    if (st != CRYPTON_OK) goto done;
    crypton_limbs_free(&qq);
    crypton_limbs_init(&qq);
    crypton_limbs_trim(&rr);
    if (rr.len > n) {
        st = CRYPTON_OPERAND_TOO_LARGE;
        goto done;
    }
    st = crypton_limbs_resize(&r1p, n, 0);
    if (st != CRYPTON_OK) goto done;
    cr_memcpy(r1p.v, rr.v, rr.len * sizeof(crypton_limb));
    r1p.len = n;
    st = crypton_bigint_mul(r1p.v, r1p.len, r1p.v, r1p.len, &prod);
    if (st != CRYPTON_OK) goto done;
    st = crypton_bigint_divmod(prod.v, prod.len, m_raw, m_raw_len, &qq, &r2raw);
    if (st != CRYPTON_OK) goto done;
    crypton_limbs_free(&qq);
    crypton_limbs_init(&qq);
    crypton_limbs_trim(&r2raw);
    if (r2raw.len > n) {
        st = CRYPTON_OPERAND_TOO_LARGE;
        goto done;
    }
    st = crypton_limbs_resize(&r2p, n, 0);
    if (st != CRYPTON_OK) goto done;
    cr_memcpy(r2p.v, r2raw.v, r2raw.len * sizeof(crypton_limb));
    r2p.len = n;
    ctx->n = n;
    ctx->n0 = n0;
    ctx->m = cr_alloc(n * sizeof(crypton_limb));
    ctx->r1 = cr_alloc(n * sizeof(crypton_limb));
    ctx->r2 = cr_alloc(n * sizeof(crypton_limb));
    cr_memcpy(ctx->m, m_raw, n * sizeof(crypton_limb));
    cr_memcpy(ctx->r1, r1p.v, n * sizeof(crypton_limb));
    cr_memcpy(ctx->r2, r2p.v, n * sizeof(crypton_limb));
    ok = true;
done:
    crypton_limbs_free(&r_val);
    crypton_limbs_free(&qq);
    crypton_limbs_free(&rr);
    crypton_limbs_free(&prod);
    crypton_limbs_free(&r1p);
    crypton_limbs_free(&r2raw);
    crypton_limbs_free(&r2p);
    return ok;
}

void crypton_mont_ctx_free(crypton_mont_ctx *ctx)
{
    if (ctx->m) {
        crypton_wipe(ctx->m, ctx->n * sizeof(crypton_limb));
        cr_free(ctx->m, ctx->n * sizeof(crypton_limb));
    }
    if (ctx->r1) {
        crypton_wipe(ctx->r1, ctx->n * sizeof(crypton_limb));
        cr_free(ctx->r1, ctx->n * sizeof(crypton_limb));
    }
    if (ctx->r2) {
        crypton_wipe(ctx->r2, ctx->n * sizeof(crypton_limb));
        cr_free(ctx->r2, ctx->n * sizeof(crypton_limb));
    }
    ctx->n = 0;
    ctx->m = NULL;
    ctx->n0 = 0;
    ctx->r1 = NULL;
    ctx->r2 = NULL;
}

static crypton_status cr_mont_mul(const crypton_mont_ctx *ctx, const crypton_limb *a_in, size_t a_len, const crypton_limb *b_in, size_t b_len, crypton_limbs *out)
{
    size_t n = ctx->n;
    crypton_limbs a, b, t, ov, w, res;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&a);
    crypton_limbs_init(&b);
    crypton_limbs_init(&t);
    crypton_limbs_init(&ov);
    crypton_limbs_init(&w);
    crypton_limbs_init(&res);
    if (a_len > n || b_len > n) {
        st = CRYPTON_OPERAND_TOO_LARGE;
        goto done;
    }
    st = cr_zpad_into(&a, a_in, a_len, n);
    if (st != CRYPTON_OK) goto done;
    st = cr_zpad_into(&b, b_in, b_len, n);
    if (st != CRYPTON_OK) goto done;
    st = crypton_limbs_resize(&t, n * 2 + 2, 0);
    if (st != CRYPTON_OK) goto done;
    bool overflow = false;
    for (size_t i = 0; i < n; i++) {
        uint64_t carry = 0;
        for (size_t j = 0; j < n; j++) {
            uint64_t lo, hi;
            cr_mul64(a.v[i], b.v[j], &lo, &hi);
            uint64_t t0 = t.v[i + j];
            uint64_t s1 = t0 + lo;
            uint64_t c1 = s1 < t0 ? 1u : 0u;
            uint64_t s2 = s1 + carry;
            uint64_t c2 = s2 < s1 ? 1u : 0u;
            uint64_t hi2 = hi + c1 + c2;
            t.v[i + j] = s2;
            carry = hi2;
        }
        for (size_t idx = i + n; idx < t.len; idx++) {
            uint64_t t2 = t.v[idx] + carry;
            uint64_t c2 = t2 < carry ? 1u : 0u;
            t.v[idx] = t2;
            carry = c2;
        }
        overflow |= (carry != 0);
    }
    for (size_t i = 0; i < n; i++) {
        uint64_t k = t.v[i] * ctx->n0;
        uint64_t carry = 0;
        for (size_t j = 0; j < n; j++) {
            uint64_t lo, hi;
            cr_mul64(k, ctx->m[j], &lo, &hi);
            uint64_t t0 = t.v[i + j];
            uint64_t s1 = t0 + lo;
            uint64_t c1 = s1 < t0 ? 1u : 0u;
            uint64_t s2 = s1 + carry;
            uint64_t c2 = s2 < s1 ? 1u : 0u;
            uint64_t hi2 = hi + c1 + c2;
            t.v[i + j] = s2;
            carry = hi2;
        }
        for (size_t idx = i + n; idx < t.len; idx++) {
            uint64_t t2 = t.v[idx] + carry;
            uint64_t c2 = t2 < carry ? 1u : 0u;
            t.v[idx] = t2;
            carry = c2;
        }
        overflow |= (carry != 0);
    }
    if (overflow) {
        crypton_limbs_free(&a);
        crypton_limbs_free(&b);
        crypton_limbs_free(&t);
        crypton_limbs_free(&ov);
        crypton_limbs_free(&w);
        crypton_limbs_free(&res);
        return CRYPTON_ARITHMETIC_VIOLATION;
    }
    uint64_t extra = t.v[2 * n];
    st = crypton_limbs_resize(&ov, n, 0);
    if (st != CRYPTON_OK) goto done;
    cr_memcpy(ov.v, t.v + n, n * sizeof(crypton_limb));
    ov.len = n;
    st = crypton_limbs_resize(&w, n + 1, 0);
    if (st != CRYPTON_OK) goto done;
    cr_memcpy(w.v, ov.v, n * sizeof(crypton_limb));
    w.v[n] = extra & 1u;
    w.len = n + 1;
    uint64_t brw = 0;
    for (size_t j = 0; j <= n; j++) {
        uint64_t mv = j < n ? ctx->m[j] : 0;
        uint64_t s1 = w.v[j] - mv;
        uint64_t u1 = w.v[j] < mv ? 1u : 0u;
        uint64_t s2 = s1 - brw;
        uint64_t u2 = s1 < brw ? 1u : 0u;
        w.v[j] = s2;
        brw = u1 | u2;
    }
    bool ge = (extra & 1u) == 1u || brw == 0;
    uint64_t mask = ge ? ~(uint64_t)0 : 0;
    st = crypton_limbs_resize(&res, n, 0);
    if (st != CRYPTON_OK) goto done;
    for (size_t j = 0; j < n; j++) {
        res.v[j] = (w.v[j] & mask) | (ov.v[j] & ~mask);
    }
    res.len = n;
    *out = res;
    crypton_limbs_init(&res);
done:
    crypton_limbs_free(&a);
    crypton_limbs_free(&b);
    crypton_limbs_free(&t);
    crypton_limbs_free(&ov);
    crypton_limbs_free(&w);
    crypton_limbs_free(&res);
    return st;
}

crypton_status crypton_mont_mul(const crypton_mont_ctx *ctx, const crypton_limb *a, size_t an, const crypton_limb *b, size_t bn, crypton_limbs *out)
{
    return cr_mont_mul(ctx, a, an, b, bn, out);
}

crypton_status crypton_mont_to_mont(const crypton_mont_ctx *ctx, const crypton_limb *a, size_t an, crypton_limbs *out)
{
    return cr_mont_mul(ctx, a, an, ctx->r2, ctx->n, out);
}

crypton_status crypton_mont_from_mont(const crypton_mont_ctx *ctx, const crypton_limb *a, size_t an, crypton_limbs *out)
{
    crypton_limbs one;
    crypton_limbs_init(&one);
    crypton_status st = crypton_limbs_resize(&one, 1, 0);
    if (st != CRYPTON_OK) return st;
    one.v[0] = 1;
    one.len = 1;
    st = cr_mont_mul(ctx, a, an, one.v, one.len, out);
    crypton_limbs_free(&one);
    return st;
}

crypton_status crypton_mont_mod_pow(const crypton_limb *base_red, size_t bn, const crypton_limb *exp, size_t en, const crypton_mont_ctx *ctx, crypton_limbs *out)
{
    if (ctx->n == 1 && ctx->m[0] == 1) {
        crypton_status st = crypton_limbs_resize(out, 1, 0);
        if (st != CRYPTON_OK) return st;
        out->v[0] = 0;
        out->len = 1;
        return CRYPTON_OK;
    }
    crypton_limbs padded, base_m, result, sq, cand, nres, out_full, one;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&padded);
    crypton_limbs_init(&base_m);
    crypton_limbs_init(&result);
    crypton_limbs_init(&sq);
    crypton_limbs_init(&cand);
    crypton_limbs_init(&nres);
    crypton_limbs_init(&out_full);
    crypton_limbs_init(&one);
    if (bn > ctx->n) {
        st = CRYPTON_OPERAND_TOO_LARGE;
        goto done;
    }
    st = cr_zpad_into(&padded, base_red, bn, ctx->n);
    if (st != CRYPTON_OK) goto done;
    st = cr_mont_mul(ctx, padded.v, padded.len, ctx->r2, ctx->n, &base_m);
    if (st != CRYPTON_OK) goto done;
    crypton_limbs_free(&padded);
    crypton_limbs_init(&padded);
    st = cr_zpad_into(&result, ctx->r1, ctx->n, ctx->n);
    if (st != CRYPTON_OK) goto done;
    st = crypton_limbs_resize(&one, 1, 0);
    if (st != CRYPTON_OK) goto done;
    one.v[0] = 1;
    one.len = 1;
    size_t nbits = en * 64;
    for (size_t i = nbits; i-- > 0;) {
        uint64_t bit = (exp[i / 64] >> (i % 64)) & 1u;
        st = cr_mont_mul(ctx, result.v, result.len, result.v, result.len, &sq);
        if (st != CRYPTON_OK) goto done;
        st = cr_mont_mul(ctx, sq.v, sq.len, base_m.v, base_m.len, &cand);
        if (st != CRYPTON_OK) goto done;
        st = cr_select(bit == 1u, cand.v, cand.len, sq.v, sq.len, &nres);
        if (st != CRYPTON_OK) goto done;
        crypton_limbs_free(&result);
        crypton_limbs_init(&result);
        result = nres;
        crypton_limbs_init(&nres);
        crypton_limbs_free(&sq);
        crypton_limbs_init(&sq);
        crypton_limbs_free(&cand);
        crypton_limbs_init(&cand);
    }
    st = cr_mont_mul(ctx, result.v, result.len, one.v, one.len, &out_full);
    if (st != CRYPTON_OK) goto done;
    crypton_limbs_trim(&out_full);
    *out = out_full;
    crypton_limbs_init(&out_full);
done:
    crypton_limbs_free(&padded);
    crypton_limbs_free(&base_m);
    crypton_limbs_free(&result);
    crypton_limbs_free(&sq);
    crypton_limbs_free(&cand);
    crypton_limbs_free(&nres);
    crypton_limbs_free(&out_full);
    crypton_limbs_free(&one);
    return st;
}

static crypton_status cr_mod_reduce(const crypton_limb *a, size_t an, const crypton_limb *m, size_t mn, crypton_limbs *out)
{
    crypton_limbs q, r;
    crypton_limbs_init(&q);
    crypton_limbs_init(&r);
    crypton_status st = crypton_bigint_divmod(a, an, m, mn, &q, &r);
    crypton_limbs_free(&q);
    crypton_limbs_init(&q);
    if (st != CRYPTON_OK) {
        crypton_limbs_free(&r);
        crypton_limbs_init(&r);
        return st;
    }
    *out = r;
    crypton_limbs_init(&r);
    return CRYPTON_OK;
}

crypton_status crypton_bigint_legacy_mod_pow(const crypton_limb *base, size_t bn, const crypton_limb *exp, size_t en, const crypton_limb *mod, size_t mn, crypton_limbs *out)
{
    crypton_limbs one, result, base_mod, sq_raw, sq, cand_raw, cand, nres;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&one);
    crypton_limbs_init(&result);
    crypton_limbs_init(&base_mod);
    crypton_limbs_init(&sq_raw);
    crypton_limbs_init(&sq);
    crypton_limbs_init(&cand_raw);
    crypton_limbs_init(&cand);
    crypton_limbs_init(&nres);
    st = crypton_limbs_resize(&one, 1, 0);
    if (st != CRYPTON_OK) goto done;
    one.v[0] = 1;
    one.len = 1;
    st = cr_mod_reduce(one.v, one.len, mod, mn, &result);
    if (st != CRYPTON_OK) goto done;
    st = cr_mod_reduce(base, bn, mod, mn, &base_mod);
    if (st != CRYPTON_OK) goto done;
    size_t nbits = en * 64;
    for (size_t i = nbits; i-- > 0;) {
        uint64_t bit = (exp[i / 64] >> (i % 64)) & 1u;
        st = crypton_bigint_mul_schoolbook(result.v, result.len, result.v, result.len, &sq_raw);
        if (st != CRYPTON_OK) goto done;
        st = cr_mod_reduce(sq_raw.v, sq_raw.len, mod, mn, &sq);
        crypton_limbs_free(&sq_raw);
        crypton_limbs_init(&sq_raw);
        if (st != CRYPTON_OK) goto done;
        st = crypton_bigint_mul_schoolbook(sq.v, sq.len, base_mod.v, base_mod.len, &cand_raw);
        if (st != CRYPTON_OK) goto done;
        st = cr_mod_reduce(cand_raw.v, cand_raw.len, mod, mn, &cand);
        crypton_limbs_free(&cand_raw);
        crypton_limbs_init(&cand_raw);
        if (st != CRYPTON_OK) goto done;
        st = cr_select(bit == 1u, cand.v, cand.len, sq.v, sq.len, &nres);
        if (st != CRYPTON_OK) goto done;
        crypton_limbs_free(&result);
        crypton_limbs_init(&result);
        result = nres;
        crypton_limbs_init(&nres);
        crypton_limbs_free(&sq);
        crypton_limbs_init(&sq);
        crypton_limbs_free(&cand);
        crypton_limbs_init(&cand);
    }
    crypton_limbs_free(&base_mod);
    crypton_limbs_init(&base_mod);
    *out = result;
    crypton_limbs_init(&result);
done:
    crypton_limbs_free(&one);
    crypton_limbs_free(&result);
    crypton_limbs_free(&base_mod);
    crypton_limbs_free(&sq_raw);
    crypton_limbs_free(&sq);
    crypton_limbs_free(&cand_raw);
    crypton_limbs_free(&cand);
    crypton_limbs_free(&nres);
    return st;
}

crypton_status crypton_bigint_mod_pow(const crypton_limb *base, size_t bn, const crypton_limb *exp, size_t en, const crypton_limb *mod, size_t mn, crypton_limbs *out)
{
    if (crypton_bigint_is_zero(mod, mn)) return CRYPTON_MODULUS_IS_ZERO;
    if (mn == 1 && mod[0] == 1) {
        crypton_status st = crypton_limbs_resize(out, 1, 0);
        if (st != CRYPTON_OK) return st;
        out->v[0] = 0;
        out->len = 1;
        return CRYPTON_OK;
    }
    if ((mod[0] & 1u) == 1u) {
        crypton_mont_ctx ctx;
        if (crypton_mont_ctx_new(mod, mn, &ctx)) {
            crypton_limbs q, base_red;
            crypton_status st;
            crypton_limbs_init(&q);
            crypton_limbs_init(&base_red);
            st = crypton_bigint_divmod(base, bn, mod, mn, &q, &base_red);
            crypton_limbs_free(&q);
            crypton_limbs_init(&q);
            if (st != CRYPTON_OK) {
                crypton_limbs_free(&base_red);
                crypton_limbs_init(&base_red);
                crypton_mont_ctx_free(&ctx);
                return st;
            }
            st = crypton_mont_mod_pow(base_red.v, base_red.len, exp, en, &ctx, out);
            crypton_limbs_free(&base_red);
            crypton_limbs_init(&base_red);
            crypton_mont_ctx_free(&ctx);
            return st;
        }
    }
    return crypton_bigint_legacy_mod_pow(base, bn, exp, en, mod, mn, out);
}

static int cr_nibble(uint8_t c, uint64_t *out)
{
    if (c >= '0' && c <= '9') {
        *out = (uint64_t)(c - '0');
        return 1;
    }
    if (c >= 'a' && c <= 'f') {
        *out = (uint64_t)(c - 'a') + 10u;
        return 1;
    }
    if (c >= 'A' && c <= 'F') {
        *out = (uint64_t)(c - 'A') + 10u;
        return 1;
    }
    return 0;
}

crypton_status crypton_hex_to_limbs(const char *hex, size_t hex_len, crypton_limbs *out)
{
    const uint8_t *h = (const uint8_t *)hex;
    size_t off = 0;
    if (hex_len >= 2 && h[0] == '0' && (h[1] == 'x' || h[1] == 'X')) off = 2;
    size_t clean_len = hex_len - off;
    if (clean_len == 0) return CRYPTON_EMPTY_HEX;
    if (clean_len > (size_t)CRYPTON_MAX_HEX_DIGITS) return CRYPTON_OPERAND_TOO_LARGE;
    crypton_limbs digits, padded, limbs;
    crypton_status st = CRYPTON_OK;
    crypton_limbs_init(&digits);
    crypton_limbs_init(&padded);
    crypton_limbs_init(&limbs);
    for (size_t i = 0; i < clean_len; i++) {
        uint64_t nv;
        if (!cr_nibble(h[off + i], &nv)) {
            st = CRYPTON_INVALID_HEX_CHAR;
            goto done;
        }
        st = bl_push(&digits, nv);
        if (st != CRYPTON_OK) goto done;
    }
    size_t pad = (16 - (clean_len % 16)) % 16;
    size_t total = pad + clean_len;
    st = crypton_limbs_resize(&padded, total, 0);
    if (st != CRYPTON_OK) goto done;
    cr_memcpy(padded.v + pad, digits.v, clean_len * sizeof(crypton_limb));
    padded.len = total;
    for (size_t c = 0; c < total / 16; c++) {
        uint64_t acc = 0;
        for (size_t d = 0; d < 16; d++) {
            acc = (acc << 4) | padded.v[c * 16 + d];
        }
        st = bl_push(&limbs, acc);
        if (st != CRYPTON_OK) goto done;
    }
    for (size_t i = 0; i < limbs.len / 2; i++) {
        crypton_limb tmp = limbs.v[i];
        limbs.v[i] = limbs.v[limbs.len - 1 - i];
        limbs.v[limbs.len - 1 - i] = tmp;
    }
    if (limbs.len == 0) {
        st = bl_push(&limbs, 0);
        if (st != CRYPTON_OK) goto done;
    }
    crypton_limbs_trim(&limbs);
    *out = limbs;
    crypton_limbs_init(&limbs);
done:
    crypton_limbs_free(&digits);
    crypton_limbs_free(&padded);
    crypton_limbs_free(&limbs);
    return st;
}

crypton_status crypton_limbs_to_hex(const crypton_limb *v, size_t vn, crypton_buf *out)
{
    static const char hexd[] = "0123456789abcdef";
    crypton_limbs tmp;
    crypton_limbs_init(&tmp);
    crypton_status st = bl_set(&tmp, v, vn);
    if (st != CRYPTON_OK) {
        crypton_limbs_free(&tmp);
        return st;
    }
    crypton_limbs_trim(&tmp);
    crypton_buf_init(out);
    for (size_t i = tmp.len; i-- > 0;) {
        char s[16];
        crypton_limb l = tmp.v[i];
        for (size_t p = 0; p < 16; p++) {
            s[15 - p] = hexd[l & 0xfu];
            l >>= 4;
        }
        st = crypton_buf_append(out, (const uint8_t *)s, 16);
        if (st != CRYPTON_OK) {
            crypton_limbs_free(&tmp);
            crypton_buf_free(out);
            return st;
        }
    }
    size_t k = 0;
    while (k < out->len && out->data[k] == '0') k++;
    if (k >= out->len) {
        crypton_buf_truncate(out, 0);
        st = crypton_buf_append(out, (const uint8_t *)"0", 1);
    } else if (k > 0) {
        cr_memcpy(out->data, out->data + k, out->len - k);
        crypton_buf_truncate(out, out->len - k);
    }
    crypton_limbs_free(&tmp);
    return st;
}
