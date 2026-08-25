use crate::CryptoError;
use std::cmp::Ordering;

pub type Limb = u64;
type Dlimb = u128;

pub fn cmp_lt(a: &[Limb], b: &[Limb]) -> bool {
    cmp(a, b) == Ordering::Less
}

pub fn trim_pub(v: &mut Vec<Limb>) {
    trim(v);
}

pub fn is_zero(v: &[Limb]) -> bool {
    v.iter().fold(0u64, |acc, x| acc | x) == 0
}

fn trim(v: &mut Vec<Limb>) {
    while v.len() > 1 && *v.last().unwrap() == 0 { v.pop(); }
}

fn cmp(a: &[Limb], b: &[Limb]) -> Ordering {
    if a.len() != b.len() { return a.len().cmp(&b.len()); }
    let mut gt = 0u64;
    let mut lt = 0u64;
    let mut i = a.len();
    while i > 0 {
        i -= 1;
        let agt = (a[i] > b[i]) as u64;
        let alt = (a[i] < b[i]) as u64;
        let undecided = (gt | lt) ^ 1;
        gt |= undecided & agt;
        lt |= undecided & alt;
    }
    if gt == 1 { Ordering::Greater } else if lt == 1 { Ordering::Less } else { Ordering::Equal }
}

pub fn add(a: &[Limb], b: &[Limb]) -> Vec<Limb> {
    let n = a.len().max(b.len());
    let mut out = Vec::with_capacity(n + 1);
    let mut carry = 0u64;
    for i in 0..n {
        let x = if i < a.len() { a[i] } else { 0 };
        let y = if i < b.len() { b[i] } else { 0 };
        let s = x as Dlimb + y as Dlimb + carry as Dlimb;
        out.push(s as Limb);
        carry = (s >> 64) as Limb;
    }
    if carry > 0 { out.push(carry); }
    if out.is_empty() { out.push(0); }
    trim(&mut out);
    out
}

const KARATSUBA_THRESHOLD: usize = 24;

pub fn mul(a: &[Limb], b: &[Limb]) -> Vec<Limb> {
    if a.len().min(b.len()) >= KARATSUBA_THRESHOLD {
        return karatsuba(a, b);
    }
    mul_schoolbook(a, b)
}

pub fn mul_schoolbook(a: &[Limb], b: &[Limb]) -> Vec<Limb> {
    let mut c = vec![0u64; a.len() + b.len()];
    for i in 0..a.len() {
        let mut carry: Dlimb = 0;
        for j in 0..b.len() {
            let cur = c[i+j] as Dlimb + (a[i] as Dlimb) * (b[j] as Dlimb) + carry;
            c[i+j] = cur as Limb;
            carry = cur >> 64;
        }
        let mut k = i + b.len();
        while k < c.len() {
            let cur = c[k] as Dlimb + carry;
            c[k] = cur as Limb;
            carry = cur >> 64;
            k += 1;
        }
        assert!(carry == 0, "bignum carry invariant violated");
    }
    trim(&mut c);
    c
}

fn add_shifted_into(acc: &mut Vec<Limb>, x: &[Limb], sh: usize) {
    let mut carry: Dlimb = 0;
    for i in 0..x.len() {
        let pos = i + sh;
        if pos >= acc.len() { acc.resize(pos + 1, 0); }
        let cur = (acc[pos] as Dlimb) + (x[i] as Dlimb) + carry;
        acc[pos] = cur as Limb;
        carry = cur >> 64;
    }
    let mut pos = x.len() + sh;
    let end = acc.len();
    while pos < end {
        let cur = (acc[pos] as Dlimb) + carry;
        acc[pos] = cur as Limb;
        carry = cur >> 64;
        pos += 1;
    }
    assert!(carry == 0, "bignum carry invariant violated");
}

fn karatsuba(a: &[Limb], b: &[Limb]) -> Vec<Limb> {
    let n = a.len().max(b.len());
    if n < KARATSUBA_THRESHOLD || a.len().min(b.len()) < KARATSUBA_THRESHOLD / 2 {
        return mul_schoolbook(a, b);
    }
    let half = (n + 1) / 2;
    let pa = zpad(a, half * 2);
    let pb = zpad(b, half * 2);
    let (a0, a1) = (&pa[..half], &pa[half..]);
    let (b0, b1) = (&pb[..half], &pb[half..]);

    let z0 = karatsuba(a0, b0);
    let z2 = karatsuba(a1, b1);
    let sa = add(a0, a1);
    let sb = add(b0, b1);
    let mut z1 = karatsuba(&sa, &sb);
    z1 = sub_abs(&z1, &z0);
    z1 = sub_abs(&z1, &z2);

    let mut acc = vec![0u64; half * 4];
    add_shifted_into(&mut acc, &z0, 0);
    add_shifted_into(&mut acc, &z1, half);
    add_shifted_into(&mut acc, &z2, half * 2);
    trim(&mut acc);
    acc
}

pub fn divmod(a: &[Limb], b: &[Limb]) -> Result<(Vec<Limb>, Vec<Limb>), CryptoError> {
    if is_zero(b) { return Err(CryptoError::DivisionByZero); }

    let n = a.len();
    let bn = b.len();
    let width = bn + 1;
    let mut q = vec![0u64; n.max(1)];
    let mut rem = vec![0u64; width];
    let mut t = vec![0u64; width];

    for i in (0..n * 64).rev() {
        let mut carry = 0u64;
        for j in 0..width {
            let nb = rem[j] >> 63;
            rem[j] = (rem[j] << 1) | carry;
            carry = nb;
        }
        rem[0] |= (a[i / 64] >> (i % 64)) & 1;

        let mut brw = 0u64;
        for j in 0..width {
            let bv = if j < bn { b[j] } else { 0 };
            let (r1, u1) = rem[j].overflowing_sub(bv);
            let (r2, u2) = r1.overflowing_sub(brw);
            t[j] = r2;
            brw = (u1 as u64) | (u2 as u64);
        }

        let mask = brw.wrapping_neg();
        for j in 0..width {
            rem[j] = (t[j] & !mask) | (rem[j] & mask);
        }
        q[i / 64] |= (!brw & 1) << (i % 64);
    }

    trim(&mut q);
    trim(&mut rem);
    Ok((q, rem))
}

pub fn sub(a: &[Limb], b: &[Limb]) -> Vec<Limb> {
    sub_abs(a, b)
}

fn sub_abs(a: &[Limb], b: &[Limb]) -> Vec<Limb> {
    let mut out = vec![0u64; a.len()];
    let mut brw = 0u64;
    for i in 0..a.len() {
        let bv = if i < b.len() { b[i] } else { 0 };
        let (r1, u1) = a[i].overflowing_sub(bv);
        let (r2, u2) = r1.overflowing_sub(brw);
        out[i] = r2;
        brw = (u1 as u64) | (u2 as u64);
    }
    trim(&mut out);
    out
}

fn sub_signed(a: &[Limb], aneg: bool, b: &[Limb], bneg: bool) -> (Vec<Limb>, bool) {
    if aneg == bneg {
        if cmp(a, b) == Ordering::Less {
            (sub_abs(b, a), !aneg)
        } else {
            (sub_abs(a, b), aneg)
        }
    } else {
        let mut mag = add(a, b);
        trim(&mut mag);
        (mag, aneg)
    }
}

pub fn mod_inv(a: &[Limb], m: &[Limb]) -> Result<Vec<Limb>, CryptoError> {
    if is_zero(m) { return Err(CryptoError::ModulusIsZero); }
    if m.len() == 1 && m[0] == 1 { return Ok(vec![0]); }

    let mut t: Vec<Limb> = vec![0];
    let mut t_neg = false;
    let mut new_t: Vec<Limb> = vec![1];
    let mut new_t_neg = false;

    let mut r: Vec<Limb> = m.to_vec();
    let mut new_r: Vec<Limb> = divmod(a, m)?.1;

    while !is_zero(&new_r) {
        let mut q = divmod(&r, &new_r)?.0;
        let mut qnt = mul(&q, &new_t);
        let (diff, diff_neg) = sub_signed(&t, t_neg, &qnt, new_t_neg);
        crate::wipe(&mut qnt);
        std::mem::swap(&mut t, &mut new_t);
        std::mem::swap(&mut t_neg, &mut new_t_neg);
        new_t = diff;
        new_t_neg = diff_neg;

        let mut qr = mul(&q, &new_r);
        let (rsum, _) = sub_signed(&r, false, &qr, false);
        crate::wipe(&mut q);
        crate::wipe(&mut qr);
        std::mem::swap(&mut r, &mut new_r);
        new_r = rsum;
    }

    crate::wipe(&mut new_t);
    crate::wipe(&mut new_r);

    if r != vec![1] { return Err(CryptoError::NoModularInverse); }
    if t_neg {
        let mag = sub_abs(m, &t);
        crate::wipe(&mut t);
        mod_reduce_owned(mag, m)
    } else {
        mod_reduce_owned(t, m)
    }
}

fn mod_reduce_owned(a: Vec<Limb>, m: &[Limb]) -> Result<Vec<Limb>, CryptoError> {
    divmod(&a, m).map(|(_, r)| r)
}

pub fn bytes_to_limbs_be(bytes: &[u8]) -> Vec<Limb> {
    let mut limbs = Vec::with_capacity(bytes.len().div_ceil(8));
    let pad = (8 - bytes.len() % 8) % 8;
    let mut acc: Limb = 0;
    let mut filled = 0usize;
    for _ in 0..pad {
        acc = (acc << 8) | 0;
        filled += 1;
        if filled == 8 { limbs.push(acc); acc = 0; filled = 0; }
    }
    for &b in bytes {
        acc = (acc << 8) | b as Limb;
        filled += 1;
        if filled == 8 { limbs.push(acc); acc = 0; filled = 0; }
    }
    if limbs.is_empty() { limbs.push(0); }
    trim(&mut limbs);
    limbs
}

fn select(bit: bool, a: &[Limb], b: &[Limb]) -> Vec<Limb> {
    let mask = (bit as u64).wrapping_neg();
    let n = a.len().max(b.len());
    (0..n).map(|i| {
        let x = if i < a.len() { a[i] } else { 0 };
        let y = if i < b.len() { b[i] } else { 0 };
        (x & mask) | (y & !mask)
    }).collect()
}

pub struct MontCtx {
    n: usize,
    m: Vec<Limb>,
    n0: Limb,
    r1: Vec<Limb>,
    r2: Vec<Limb>,
}

impl MontCtx {
    pub fn new(m_raw: &[Limb]) -> Option<MontCtx> {
        if m_raw.is_empty() || is_zero(m_raw) { return None; }
        if m_raw[0] & 1 == 0 { return None; }
        let m = m_raw.to_vec();
        let n = m.len();
        let mut inv: Limb = 1;
        let m0 = m[0];
        for _ in 0..6 {
            inv = inv.wrapping_mul(2u64.wrapping_sub(m0.wrapping_mul(inv)));
        }
        let n0 = inv.wrapping_neg();
        let mut r_val = vec![0u64; n + 1];
        r_val[n] = 1;
        let (_, rr) = divmod(&r_val, &m).ok()?;
        let mut r1t = rr;
        trim(&mut r1t);
        let r1t = zpad_checked(&r1t, n).ok()?;
        let r2_raw = divmod(&mul(&r1t, &r1t), &m).ok()?.1;
        let r2 = zpad_checked(&r2_raw, n).ok()?;
        Some(MontCtx { n, m: m.to_vec(), n0, r1: r1t, r2 })
    }

    pub fn mont_mul(&self, a_in: &[Limb], b_in: &[Limb]) -> Result<Vec<Limb>, CryptoError> {
        let n = self.n;
        let mut a = zpad_checked(a_in, n)?;
        let mut b = zpad_checked(b_in, n)?;
        let mut t = vec![0u64; n * 2 + 2];
        let mut overflow = false;
        for i in 0..n {
            let ai = a[i];
            let mut carry: u128 = 0;
            for j in 0..n {
                let cur = (t[i + j] as u128) + (ai as u128) * (b[j] as u128) + carry;
                t[i + j] = cur as u64;
                carry = cur >> 64;
            }
            for idx in (i + n)..t.len() {
                let cur = (t[idx] as u128) + carry;
                t[idx] = cur as u64;
                carry = cur >> 64;
            }
            overflow |= carry != 0;
        }
        for i in 0..n {
            let k = t[i].wrapping_mul(self.n0);
            let mut carry: u128 = 0;
            for j in 0..n {
                let cur = (t[i + j] as u128) + (k as u128) * (self.m[j] as u128) + carry;
                t[i + j] = cur as u64;
                carry = cur >> 64;
            }
            for idx in (i + n)..t.len() {
                let cur = (t[idx] as u128) + carry;
                t[idx] = cur as u64;
                carry = cur >> 64;
            }
            overflow |= carry != 0;
        }
        if overflow {
            crate::wipe(&mut a);
            crate::wipe(&mut b);
            crate::wipe(&mut t);
            return Err(crate::CryptoError::ArithmeticViolation);
        }
        let extra = t[2 * n];
        let out: Vec<Limb> = t[n..2 * n].to_vec();
        let mut w: Vec<Limb> = vec![0u64; n + 1];
        w[..n].copy_from_slice(&out);
        w[n] = extra & 1;
        let mut brw = 0u64;
        for j in 0..=n {
            let mv = if j < n { self.m[j] } else { 0 };
            let (s1, u1) = w[j].overflowing_sub(mv);
            let (s2, u2) = s1.overflowing_sub(brw);
            w[j] = s2;
            brw = (u1 as u64) | (u2 as u64);
        }
        let ge = (extra & 1) == 1 || brw == 0;
        let mask = (ge as u64).wrapping_neg();
        let mut res: Vec<Limb> = vec![0u64; n];
        for j in 0..n {
            res[j] = (w[j] & mask) | (out[j] & !mask);
        }
        crate::wipe(&mut a);
        crate::wipe(&mut b);
        crate::wipe(&mut t);
        crate::wipe(&mut w);
        Ok(res)
    }

    pub fn to_mont(&self, a: &[Limb]) -> Result<Vec<Limb>, CryptoError> {
        self.mont_mul(a, &self.r2)
    }

    pub fn from_mont(&self, a: &[Limb]) -> Result<Vec<Limb>, CryptoError> {
        self.mont_mul(a, &vec![1u64])
    }
}

pub fn mont_mod_pow(base_red: &[Limb], exp: &[Limb], ctx: &MontCtx) -> Result<Vec<Limb>, CryptoError> {
    if ctx.m == vec![1] { return Ok(vec![0]); }
    let mut padded = zpad_checked(base_red, ctx.n)?;
    let mut base_m = ctx.to_mont(&padded)?;
    crate::wipe(&mut padded);
    let mut result = ctx.r1.clone();
    let nbits = exp.len() * 64;
    for i in (0..nbits).rev() {
        let bit = (exp[i / 64] >> (i % 64)) & 1;
        let mut sq = ctx.mont_mul(&result, &result)?;
        let mut cand = ctx.mont_mul(&sq, &base_m)?;
        result = select(bit == 1, &cand, &sq);
        crate::wipe(&mut sq);
        crate::wipe(&mut cand);
    }
    let mut out_full = ctx.from_mont(&result)?;
    crate::wipe(&mut base_m);
    crate::wipe(&mut result);
    trim(&mut out_full);
    Ok(out_full)
}

fn zpad(v: &[Limb], n: usize) -> Vec<Limb> {
    debug_assert!(v.len() <= n);
    let mut out = vec![0u64; n];
    out[..v.len()].copy_from_slice(v);
    out
}

fn zpad_checked(v: &[Limb], n: usize) -> Result<Vec<Limb>, crate::CryptoError> {
    if v.len() > n { return Err(crate::CryptoError::OperandTooLarge); }
    Ok(zpad(v, n))
}

pub fn mod_pow(base: &[Limb], exp: &[Limb], modulus: &[Limb]) -> Result<Vec<Limb>, CryptoError> {
    if is_zero(modulus) { return Err(CryptoError::ModulusIsZero); }
    if modulus.len() == 1 && modulus[0] == 1 { return Ok(vec![0]); }
    if modulus[0] & 1 == 1 {
        if let Some(ctx) = MontCtx::new(modulus) {
            let base_red = divmod(base, modulus)?.1;
            return mont_mod_pow(&base_red, exp, &ctx);
        }
    }
    legacy_mod_pow(base, exp, modulus)
}

pub fn legacy_mod_pow(base: &[Limb], exp: &[Limb], modulus: &[Limb]) -> Result<Vec<Limb>, CryptoError> {
    let mut result = mod_reduce(&[1], modulus)?;
    let mut base_mod = mod_reduce(base, modulus)?;

    let nbits = exp.len() * 64;
    for i in (0..nbits).rev() {
        let bit = (exp[i / 64] >> (i % 64)) & 1;
        let mut sq = mod_reduce(&mul_schoolbook(&result, &result), modulus)?;
        let mut cand = mod_reduce(&mul_schoolbook(&sq, &base_mod), modulus)?;
        result = select(bit == 1, &cand, &sq);
        crate::wipe(&mut sq);
        crate::wipe(&mut cand);
    }
    crate::wipe(&mut base_mod);
    Ok(result)
}

fn mod_reduce(a: &[Limb], m: &[Limb]) -> Result<Vec<Limb>, CryptoError> {
    divmod(a, m).map(|(_, r)| r)
}

fn nibble(c: u8) -> Option<u64> {
    match c {
        b'0'..=b'9' => Some((c - b'0') as u64),
        b'a'..=b'f' => Some((c - b'a' + 10) as u64),
        b'A'..=b'F' => Some((c - b'A' + 10) as u64),
        _ => None,
    }
}

pub fn hex_to_limbs(hex: &str) -> Result<Vec<Limb>, CryptoError> {
    let clean = hex.strip_prefix("0x").or_else(|| hex.strip_prefix("0X")).unwrap_or(hex);
    if clean.is_empty() { return Err(CryptoError::EmptyHex); }
    if clean.len() > crate::MAX_HEX_DIGITS { return Err(CryptoError::OperandTooLarge); }
    let mut digits = Vec::with_capacity(clean.len());
    for c in clean.bytes() {
        match nibble(c) {
            Some(v) => digits.push(v),
            None => return Err(CryptoError::InvalidHexChar),
        }
    }
    while digits.len() % 16 != 0 { digits.insert(0, 0); }
    let mut limbs = Vec::with_capacity(digits.len() / 16);
    for chunk in digits.chunks(16) {
        let mut acc: u64 = 0;
        for &d in chunk { acc = (acc << 4) | d; }
        limbs.push(acc);
    }
    limbs.reverse();
    if limbs.is_empty() { limbs.push(0); }
    trim(&mut limbs);
    Ok(limbs)
}

pub fn limbs_to_hex(limbs: &[Limb]) -> String {
    let mut trimmed = limbs.to_vec();
    trim(&mut trimmed);
    let h: String = trimmed.iter().rev().map(|l| format!("{:016x}", l)).collect();
    let t = h.trim_start_matches('0');
    if t.is_empty() { "0".to_string() } else { t.to_string() }
}
