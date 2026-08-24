type Limb = u64;
type Dlimb = u128;

fn trim(v: &mut Vec<Limb>) {
    while v.len() > 1 && *v.last().unwrap() == 0 { v.pop(); }
}

fn cmp(a: &[Limb], b: &[Limb]) -> std::cmp::Ordering {
    if a.len() != b.len() { return a.len().cmp(&b.len()); }
    for i in (0..a.len()).rev() {
        if a[i] != b[i] { return a[i].cmp(&b[i]); }
    }
    std::cmp::Ordering::Equal
}


fn mul(a: &[Limb], b: &[Limb]) -> Vec<Limb> {
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

fn divmod(a: &[Limb], b: &[Limb]) -> (Vec<Limb>, Vec<Limb>) {
    if cmp(a, b) == std::cmp::Ordering::Less {
        return (vec![0], a.to_vec());
    }
    if b.len() == 1 && b[0] == 0 { return (vec![0], vec![0]); }

    let total_bits = a.len() * 64;
    let mut q = vec![0u64; a.len()];
    let mut rem: Vec<Limb> = Vec::new();

    for i in (0..total_bits).rev() {
        let mut carry = 0u64;
        for j in 0..rem.len() {
            let nb = rem[j] >> 63;
            rem[j] = (rem[j] << 1) | carry;
            carry = nb;
        }
        if carry > 0 && rem.len() < b.len() + 1 { rem.push(carry); }

        if (a[i / 64] >> (i % 64)) & 1 == 1 {
            if rem.is_empty() { rem.push(0); }
            rem[0] |= 1;
        }

        if cmp(&rem, b) != std::cmp::Ordering::Less {
            let mut brw = 0u64;
            for j in 0..rem.len() {
                let bv = if j < b.len() { b[j] } else { 0 };
                let sub = (rem[j] as u64).wrapping_sub(bv).wrapping_sub(brw);
                rem[j] = sub;
                brw = if rem[j] > sub { 1 } else { 0 };
            }
            q[i / 64] |= 1 << (i % 64);
        }
    }

    trim(&mut q);
    trim(&mut rem);
    (q, rem)
}



pub fn mod_pow(base: &[Limb], exp: &[Limb], modulus: &[Limb]) -> Vec<Limb> {
    let one = vec![1];
    if modulus.len() == 1 && modulus[0] == 1 { return vec![0]; }
    let mut result = mod_reduce(&one.to_vec(), modulus);
    let base_mod = mod_reduce(base, modulus);

    let exp_bits: Vec<bool> = {
        let mut bits = Vec::new();
        for i in (0..exp.len()).rev() {
            for j in (0..64).rev() {
                bits.push((exp[i] >> j) & 1 == 1);
            }
        }
        while bits.len() > 1 && !bits[0] { bits.remove(0); }
        bits
    };

    for bit in exp_bits {
        result = mod_reduce(&mul(&result, &result), modulus);
        if bit {
            result = mod_reduce(&mul(&result, &base_mod), modulus);
        }
    }
    result
}

fn mod_reduce(a: &[Limb], m: &[Limb]) -> Vec<Limb> {
    let (_, r) = divmod(a, m);
    r
}

pub fn hex_to_limbs(hex: &str) -> Vec<Limb> {
    let clean = hex.trim_start_matches("0x");
    let padded = if clean.len() % 16 != 0 {
        format!("{}{}", "0".repeat(16 - clean.len() % 16), clean)
    } else { clean.to_string() };
    let mut limbs = Vec::new();
    let chunks: Vec<&str> = padded.as_bytes().chunks(16).map(|c| std::str::from_utf8(c).unwrap()).collect();
    for chunk in chunks.into_iter().rev() {
        limbs.push(u64::from_str_radix(chunk, 16).unwrap_or(0));
    }
    if limbs.is_empty() { limbs.push(0); }
    trim(&mut limbs);
    limbs
}

pub fn limbs_to_hex(limbs: &[Limb]) -> String {
    let mut trimmed = limbs.to_vec();
    trim(&mut trimmed);
    let h: String = trimmed.iter().rev().map(|l| format!("{:016x}", l)).collect();
    let t = h.trim_start_matches('0');
    if t.is_empty() { "0".to_string() } else { t.to_string() }
}
