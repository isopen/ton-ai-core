use crate::CryptoError;
use std::cmp::Ordering;

type Limb = u64;
type Dlimb = u128;

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

pub fn mul(a: &[Limb], b: &[Limb]) -> Vec<Limb> {
    let mut c = vec![0u64; a.len() + b.len()];
    for i in 0..a.len() {
        let mut carry: Dlimb = 0;
        for j in 0..b.len() {
            let cur = c[i+j] as Dlimb + (a[i] as Dlimb) * (b[j] as Dlimb) + carry;
            c[i+j] = cur as Limb;
            carry = cur >> 64;
        }
        let mut k = i + b.len();
        while carry > 0 {
            let cur = c[k] as Dlimb + carry;
            c[k] = cur as Limb;
            carry = cur >> 64;
            k += 1;
            if k >= c.len() { break; }
        }
    }
    trim(&mut c);
    c
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
        Ok(mod_reduce_owned(mag, m))
    } else {
        Ok(mod_reduce_owned(t, m))
    }
}

fn mod_reduce_owned(a: Vec<Limb>, m: &[Limb]) -> Vec<Limb> {
    divmod(&a, m).map(|(_, r)| r).unwrap_or_else(|_| a)
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

pub fn mod_pow(base: &[Limb], exp: &[Limb], modulus: &[Limb]) -> Result<Vec<Limb>, CryptoError> {
    if is_zero(modulus) { return Err(CryptoError::ModulusIsZero); }
    if modulus.len() == 1 && modulus[0] == 1 { return Ok(vec![0]); }
    let mut result = mod_reduce(&[1], modulus)?;
    let mut base_mod = mod_reduce(base, modulus)?;

    let nbits = exp.len() * 64;
    for i in (0..nbits).rev() {
        let bit = (exp[i / 64] >> (i % 64)) & 1;
        let mut sq = mod_reduce(&mul(&result, &result), modulus)?;
        let mut cand = mod_reduce(&mul(&sq, &base_mod), modulus)?;
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
