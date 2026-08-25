use crypton_wasm::*;

struct Xs(u64);
impl Xs {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn limbs(&mut self, n: usize, density: u64) -> Vec<u64> {
        let mut v: Vec<u64> = (0..n).map(|_| self.next() & density).collect();
        while v.len() > 1 && *v.last().unwrap() == 0 { v.pop(); }
        v
    }
}

fn cmp_lt(a: &[u64], b: &[u64]) -> bool {
    let ta = { let mut v = a.to_vec(); while v.len() > 1 && *v.last().unwrap() == 0 { v.pop(); } v };
    let tb = { let mut v = b.to_vec(); while v.len() > 1 && *v.last().unwrap() == 0 { v.pop(); } v };
    if ta.len() != tb.len() { return ta.len() < tb.len(); }
    for i in (0..ta.len()).rev() {
        if ta[i] != tb[i] { return ta[i] < tb[i]; }
    }
    false
}

#[test]
fn fuzz_mul_divmod_adversarial_patterns() {
    let mut rng = Xs(0xF00DCAFE12345678);
    let densities: [u64; 4] = [u64::MAX, 0x000000000000FFFF, 0xFFFF000000000001, 0x8000000000000000];
    for round in 0..3000 {
        let d = densities[round % densities.len()];
        let la = 1 + (rng.next() as usize % 40);
        let lb = 1 + (rng.next() as usize % 40);
        let mut a = rng.limbs(la, d);
        if bigint::is_zero(&a) { continue; }
        let mut b = rng.limbs(lb, d);
        b[0] |= 1;
        if bigint::is_zero(&b) { continue; }
        if !cmp_lt(&a, &b) { std::mem::swap(&mut a, &mut b); }
        if bigint::is_zero(&a) { continue; }

        let got = bigint::divmod(&a, &b).expect("divmod");
        let recon = bigint::add(&bigint::mul(&got.0, &b), &got.1);
        assert_eq!(recon, a, "identity fail round={} la={} lb={}", round, la, lb);
        assert!(cmp_lt(&got.1, &b), "remainder bound fail round={}", round);

        let prod_k = bigint::mul(&a, &b);
        let prod_s = bigint::mul_schoolbook(&a, &b);
        assert_eq!(prod_k, prod_s, "karatsuba vs schoolbook round={}", round);
    }
}

#[test]
fn fuzz_mod_pow_mont_vs_legacy_and_ladder() {
    let mut rng = Xs(0xBAADF00DCAFEBABE);
    for round in 0..600 {
        let ml = 1 + (rng.next() as usize % 3);
        let mut m = rng.limbs(ml, u64::MAX);
        m[0] |= 1;
        if bigint::is_zero(&m) || m == vec![1] { continue; }
        let blen = 1 + (rng.next() as usize % 2);
        let base = rng.limbs(blen, u64::MAX);
        let e = (rng.next() % 12) as u64;

        let via_api = bigint::mod_pow(&base, &[e], &m).unwrap();
        let via_legacy = legacy_ref(&base, e, &m);
        assert_eq!(via_api, via_legacy, "mont/legacy mismatch round={}", round);

        if m.len() != 1 || base.len() != 1 { continue; }
        let mut acc: u64 = 1 % m[0];
        let mut b: u64 = base.first().copied().unwrap_or(0) % m[0];
        let mut ee = e;
        while ee > 0 {
            if ee & 1 == 1 { acc = ((acc as u128 * b as u128) % m[0] as u128) as u64; }
            b = ((b as u128 * b as u128) % m[0] as u128) as u64;
            ee >>= 1;
        }
        let ladder = if acc == 0 { vec![0] } else { vec![acc] };
        assert_eq!(via_api, ladder, "ladder mismatch round={}", round);
    }
}

fn legacy_ref(base: &[u64], e: u64, m: &[u64]) -> Vec<u64> {
    let mut acc: Vec<u64> = vec![1];
    for _ in 0..e {
        let prod = bigint::mul(&acc, base);
        acc = bigint::divmod(&prod, m).expect("divmod").1;
    }
    acc
}

#[test]
fn fuzz_mr_agrees_with_trial_division_small() {
    let mut rng = Xs(0x123456789ABCDEF0);
    for n in 2u64..20000 {
        let _ = rng.next();
        let h = format!("{:x}", n);
        let mr = is_probably_prime(&h, 5).unwrap();
        let mut is_prime = n >= 2;
        for p in 2u64..=((n as f64).sqrt() as u64) {
            if n % p == 0 { is_prime = n == p; break; }
        }
        if n <= 3 { is_prime = n >= 2; }
        assert_eq!(mr, is_prime, "MR disagrees with trial division at n={}", n);
    }
}

#[test]
fn mr_rejects_known_two_prime_composites_above_trial_bound() {
    for dec in [10403u64, 25326001u64, 3215031751u64] {
        let h = format!("{:x}", dec);
        assert!(!is_probably_prime(&h, 40).unwrap(), "{} declared prime", dec);
    }
}

#[test]
fn fuzz_seal_open_randomized() {
    let mut rng = Xs(0xFEEDFACEC0FFEE00);
    let mac_key: Vec<u8> = (0..32).map(|_| rng.next() as u8).collect();
    let enc_key: Vec<u8> = (0..32).map(|_| rng.next() as u8).collect();
    for round in 0..60 {
        let len = ((round * 37) % 512 + 16) & !15;
        let pt: Vec<u8> = (0..len).map(|i| (i ^ round) as u8).collect();
        let sealed = cbc_seal_checked(&mac_key, &enc_key, &pt).expect("seal");
        let opened = cbc_open_checked(&mac_key, &enc_key, &sealed).expect("open");
        assert_eq!(opened, pt, "roundtrip fail round={}", round);
        let pos = (rng.next() as usize) % sealed.len();
        let mut t = sealed.clone();
        t[pos] ^= 1;
        assert!(cbc_open_checked(&mac_key, &enc_key, &t).is_err(), "tamper undetected pos={}", pos);
    }
}
