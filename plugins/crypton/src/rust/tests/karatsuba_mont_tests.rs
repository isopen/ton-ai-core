use crypton_wasm::*;

struct R(u64);
impl R { fn next(&mut self)->u64{ let mut x=self.0; x^=x<<13; x^=x>>7; x^=x<<17; self.0=x; x } }

fn trimmed(mut v: Vec<u64>) -> Vec<u64> {
    while v.len() > 1 && *v.last().unwrap() == 0 { v.pop(); }
    v
}

#[test]
fn scratch_mont_ctx() {
    let mut rng = R(0x1111222233334444);
    for it in 0..300 {
        let ml = 1 + (rng.next() as usize % 4);
        let mut m = (0..ml).map(|_| rng.next()).collect::<Vec<_>>();
        m = trimmed(m);
        if bigint::is_zero(&m) { continue; }
        m[0] |= 1;
        let ctx = match bigint::MontCtx::new(&m) { Some(c)=>c, None=>continue };

        let bl = 1 + (rng.next() as usize % 3);
        let mut a = (0..bl).map(|_| rng.next()).collect::<Vec<_>>();
        while bigint::is_zero(&a) { a = (0..bl).map(|_| rng.next()).collect(); }
        let b = (0..ml).map(|_| rng.next()).collect::<Vec<_>>();

        let ared = bigint::divmod(&a, &m).unwrap().1;
        let am = ctx.to_mont(&ared).expect("to_mont");
        let rt = trimmed(ctx.from_mont(&am).expect("from_mont"));
        assert_eq!(rt, trimmed(ared), "roundtrip it={} m={:?} a={:?}", it, m, a);

        let bred = bigint::divmod(&b, &m).unwrap().1;
        let bm = ctx.to_mont(&bred).expect("to_mont b");
        let cm = ctx.mont_mul(&am, &bm).expect("mont_mul");
        let out = trimmed(ctx.from_mont(&cm).expect("from_mont c"));
        let want = bigint::divmod(&bigint::mul(&a, &b), &m).unwrap().1;
        assert_eq!(out, trimmed(want), "mont_mul it={} m={:?} a={:?} b={:?}", it, m, a, b);
    }
}

#[test]
fn scratch_mul_diff() {
    let mut rng = R(0xABCDEF1234567890);
    for it in 0..400 {
        let la = 1 + (rng.next() as usize % 40);
        let lb = 1 + (rng.next() as usize % 40);
        let a: Vec<u64> = (0..la).map(|_| rng.next()).collect();
        let b: Vec<u64> = (0..lb).map(|_| rng.next()).collect();
        let got = bigint::mul(&a, &b);
        let want = bigint::mul_schoolbook(&a, &b);
        assert_eq!(got, want, "iter={} la={} lb={}", it, la, lb);
    }
}
