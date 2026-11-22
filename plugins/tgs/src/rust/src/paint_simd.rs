#[cfg(target_arch = "wasm32")]
mod simd {
    use core::arch::wasm32 as wa;

    const SEL_R: [u8; 16] = [0, 4, 8, 12, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255];
    const SEL_G: [u8; 16] = [1, 5, 9, 13, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255];
    const SEL_B: [u8; 16] = [2, 6, 10, 14, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255];
    const SEL_A: [u8; 16] = [3, 7, 11, 15, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255];
    const SEL_TRANS: [u8; 16] = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
    const SEL_AREP: [u8; 16] = [3, 3, 3, 3, 7, 7, 7, 7, 11, 11, 11, 11, 15, 15, 15, 15];
    const SEL_REP4: [u8; 16] = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3];
    const SEL_DUP: [u8; 16] = [0, 0, 0, 0, 4, 4, 4, 4, 8, 8, 8, 8, 12, 12, 12, 12];

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn paint_solid_row(
        data: *mut u8,
        cov: *const f32,
        cr: f32,
        cg: f32,
        cb: f32,
        ca: f32,
        n: usize,
    ) {
        if n == 0 {
            return;
        }
        let sel_r = wa::v128_load(SEL_R.as_ptr() as *const wa::v128);
        let sel_g = wa::v128_load(SEL_G.as_ptr() as *const wa::v128);
        let sel_b = wa::v128_load(SEL_B.as_ptr() as *const wa::v128);
        let sel_a = wa::v128_load(SEL_A.as_ptr() as *const wa::v128);
        let sel_trans = wa::v128_load(SEL_TRANS.as_ptr() as *const wa::v128);
        let crv = wa::f32x4_splat(cr);
        let cgv = wa::f32x4_splat(cg);
        let cbv = wa::f32x4_splat(cb);
        let cav = wa::f32x4_splat(ca);
        let v0 = wa::f32x4_splat(0.0);
        let v1 = wa::f32x4_splat(1.0);
        let v255 = wa::f32x4_splat(255.0);
        let vhalf = wa::f32x4_splat(0.5);
        let nvec = n & !3;
        let mut p = 0usize;
        while p < nvec {
            let a_vec = wa::f32x4_min(
                wa::f32x4_max(wa::v128_load(cov.add(p) as *const wa::v128), v0),
                v1,
            );
            let sa = wa::f32x4_min(wa::f32x4_max(wa::f32x4_mul(cav, a_vec), v0), v1);
            if wa::i32x4_all_true(wa::f32x4_eq(sa, v0)) {
                p += 4;
                continue;
            }
            let inv = wa::f32x4_sub(v1, sa);
            let raw = wa::v128_load(data.add(p * 4) as *const wa::v128);
            let r_u8 = wa::i8x16_swizzle(raw, sel_r);
            let g_u8 = wa::i8x16_swizzle(raw, sel_g);
            let b_u8 = wa::i8x16_swizzle(raw, sel_b);
            let a_u8 = wa::i8x16_swizzle(raw, sel_a);
            let d_r = wa::f32x4_div(
                wa::f32x4_convert_u32x4(wa::i32x4_extend_low_u16x8(wa::i16x8_extend_low_u8x16(r_u8))),
                v255,
            );
            let d_g = wa::f32x4_div(
                wa::f32x4_convert_u32x4(wa::i32x4_extend_low_u16x8(wa::i16x8_extend_low_u8x16(g_u8))),
                v255,
            );
            let d_b = wa::f32x4_div(
                wa::f32x4_convert_u32x4(wa::i32x4_extend_low_u16x8(wa::i16x8_extend_low_u8x16(b_u8))),
                v255,
            );
            let d_a = wa::f32x4_div(
                wa::f32x4_convert_u32x4(wa::i32x4_extend_low_u16x8(wa::i16x8_extend_low_u8x16(a_u8))),
                v255,
            );
            let r_r = wa::f32x4_add(wa::f32x4_mul(crv, sa), wa::f32x4_mul(d_r, inv));
            let r_g = wa::f32x4_add(wa::f32x4_mul(cgv, sa), wa::f32x4_mul(d_g, inv));
            let r_b = wa::f32x4_add(wa::f32x4_mul(cbv, sa), wa::f32x4_mul(d_b, inv));
            let r_a = wa::f32x4_add(sa, wa::f32x4_mul(d_a, inv));
            let q_r = wa::i32x4_trunc_sat_f32x4(wa::f32x4_floor(wa::f32x4_add(wa::f32x4_mul(r_r, v255), vhalf)));
            let q_g = wa::i32x4_trunc_sat_f32x4(wa::f32x4_floor(wa::f32x4_add(wa::f32x4_mul(r_g, v255), vhalf)));
            let q_b = wa::i32x4_trunc_sat_f32x4(wa::f32x4_floor(wa::f32x4_add(wa::f32x4_mul(r_b, v255), vhalf)));
            let q_a = wa::i32x4_trunc_sat_f32x4(wa::f32x4_floor(wa::f32x4_add(wa::f32x4_mul(r_a, v255), vhalf)));
            let rg = wa::i16x8_narrow_i32x4(q_r, q_g);
            let ba = wa::i16x8_narrow_i32x4(q_b, q_a);
            let bytes = wa::u8x16_narrow_i16x8(rg, ba);
            let packed = wa::i8x16_swizzle(bytes, sel_trans);
            wa::v128_store(data.add(p * 4) as *mut wa::v128, packed);
            p += 4;
        }
        for i in nvec..n {
            let a_cov = *cov.add(i);
            let a = a_cov.clamp(0.0, 1.0);
            let sa = (ca * a).clamp(0.0, 1.0);
            if sa <= 0.0 {
                continue;
            }
            let inv = 1.0 - sa;
            let idx = data.add(i * 4);
            let d0 = *idx as f32 / 255.0;
            let d1 = *idx.add(1) as f32 / 255.0;
            let d2 = *idx.add(2) as f32 / 255.0;
            let d3 = *idx.add(3) as f32 / 255.0;
            *idx = simd_byte(cr * sa + d0 * inv);
            *idx.add(1) = simd_byte(cg * sa + d1 * inv);
            *idx.add(2) = simd_byte(cb * sa + d2 * inv);
            *idx.add(3) = simd_byte(sa + d3 * inv);
        }
    }

    #[inline]
    fn simd_byte(v: f32) -> u8 {
        (v * 255.0 + 0.5).floor().clamp(0.0, 255.0) as u8
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn blit_srover(s: *const u8, d: *mut u8, n: usize, op: f64, full: bool) {
        if n == 0 {
            return;
        }
        let arep_pat = wa::v128_load(SEL_AREP.as_ptr() as *const wa::v128);
        let zero8 = wa::i8x16_splat(0);
        let m255_8 = wa::i8x16_splat(255u8 as i8);
        let one16 = wa::u16x8_splat(1);
        let m127 = wa::u16x8_splat(127);
        let m256 = wa::u16x8_splat(256);
        let op16 = wa::u16x8_splat(((op * 255.0) + 0.5) as u16);
        let op32 = op as f32;
        let nvec = n & !15;
        let mut p = 0usize;
        while p < nvec {
            let s16 = wa::v128_load(s.add(p) as *const wa::v128);
            let d16 = wa::v128_load(d.add(p) as *const wa::v128);
            let arep = wa::i8x16_swizzle(s16, arep_pat);
            let z8 = wa::i8x16_eq(arep, zero8);
            if wa::i8x16_all_true(z8) {
                p += 16;
                continue;
            }
            if full && wa::i8x16_all_true(wa::i8x16_eq(arep, m255_8)) {
                wa::v128_store(d.add(p) as *mut wa::v128, s16);
                p += 16;
                continue;
            }
            let by8: wa::v128;
            if full {
                by8 = s16;
            } else {
                let s_lo = div255(
                    wa::u16x8_add(wa::u16x8_mul(wa::u16x8_extend_low_u8x16(s16), op16), m127),
                    one16,
                );
                let s_hi = div255(
                    wa::u16x8_add(wa::u16x8_mul(wa::u16x8_extend_high_u8x16(s16), op16), m127),
                    one16,
                );
                by8 = wa::u8x16_narrow_i16x8(s_lo, s_hi);
            }
            let brep = wa::i8x16_swizzle(by8, arep_pat);
            let inv_lo = wa::u16x8_sub(m256, wa::u16x8_extend_low_u8x16(brep));
            let inv_hi = wa::u16x8_sub(m256, wa::u16x8_extend_high_u8x16(brep));
            let d_lo = wa::u16x8_extend_low_u8x16(d16);
            let d_hi = wa::u16x8_extend_high_u8x16(d16);
            let o_lo = wa::u16x8_add(
                wa::u16x8_extend_low_u8x16(by8),
                wa::u16x8_shr(wa::u16x8_mul(d_lo, inv_lo), 8),
            );
            let o_hi = wa::u16x8_add(
                wa::u16x8_extend_high_u8x16(by8),
                wa::u16x8_shr(wa::u16x8_mul(d_hi, inv_hi), 8),
            );
            let out8 = wa::u8x16_narrow_i16x8(o_lo, o_hi);
            wa::v128_store(d.add(p) as *mut wa::v128, wa::v128_bitselect(d16, out8, z8));
            p += 16;
        }
        if full {
            for i in (nvec..n).step_by(4) {
                let mut sa = *s.add(i + 3) as f32 / 255.0;
                if sa <= 0.0 {
                    continue;
                }
                sa *= op32;
                let inv = 1.0 - sa as f64;
                *d.add(i) = (*s.add(i) as f64 + *d.add(i) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 1) = (*s.add(i + 1) as f64 + *d.add(i + 1) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 2) = (*s.add(i + 2) as f64 + *d.add(i + 2) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 3) = (*s.add(i + 3) as f64 + *d.add(i + 3) as f64 * inv).round().clamp(0.0, 255.0) as u8;
            }
        } else {
            for i in (nvec..n).step_by(4) {
                let mut sa = *s.add(i + 3) as f32 / 255.0;
                if sa <= 0.0 {
                    continue;
                }
                sa *= op32;
                let inv = 1.0 - sa as f64;
                *d.add(i) = (*s.add(i) as f64 * op + *d.add(i) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 1) = (*s.add(i + 1) as f64 * op + *d.add(i + 1) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 2) = (*s.add(i + 2) as f64 * op + *d.add(i + 2) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 3) = (sa as f64 * 255.0 + *d.add(i + 3) as f64 * inv).round().clamp(0.0, 255.0) as u8;
            }
        }
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn blit_dest_in_u8(f: *const u8, d: *mut u8, n: usize) {
        if n == 0 {
            return;
        }
        let sel_rep = wa::v128_load(SEL_REP4.as_ptr() as *const wa::v128);
        let one16 = wa::u16x8_splat(1);
        let m127 = wa::u16x8_splat(127);
        let m255 = wa::u16x8_splat(255);
        let nvec = n & !15;
        let mut p = 0usize;
        while p < nvec {
            let fzero = wa::v128_load32_zero(f.add(p >> 2) as *const u32);
            let farep = wa::i8x16_swizzle(fzero, sel_rep);
            let f_lo = wa::u16x8_extend_low_u8x16(farep);
            let f_hi = wa::u16x8_extend_high_u8x16(farep);
            if wa::i16x8_all_true(wa::i16x8_eq(f_lo, m255)) && wa::i16x8_all_true(wa::i16x8_eq(f_hi, m255)) {
                p += 16;
                continue;
            }
            let d16 = wa::v128_load(d.add(p) as *const wa::v128);
            let dl = wa::u16x8_extend_low_u8x16(d16);
            let dh = wa::u16x8_extend_high_u8x16(d16);
            let o_lo = div255(wa::u16x8_add(wa::u16x8_mul(dl, f_lo), m127), one16);
            let o_hi = div255(wa::u16x8_add(wa::u16x8_mul(dh, f_hi), m127), one16);
            wa::v128_store(d.add(p) as *mut wa::v128, wa::u8x16_narrow_i16x8(o_lo, o_hi));
            p += 16;
        }
        for i in (nvec..n).step_by(4) {
            let fa = u32::from(*f.add(i >> 2));
            if fa == 255 {
                continue;
            }
            for c in 0..4 {
                let v = u32::from(*d.add(i + c));
                *d.add(i + c) = (((v * fa) + 127) / 255).min(255) as u8;
            }
        }
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn blit_dest_in(s: *const u8, d: *mut u8, n: usize) {
        if n == 0 {
            return;
        }
        let sel_arep = wa::v128_load(SEL_AREP.as_ptr() as *const wa::v128);
        let one16 = wa::u16x8_splat(1);
        let m127 = wa::u16x8_splat(127);
        let m255 = wa::u16x8_splat(255);
        let nvec = n & !15;
        let mut p = 0usize;
        while p < nvec {
            let s16 = wa::v128_load(s.add(p) as *const wa::v128);
            let d16 = wa::v128_load(d.add(p) as *const wa::v128);
            let arep = wa::i8x16_swizzle(s16, sel_arep);
            let f_lo = wa::u16x8_extend_low_u8x16(arep);
            let f_hi = wa::u16x8_extend_high_u8x16(arep);
            if wa::i16x8_all_true(wa::i16x8_eq(f_lo, m255)) && wa::i16x8_all_true(wa::i16x8_eq(f_hi, m255)) {
                p += 16;
                continue;
            }
            let dl = wa::u16x8_extend_low_u8x16(d16);
            let dh = wa::u16x8_extend_high_u8x16(d16);
            let o_lo = div255(wa::u16x8_add(wa::u16x8_mul(dl, f_lo), m127), one16);
            let o_hi = div255(wa::u16x8_add(wa::u16x8_mul(dh, f_hi), m127), one16);
            wa::v128_store(d.add(p) as *mut wa::v128, wa::u8x16_narrow_i16x8(o_lo, o_hi));
            p += 16;
        }
        for i in (nvec..n).step_by(4) {
            let sa = *s.add(i + 3);
            if sa == 255 {
                continue;
            }
            let f = u32::from(sa);
            for c in 0..4 {
                let dv = u32::from(*d.add(i + c));
                *d.add(i + c) = (((dv * f) + 127) / 255).min(255) as u8;
            }
        }
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn blit_dest_out(s: *const u8, d: *mut u8, n: usize) {
        if n == 0 {
            return;
        }
        let sel_arep = wa::v128_load(SEL_AREP.as_ptr() as *const wa::v128);
        let one16 = wa::u16x8_splat(1);
        let m127 = wa::u16x8_splat(127);
        let m255 = wa::u16x8_splat(255);
        let nvec = n & !15;
        let mut p = 0usize;
        while p < nvec {
            let s16 = wa::v128_load(s.add(p) as *const wa::v128);
            let d16 = wa::v128_load(d.add(p) as *const wa::v128);
            let arep = wa::i8x16_swizzle(s16, sel_arep);
            let f_lo = wa::u16x8_sub(m255, wa::u16x8_extend_low_u8x16(arep));
            let f_hi = wa::u16x8_sub(m255, wa::u16x8_extend_high_u8x16(arep));
            if wa::i16x8_all_true(wa::i16x8_eq(f_lo, m255)) && wa::i16x8_all_true(wa::i16x8_eq(f_hi, m255)) {
                p += 16;
                continue;
            }
            let dl = wa::u16x8_extend_low_u8x16(d16);
            let dh = wa::u16x8_extend_high_u8x16(d16);
            let o_lo = div255(wa::u16x8_add(wa::u16x8_mul(dl, f_lo), m127), one16);
            let o_hi = div255(wa::u16x8_add(wa::u16x8_mul(dh, f_hi), m127), one16);
            wa::v128_store(
                d.add(p) as *mut wa::v128,
                wa::u8x16_narrow_i16x8(o_lo, o_hi),
            );
            p += 16;
        }
        for i in (nvec..n).step_by(4) {
            let sa = *s.add(i + 3) as f32 / 255.0;
            let inv = 1.0 - sa;
            let dv = [
                *d.add(i) as f32 / 255.0,
                *d.add(i + 1) as f32 / 255.0,
                *d.add(i + 2) as f32 / 255.0,
                *d.add(i + 3) as f32 / 255.0,
            ];
            *d.add(i) = (dv[0] * inv * 255.0).round().clamp(0.0, 255.0) as u8;
            *d.add(i + 1) = (dv[1] * inv * 255.0).round().clamp(0.0, 255.0) as u8;
            *d.add(i + 2) = (dv[2] * inv * 255.0).round().clamp(0.0, 255.0) as u8;
            *d.add(i + 3) = (dv[3] * inv * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn grad_lut_fill(
        data: *mut u8,
        t0: f32,
        dt: f32,
        n: usize,
        lut: *const u32,
        out: *mut u32,
    ) {
        let t0v = wa::f32x4_splat(t0);
        let dtv = wa::f32x4_splat(dt);
        let zero = wa::f32x4_splat(0.0);
        let one_f = wa::f32x4_splat(1.0);
        let half_f = wa::f32x4_splat(0.5);
        let f255 = wa::f32x4_splat(1023.0);
        let four = wa::f32x4_splat(4.0);
        let mut kf = wa::f32x4(0.0, 1.0, 2.0, 3.0);
        let nvec = n & !3;
        let mut p = 0usize;
        while p < nvec {
            let t = wa::f32x4_add(t0v, wa::f32x4_mul(kf, dtv));
            let tc = wa::f32x4_min(wa::f32x4_max(t, zero), one_f);
            let idx = wa::u32x4_trunc_sat_f32x4(wa::f32x4_add(wa::f32x4_mul(tc, f255), half_f));
            let i0 = wa::u32x4_extract_lane::<0>(idx) as usize;
            let i1 = wa::u32x4_extract_lane::<1>(idx) as usize;
            let i2 = wa::u32x4_extract_lane::<2>(idx) as usize;
            let i3 = wa::u32x4_extract_lane::<3>(idx) as usize;
            let pv = wa::u32x4(*lut.add(i0), *lut.add(i1), *lut.add(i2), *lut.add(i3));
            wa::v128_store(data.add(p * 4) as *mut wa::v128, pv);
            if !out.is_null() {
                wa::v128_store(out.add(p) as *mut wa::v128, pv);
            }
            kf = wa::f32x4_add(kf, four);
            p += 4;
        }
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn rgrad_lut_fill(
        data: *mut u8,
        base_lx: f32,
        base_ly: f32,
        ax: f32,
        ay: f32,
        inv_r: f32,
        n: usize,
        lut: *const u32,
        out: *mut u32,
    ) {
        let lx0v = wa::f32x4_splat(base_lx);
        let ly0v = wa::f32x4_splat(base_ly);
        let axv = wa::f32x4_splat(ax);
        let ayv = wa::f32x4_splat(ay);
        let invv = wa::f32x4_splat(inv_r);
        let zero = wa::f32x4_splat(0.0);
        let one_f = wa::f32x4_splat(1.0);
        let half_f = wa::f32x4_splat(0.5);
        let f255 = wa::f32x4_splat(1023.0);
        let four = wa::f32x4_splat(4.0);
        let mut kf = wa::f32x4(0.0, 1.0, 2.0, 3.0);
        let nvec = n & !3;
        let mut p = 0usize;
        while p < nvec {
            let lx = wa::f32x4_add(lx0v, wa::f32x4_mul(kf, axv));
            let ly = wa::f32x4_add(ly0v, wa::f32x4_mul(kf, ayv));
            let t = wa::f32x4_mul(
                wa::f32x4_sqrt(wa::f32x4_add(wa::f32x4_mul(lx, lx), wa::f32x4_mul(ly, ly))),
                invv,
            );
            let tc = wa::f32x4_min(wa::f32x4_max(t, zero), one_f);
            let idx = wa::u32x4_trunc_sat_f32x4(wa::f32x4_add(wa::f32x4_mul(tc, f255), half_f));
            let i0 = wa::u32x4_extract_lane::<0>(idx) as usize;
            let i1 = wa::u32x4_extract_lane::<1>(idx) as usize;
            let i2 = wa::u32x4_extract_lane::<2>(idx) as usize;
            let i3 = wa::u32x4_extract_lane::<3>(idx) as usize;
            let pv = wa::u32x4(*lut.add(i0), *lut.add(i1), *lut.add(i2), *lut.add(i3));
            wa::v128_store(data.add(p * 4) as *mut wa::v128, pv);
            if !out.is_null() {
                wa::v128_store(out.add(p) as *mut wa::v128, pv);
            }
            kf = wa::f32x4_add(kf, four);
            p += 4;
        }
    }

    #[inline]
    fn div255(x: wa::v128, one: wa::v128) -> wa::v128 {
        wa::u16x8_shr(wa::u16x8_add(x, wa::u16x8_add(one, wa::u16x8_shr(x, 8))), 8)
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn grad_lut_span(
        data: *mut u8,
        t0: f32,
        dt: f32,
        n: usize,
        lut: *const u32,
        cova: u32,
        out: *mut u32,
    ) {
        let arep_pat = wa::v128_load(SEL_AREP.as_ptr() as *const wa::v128);
        let t0v = wa::f32x4_splat(t0);
        let dtv = wa::f32x4_splat(dt);
        let zero = wa::f32x4_splat(0.0);
        let one_f = wa::f32x4_splat(1.0);
        let half_f = wa::f32x4_splat(0.5);
        let f255 = wa::f32x4_splat(1023.0);
        let four = wa::f32x4_splat(4.0);
        let mut kf = wa::f32x4(0.0, 1.0, 2.0, 3.0);
        let c16 = wa::u16x8_splat(cova as u16);
        let one16 = wa::u16x8_splat(1);
        let m127 = wa::u16x8_splat(127);
        let m256 = wa::u16x8_splat(256);
        let nvec = n & !3;
        let mut p = 0usize;
        if cova == 255 {
            while p < nvec {
                let t = wa::f32x4_add(t0v, wa::f32x4_mul(kf, dtv));
                let tc = wa::f32x4_min(wa::f32x4_max(t, zero), one_f);
                let idx = wa::u32x4_trunc_sat_f32x4(wa::f32x4_add(wa::f32x4_mul(tc, f255), half_f));
                let i0 = wa::u32x4_extract_lane::<0>(idx) as usize;
                let i1 = wa::u32x4_extract_lane::<1>(idx) as usize;
                let i2 = wa::u32x4_extract_lane::<2>(idx) as usize;
                let i3 = wa::u32x4_extract_lane::<3>(idx) as usize;
                let pv = wa::u32x4_replace_lane::<3>(
                    wa::u32x4_replace_lane::<2>(
                        wa::u32x4_replace_lane::<1>(wa::u32x4_splat(*lut.add(i0)), *lut.add(i1)),
                        *lut.add(i2),
                    ),
                    *lut.add(i3),
                );
                if !out.is_null() {
                    wa::v128_store(out.add(p) as *mut wa::v128, pv);
                }
                let arepv = wa::i8x16_swizzle(pv, arep_pat);
                let inv_lo = wa::u16x8_sub(m256, wa::u16x8_extend_low_u8x16(arepv));
                let inv_hi = wa::u16x8_sub(m256, wa::u16x8_extend_high_u8x16(arepv));
                let d_raw = wa::v128_load(data.add(p * 4) as *const wa::v128);
                let d16_lo = wa::u16x8_extend_low_u8x16(d_raw);
                let d16_hi = wa::u16x8_extend_high_u8x16(d_raw);
                let o_lo = wa::u16x8_add(wa::u16x8_extend_low_u8x16(pv), wa::u16x8_shr(wa::u16x8_mul(d16_lo, inv_lo), 8));
                let o_hi = wa::u16x8_add(wa::u16x8_extend_high_u8x16(pv), wa::u16x8_shr(wa::u16x8_mul(d16_hi, inv_hi), 8));
                wa::v128_store(data.add(p * 4) as *mut wa::v128, wa::u8x16_narrow_i16x8(o_lo, o_hi));
                kf = wa::f32x4_add(kf, four);
                p += 4;
            }
        } else {
            while p < nvec {
                let t = wa::f32x4_add(t0v, wa::f32x4_mul(kf, dtv));
                let tc = wa::f32x4_min(wa::f32x4_max(t, zero), one_f);
                let idx = wa::u32x4_trunc_sat_f32x4(wa::f32x4_add(wa::f32x4_mul(tc, f255), half_f));
                let i0 = wa::u32x4_extract_lane::<0>(idx) as usize;
                let i1 = wa::u32x4_extract_lane::<1>(idx) as usize;
                let i2 = wa::u32x4_extract_lane::<2>(idx) as usize;
                let i3 = wa::u32x4_extract_lane::<3>(idx) as usize;
                let pv = wa::u32x4_replace_lane::<3>(
                    wa::u32x4_replace_lane::<2>(
                        wa::u32x4_replace_lane::<1>(wa::u32x4_splat(*lut.add(i0)), *lut.add(i1)),
                        *lut.add(i2),
                    ),
                    *lut.add(i3),
                );
                let s16_lo = div255(wa::u16x8_add(wa::u16x8_mul(wa::u16x8_extend_low_u8x16(pv), c16), m127), one16);
                let s16_hi = div255(wa::u16x8_add(wa::u16x8_mul(wa::u16x8_extend_high_u8x16(pv), c16), m127), one16);
                let s8 = wa::u8x16_narrow_i16x8(s16_lo, s16_hi);
                if !out.is_null() {
                    wa::v128_store(out.add(p) as *mut wa::v128, s8);
                }
                let arepv = wa::i8x16_swizzle(s8, arep_pat);
                let inv_lo = wa::u16x8_sub(m256, wa::u16x8_extend_low_u8x16(arepv));
                let inv_hi = wa::u16x8_sub(m256, wa::u16x8_extend_high_u8x16(arepv));
                let d_raw = wa::v128_load(data.add(p * 4) as *const wa::v128);
                let d16_lo = wa::u16x8_extend_low_u8x16(d_raw);
                let d16_hi = wa::u16x8_extend_high_u8x16(d_raw);
                let o_lo = wa::u16x8_add(s16_lo, wa::u16x8_shr(wa::u16x8_mul(d16_lo, inv_lo), 8));
                let o_hi = wa::u16x8_add(s16_hi, wa::u16x8_shr(wa::u16x8_mul(d16_hi, inv_hi), 8));
                wa::v128_store(data.add(p * 4) as *mut wa::v128, wa::u8x16_narrow_i16x8(o_lo, o_hi));
                kf = wa::f32x4_add(kf, four);
                p += 4;
            }
        }
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn rgrad_lut_span(
        data: *mut u8,
        base_lx: f32,
        base_ly: f32,
        ax: f32,
        ay: f32,
        inv_r: f32,
        n: usize,
        lut: *const u32,
        cova: u32,
        out: *mut u32,
    ) {
        let arep_pat = wa::v128_load(SEL_AREP.as_ptr() as *const wa::v128);
        let lx0v = wa::f32x4_splat(base_lx);
        let ly0v = wa::f32x4_splat(base_ly);
        let axv = wa::f32x4_splat(ax);
        let ayv = wa::f32x4_splat(ay);
        let invv = wa::f32x4_splat(inv_r);
        let zero = wa::f32x4_splat(0.0);
        let one_f = wa::f32x4_splat(1.0);
        let half_f = wa::f32x4_splat(0.5);
        let f255 = wa::f32x4_splat(1023.0);
        let four = wa::f32x4_splat(4.0);
        let mut kf = wa::f32x4(0.0, 1.0, 2.0, 3.0);
        let c16 = wa::u16x8_splat(cova as u16);
        let one16 = wa::u16x8_splat(1);
        let m127 = wa::u16x8_splat(127);
        let m256 = wa::u16x8_splat(256);
        let nvec = n & !3;
        let mut p = 0usize;
        if cova == 255 {
            while p < nvec {
                let lx = wa::f32x4_add(lx0v, wa::f32x4_mul(kf, axv));
                let ly = wa::f32x4_add(ly0v, wa::f32x4_mul(kf, ayv));
                let t = wa::f32x4_mul(
                    wa::f32x4_sqrt(wa::f32x4_add(wa::f32x4_mul(lx, lx), wa::f32x4_mul(ly, ly))),
                    invv,
                );
                let tc = wa::f32x4_min(wa::f32x4_max(t, zero), one_f);
                let idx = wa::u32x4_trunc_sat_f32x4(wa::f32x4_add(wa::f32x4_mul(tc, f255), half_f));
                let i0 = wa::u32x4_extract_lane::<0>(idx) as usize;
                let i1 = wa::u32x4_extract_lane::<1>(idx) as usize;
                let i2 = wa::u32x4_extract_lane::<2>(idx) as usize;
                let i3 = wa::u32x4_extract_lane::<3>(idx) as usize;
                let pv = wa::u32x4_replace_lane::<3>(
                    wa::u32x4_replace_lane::<2>(
                        wa::u32x4_replace_lane::<1>(wa::u32x4_splat(*lut.add(i0)), *lut.add(i1)),
                        *lut.add(i2),
                    ),
                    *lut.add(i3),
                );
                if !out.is_null() {
                    wa::v128_store(out.add(p) as *mut wa::v128, pv);
                }
                let arepv = wa::i8x16_swizzle(pv, arep_pat);
                let inv_lo = wa::u16x8_sub(m256, wa::u16x8_extend_low_u8x16(arepv));
                let inv_hi = wa::u16x8_sub(m256, wa::u16x8_extend_high_u8x16(arepv));
                let d_raw = wa::v128_load(data.add(p * 4) as *const wa::v128);
                let d16_lo = wa::u16x8_extend_low_u8x16(d_raw);
                let d16_hi = wa::u16x8_extend_high_u8x16(d_raw);
                let o_lo = wa::u16x8_add(wa::u16x8_extend_low_u8x16(pv), wa::u16x8_shr(wa::u16x8_mul(d16_lo, inv_lo), 8));
                let o_hi = wa::u16x8_add(wa::u16x8_extend_high_u8x16(pv), wa::u16x8_shr(wa::u16x8_mul(d16_hi, inv_hi), 8));
                wa::v128_store(data.add(p * 4) as *mut wa::v128, wa::u8x16_narrow_i16x8(o_lo, o_hi));
                kf = wa::f32x4_add(kf, four);
                p += 4;
            }
        } else {
            while p < nvec {
                let lx = wa::f32x4_add(lx0v, wa::f32x4_mul(kf, axv));
                let ly = wa::f32x4_add(ly0v, wa::f32x4_mul(kf, ayv));
                let t = wa::f32x4_mul(
                    wa::f32x4_sqrt(wa::f32x4_add(wa::f32x4_mul(lx, lx), wa::f32x4_mul(ly, ly))),
                    invv,
                );
                let tc = wa::f32x4_min(wa::f32x4_max(t, zero), one_f);
                let idx = wa::u32x4_trunc_sat_f32x4(wa::f32x4_add(wa::f32x4_mul(tc, f255), half_f));
                let i0 = wa::u32x4_extract_lane::<0>(idx) as usize;
                let i1 = wa::u32x4_extract_lane::<1>(idx) as usize;
                let i2 = wa::u32x4_extract_lane::<2>(idx) as usize;
                let i3 = wa::u32x4_extract_lane::<3>(idx) as usize;
                let pv = wa::u32x4_replace_lane::<3>(
                    wa::u32x4_replace_lane::<2>(
                        wa::u32x4_replace_lane::<1>(wa::u32x4_splat(*lut.add(i0)), *lut.add(i1)),
                        *lut.add(i2),
                    ),
                    *lut.add(i3),
                );
                let s16_lo = div255(wa::u16x8_add(wa::u16x8_mul(wa::u16x8_extend_low_u8x16(pv), c16), m127), one16);
                let s16_hi = div255(wa::u16x8_add(wa::u16x8_mul(wa::u16x8_extend_high_u8x16(pv), c16), m127), one16);
                let s8 = wa::u8x16_narrow_i16x8(s16_lo, s16_hi);
                if !out.is_null() {
                    wa::v128_store(out.add(p) as *mut wa::v128, s8);
                }
                let arepv = wa::i8x16_swizzle(s8, arep_pat);
                let inv_lo = wa::u16x8_sub(m256, wa::u16x8_extend_low_u8x16(arepv));
                let inv_hi = wa::u16x8_sub(m256, wa::u16x8_extend_high_u8x16(arepv));
                let d_raw = wa::v128_load(data.add(p * 4) as *const wa::v128);
                let d16_lo = wa::u16x8_extend_low_u8x16(d_raw);
                let d16_hi = wa::u16x8_extend_high_u8x16(d_raw);
                let o_lo = wa::u16x8_add(s16_lo, wa::u16x8_shr(wa::u16x8_mul(d16_lo, inv_lo), 8));
                let o_hi = wa::u16x8_add(s16_hi, wa::u16x8_shr(wa::u16x8_mul(d16_hi, inv_hi), 8));
                wa::v128_store(data.add(p * 4) as *mut wa::v128, wa::u8x16_narrow_i16x8(o_lo, o_hi));
                kf = wa::f32x4_add(kf, four);
                p += 4;
            }
        }
    }

    #[inline(always)]
    unsafe fn grad_gather4(idx: wa::v128, lut: *const u32) -> wa::v128 {
        let i0 = wa::u32x4_extract_lane::<0>(idx) as usize;
        let i1 = wa::u32x4_extract_lane::<1>(idx) as usize;
        let i2 = wa::u32x4_extract_lane::<2>(idx) as usize;
        let i3 = wa::u32x4_extract_lane::<3>(idx) as usize;
        wa::u32x4(*lut.add(i0), *lut.add(i1), *lut.add(i2), *lut.add(i3))
    }

    
    
    
    
    #[inline(always)]
    #[allow(clippy::too_many_arguments)]
    unsafe fn cov_blend4(
        pv: wa::v128,
        d: wa::v128,
        cov4: u32,
        sel_dup: wa::v128,
        sel_arep: wa::v128,
        one16: wa::v128,
        m127: wa::v128,
        m256: wa::v128,
    ) -> wa::v128 {
        let (s_lo, s_hi, s8) = if cov4 == 0xFFFF_FFFF {
            (
                wa::u16x8_extend_low_u8x16(pv),
                wa::u16x8_extend_high_u8x16(pv),
                pv,
            )
        } else {
            let cvv = wa::u32x4(
                cov4 & 0xff,
                (cov4 >> 8) & 0xff,
                (cov4 >> 16) & 0xff,
                (cov4 >> 24) & 0xff,
            );
            let cvb = wa::i8x16_swizzle(cvv, sel_dup);
            let cv_lo = wa::u16x8_extend_low_u8x16(cvb);
            let cv_hi = wa::u16x8_extend_high_u8x16(cvb);
            let lo = div255(
                wa::u16x8_add(wa::u16x8_mul(wa::u16x8_extend_low_u8x16(pv), cv_lo), m127),
                one16,
            );
            let hi = div255(
                wa::u16x8_add(wa::u16x8_mul(wa::u16x8_extend_high_u8x16(pv), cv_hi), m127),
                one16,
            );
            (lo, hi, wa::u8x16_narrow_i16x8(lo, hi))
        };
        let arep = wa::i8x16_swizzle(s8, sel_arep);
        let inv_lo = wa::u16x8_sub(m256, wa::u16x8_extend_low_u8x16(arep));
        let inv_hi = wa::u16x8_sub(m256, wa::u16x8_extend_high_u8x16(arep));
        let dl = wa::u16x8_extend_low_u8x16(d);
        let dh = wa::u16x8_extend_high_u8x16(d);
        let o_lo = wa::u16x8_add(s_lo, wa::u16x8_shr(wa::u16x8_mul(dl, inv_lo), 8));
        let o_hi = wa::u16x8_add(s_hi, wa::u16x8_shr(wa::u16x8_mul(dh, inv_hi), 8));
        wa::u8x16_narrow_i16x8(o_lo, o_hi)
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn grad_lut_cov_span(
        data: *mut u8,
        t0: f32,
        dt: f32,
        n: usize,
        lut: *const u32,
        cov: *const u8,
    ) {
        if n == 0 {
            return;
        }
        let sel_dup = wa::v128_load(SEL_DUP.as_ptr() as *const wa::v128);
        let sel_arep = wa::v128_load(SEL_AREP.as_ptr() as *const wa::v128);
        let t0v = wa::f32x4_splat(t0);
        let dtv = wa::f32x4_splat(dt);
        let zero = wa::f32x4_splat(0.0);
        let one_f = wa::f32x4_splat(1.0);
        let half_f = wa::f32x4_splat(0.5);
        let f255 = wa::f32x4_splat(1023.0);
        let four = wa::f32x4_splat(4.0);
        let mut kf = wa::f32x4(0.0, 1.0, 2.0, 3.0);
        let one16 = wa::u16x8_splat(1);
        let m127 = wa::u16x8_splat(127);
        let m256 = wa::u16x8_splat(256);
        let nvec = n & !3;
        let mut p = 0usize;
        while p < nvec {
            let cov4 = core::ptr::read_unaligned(cov.add(p) as *const u32);
            if cov4 == 0 {
                kf = wa::f32x4_add(kf, four);
                p += 4;
                continue;
            }
            let t = wa::f32x4_add(t0v, wa::f32x4_mul(kf, dtv));
            let tc = wa::f32x4_min(wa::f32x4_max(t, zero), one_f);
            let idx = wa::u32x4_trunc_sat_f32x4(wa::f32x4_add(wa::f32x4_mul(tc, f255), half_f));
            let pv = grad_gather4(idx, lut);
            let d = wa::v128_load(data.add(p * 4) as *const wa::v128);
            let out = cov_blend4(pv, d, cov4, sel_dup, sel_arep, one16, m127, m256);
            wa::v128_store(data.add(p * 4) as *mut wa::v128, out);
            kf = wa::f32x4_add(kf, four);
            p += 4;
        }
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn rgrad_lut_cov_span(
        data: *mut u8,
        base_lx: f32,
        base_ly: f32,
        ax: f32,
        ay: f32,
        inv_r: f32,
        n: usize,
        lut: *const u32,
        cov: *const u8,
    ) {
        if n == 0 {
            return;
        }
        let sel_dup = wa::v128_load(SEL_DUP.as_ptr() as *const wa::v128);
        let sel_arep = wa::v128_load(SEL_AREP.as_ptr() as *const wa::v128);
        let lx0v = wa::f32x4_splat(base_lx);
        let ly0v = wa::f32x4_splat(base_ly);
        let axv = wa::f32x4_splat(ax);
        let ayv = wa::f32x4_splat(ay);
        let invv = wa::f32x4_splat(inv_r);
        let zero = wa::f32x4_splat(0.0);
        let one_f = wa::f32x4_splat(1.0);
        let half_f = wa::f32x4_splat(0.5);
        let f255 = wa::f32x4_splat(1023.0);
        let four = wa::f32x4_splat(4.0);
        let mut kf = wa::f32x4(0.0, 1.0, 2.0, 3.0);
        let one16 = wa::u16x8_splat(1);
        let m127 = wa::u16x8_splat(127);
        let m256 = wa::u16x8_splat(256);
        let nvec = n & !3;
        let mut p = 0usize;
        while p < nvec {
            let cov4 = core::ptr::read_unaligned(cov.add(p) as *const u32);
            if cov4 == 0 {
                kf = wa::f32x4_add(kf, four);
                p += 4;
                continue;
            }
            let lx = wa::f32x4_add(lx0v, wa::f32x4_mul(kf, axv));
            let ly = wa::f32x4_add(ly0v, wa::f32x4_mul(kf, ayv));
            let t = wa::f32x4_mul(
                wa::f32x4_sqrt(wa::f32x4_add(wa::f32x4_mul(lx, lx), wa::f32x4_mul(ly, ly))),
                invv,
            );
            let tc = wa::f32x4_min(wa::f32x4_max(t, zero), one_f);
            let idx = wa::u32x4_trunc_sat_f32x4(wa::f32x4_add(wa::f32x4_mul(tc, f255), half_f));
            let pv = grad_gather4(idx, lut);
            let d = wa::v128_load(data.add(p * 4) as *const wa::v128);
            let out = cov_blend4(pv, d, cov4, sel_dup, sel_arep, one16, m127, m256);
            wa::v128_store(data.add(p * 4) as *mut wa::v128, out);
            kf = wa::f32x4_add(kf, four);
            p += 4;
        }
    }

    #[inline(always)]
    pub(crate) unsafe fn over_prem_px(q: *mut u8, prem: u32, inv: u32) {
        let x = core::ptr::read_unaligned(q as *const u32);
        let lo = (x & 0x00FF_00FF).wrapping_mul(inv) >> 8 & 0x00FF_00FF;
        let hi = ((x >> 8) & 0x00FF_00FF).wrapping_mul(inv) >> 8 & 0x00FF_00FF;
        core::ptr::write_unaligned(q as *mut u32, prem.wrapping_add(lo | (hi << 8)));
    }

    
    #[inline(always)]
    unsafe fn div255_s(x: u32) -> u32 {
        (x + 1 + (x >> 8)) >> 8
    }

    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn solid_cov_row(data: *mut u8, cov: *const u8, col: u32, n: usize) {
        if n == 0 {
            return;
        }
        let a8 = (col >> 24) & 0xff;
        if a8 == 0 {
            return;
        }
        let cr = col & 0xff;
        let cg = (col >> 8) & 0xff;
        let cb = (col >> 16) & 0xff;
        if n < 8 {
            let mut p = 0usize;
            while p < n {
                let cov8 = u32::from(*cov.add(p));
                let sa = div255_s(a8 * cov8 + 127);
                if sa == 0 {
                    p += 1;
                    continue;
                }
                if sa == 255 {
                    let q = data.add(p * 4);
                    *q = cr as u8;
                    *q.add(1) = cg as u8;
                    *q.add(2) = cb as u8;
                    *q.add(3) = 255;
                    p += 1;
                    continue;
                }
                let s_r = div255_s(cr * sa + 127);
                let s_g = div255_s(cg * sa + 127);
                let s_b = div255_s(cb * sa + 127);
                let prem = s_r | (s_g << 8) | (s_b << 16) | (sa << 24);
                over_prem_px(data.add(p * 4), prem, 256 - sa);
                p += 1;
            }
            return;
        }
        let rv = wa::u16x8_splat(cr as u16);
        let gv = wa::u16x8_splat(cg as u16);
        let bv = wa::u16x8_splat(cb as u16);
        let av = wa::u16x8_splat(a8 as u16);
        let one16 = wa::u16x8_splat(1);
        let m127 = wa::u16x8_splat(127);
        let m256 = wa::u16x8_splat(256);
        let sel_r = wa::v128_load(SEL_R.as_ptr() as *const wa::v128);
        let sel_g = wa::v128_load(SEL_G.as_ptr() as *const wa::v128);
        let sel_b = wa::v128_load(SEL_B.as_ptr() as *const wa::v128);
        let sel_a = wa::v128_load(SEL_A.as_ptr() as *const wa::v128);
        let sel_trans = wa::v128_load(SEL_TRANS.as_ptr() as *const wa::v128);
        let opaque = a8 == 255;
        
        let splat = |sa: u32| -> (wa::v128, wa::v128) {
            let s_r = div255_s(cr * sa + 127) as u16;
            let s_g = div255_s(cg * sa + 127) as u16;
            let s_b = div255_s(cb * sa + 127) as u16;
            let inv = (256 - sa) as u16;
            let sv = wa::u16x8(s_r, s_g, s_b, sa as u16, s_r, s_g, s_b, sa as u16);
            (sv, wa::u16x8_splat(inv))
        };
        let nvec = n & !3;
        let mut p = 0usize;
        
        
        
        let mut last_c = u32::MAX;
        let mut last_sv = wa::u16x8_splat(0);
        let mut last_inv = wa::u16x8_splat(0);
        while p < nvec {
            let cov4 = core::ptr::read_unaligned(cov.add(p) as *const u32);
            if cov4 == 0 {
                p += 4;
                continue;
            }
            
            if cov4 == 0x0101_0101u32.wrapping_mul(cov4 & 0xff) {
                let c = (cov4 & 0xff) as u32;
                let sa = div255_s(a8 * c + 127);
                if sa == 0 {
                    p += 4;
                    continue;
                }
                if sa == 255 {
                    store_prem(data.add(p * 4), col, 4);
                    p += 4;
                    continue;
                }
                if c != last_c {
                    let (sv, inv) = splat(sa);
                    last_c = c;
                    last_sv = sv;
                    last_inv = inv;
                }
                let sv = last_sv;
                let inv = last_inv;
                let raw = wa::v128_load(data.add(p * 4) as *const wa::v128);
                let d16_lo = wa::u16x8_extend_low_u8x16(raw);
                let d16_hi = wa::u16x8_extend_high_u8x16(raw);
                let o_lo = wa::u16x8_add(sv, wa::u16x8_shr(wa::u16x8_mul(d16_lo, inv), 8));
                let o_hi = wa::u16x8_add(sv, wa::u16x8_shr(wa::u16x8_mul(d16_hi, inv), 8));
                wa::v128_store(data.add(p * 4) as *mut wa::v128, wa::u8x16_narrow_i16x8(o_lo, o_hi));
                p += 4;
                continue;
            }
            if cov4 == 0xFFFF_FFFF && opaque {
                store_prem(data.add(p * 4), col, 4);
                p += 4;
                continue;
            }
            let raw = wa::v128_load(data.add(p * 4) as *const wa::v128);
            let cv = wa::i16x8(
                (cov4 & 0xff) as i16,
                ((cov4 >> 8) & 0xff) as i16,
                ((cov4 >> 16) & 0xff) as i16,
                ((cov4 >> 24) & 0xff) as i16,
                0,
                0,
                0,
                0,
            );
            let sa = div255(wa::u16x8_add(wa::u16x8_mul(av, cv), m127), one16);
            let sr = div255(wa::u16x8_add(wa::u16x8_mul(rv, sa), m127), one16);
            let sg = div255(wa::u16x8_add(wa::u16x8_mul(gv, sa), m127), one16);
            let sb = div255(wa::u16x8_add(wa::u16x8_mul(bv, sa), m127), one16);
            let inv = wa::u16x8_sub(m256, sa);
            let dr = wa::u16x8_extend_low_u8x16(wa::i8x16_swizzle(raw, sel_r));
            let dg = wa::u16x8_extend_low_u8x16(wa::i8x16_swizzle(raw, sel_g));
            let db = wa::u16x8_extend_low_u8x16(wa::i8x16_swizzle(raw, sel_b));
            let da = wa::u16x8_extend_low_u8x16(wa::i8x16_swizzle(raw, sel_a));
            let orr = wa::u16x8_add(sr, wa::u16x8_shr(wa::u16x8_mul(dr, inv), 8));
            let org = wa::u16x8_add(sg, wa::u16x8_shr(wa::u16x8_mul(dg, inv), 8));
            let orb = wa::u16x8_add(sb, wa::u16x8_shr(wa::u16x8_mul(db, inv), 8));
            let ora = wa::u16x8_add(sa, wa::u16x8_shr(wa::u16x8_mul(da, inv), 8));
            let rg = wa::u8x16_narrow_i16x8(orr, org);
            let ba = wa::u8x16_narrow_i16x8(orb, ora);
            let bytes = wa::i8x16_shuffle::<0, 1, 2, 3, 8, 9, 10, 11, 16, 17, 18, 19, 24, 25, 26, 27>(rg, ba);
            let packed = wa::i8x16_swizzle(bytes, sel_trans);
            wa::v128_store(data.add(p * 4) as *mut wa::v128, packed);
            p += 4;
        }
        while p < n {
            let cov8 = u32::from(*cov.add(p));
            let sa = div255_s(a8 * cov8 + 127);
            if sa == 0 {
                p += 1;
                continue;
            }
            if sa == 255 {
                let q = data.add(p * 4);
                *q = cr as u8;
                *q.add(1) = cg as u8;
                *q.add(2) = cb as u8;
                *q.add(3) = 255;
                p += 1;
                continue;
            }
            let s_r = div255_s(cr * sa + 127);
            let s_g = div255_s(cg * sa + 127);
            let s_b = div255_s(cb * sa + 127);
            let prem = s_r | (s_g << 8) | (s_b << 16) | (sa << 24);
            over_prem_px(data.add(p * 4), prem, 256 - sa);
            p += 1;
        }
    }

    #[inline]
    #[target_feature(enable = "simd128")]
    unsafe fn store_prem(data: *mut u8, prem: u32, n: usize) {
        let full = wa::u32x4_splat(prem);
        let nvec = n & !3;
        let mut p = 0usize;
        while p < nvec {
            wa::v128_store(data.add(p * 4) as *mut wa::v128, full);
            p += 4;
        }
        let mut i = nvec;
        while i < n {
            core::ptr::write_unaligned(data.add(i * 4) as *mut u32, prem);
            i += 1;
        }
    }

    
    
    #[inline]
    pub(crate) unsafe fn solid_span_small(data: *mut u8, col: u32, cova: u32, n: usize) {
        let cov8 = u32::from(cova as u8);
        let a8 = (col >> 24) & 0xff;
        if cov8 == 0 || a8 == 0 {
            return;
        }
        
        let sa = if a8 == 255 { cov8 } else { div255_s(a8 * cov8 + 127) };
        let s_r = div255_s((col & 0xff) * sa + 127);
        let s_g = div255_s(((col >> 8) & 0xff) * sa + 127);
        let s_b = div255_s(((col >> 16) & 0xff) * sa + 127);
        let prem = s_r | (s_g << 8) | (s_b << 16) | ((sa & 0xff) << 24);
        if sa == 255 {
            let mut i = 0usize;
            while i < n {
                core::ptr::write_unaligned(data.add(i * 4) as *mut u32, prem);
                i += 1;
            }
            return;
        }
        let inv32 = 256 - sa;
        let mut i = 0usize;
        while i < n {
            over_prem_px(data.add(i * 4), prem, inv32);
            i += 1;
        }
    }

    #[target_feature(enable = "simd128")]
    pub unsafe fn solid_grad_span(data: *mut u8, col: u32, cova: u32, n: usize) {
        let cov8 = u32::from(cova as u8);
        let a8 = (col >> 24) & 0xff;
        if cov8 == 0 || a8 == 0 {
            return;
        }
        if cov8 == 255 && a8 == 255 {
            store_prem(data, col, n);
            return;
        }
        
        let sa = if a8 == 255 { cov8 } else { div255_s(a8 * cov8 + 127) };
        let sa8 = sa as u16;
        let s_r = div255_s((col & 0xff) * sa + 127);
        let s_g = div255_s(((col >> 8) & 0xff) * sa + 127);
        let s_b = div255_s(((col >> 16) & 0xff) * sa + 127);
        let prem = s_r | (s_g << 8) | (s_b << 16) | ((sa & 0xff) << 24);
        if sa == 255 {
            store_prem(data, prem, n);
            return;
        }
        if n < 8 {
            let inv32 = 256 - sa;
            let mut i = 0usize;
            while i < n {
                over_prem_px(data.add(i * 4), prem, inv32);
                i += 1;
            }
            return;
        }
        let svec = wa::u32x4_splat(prem);
        let s_lo = wa::u16x8_extend_low_u8x16(svec);
        let s_hi = wa::u16x8_extend_high_u8x16(svec);
        let inv = wa::u16x8_sub(wa::u16x8_splat(256u16), wa::u16x8_splat(sa8));
        let nvec = n & !3;
        let mut p = 0usize;
        while p < nvec {
            let raw = wa::v128_load(data.add(p * 4) as *const wa::v128);
            let d_lo = wa::u16x8_extend_low_u8x16(raw);
            let d_hi = wa::u16x8_extend_high_u8x16(raw);
            let o_lo = wa::u16x8_add(s_lo, wa::u16x8_shr(wa::u16x8_mul(d_lo, inv), 8));
            let o_hi = wa::u16x8_add(s_hi, wa::u16x8_shr(wa::u16x8_mul(d_hi, inv), 8));
            wa::v128_store(data.add(p * 4) as *mut wa::v128, wa::u8x16_narrow_i16x8(o_lo, o_hi));
            p += 4;
        }
        let inv32 = 256 - sa;
        let mut i = nvec;
        while i < n {
            over_prem_px(data.add(i * 4), prem, inv32);
            i += 1;
        }
    }

    
    
    
    #[target_feature(enable = "simd128")]
    pub(crate) unsafe fn blend_prem_span(data: *mut u8, prem_px: u32, cova: u32, n: usize) {
        let cov8 = cova & 0xff;
        let a8 = (prem_px >> 24) & 0xff;
        if cov8 == 0 || a8 == 0 {
            return;
        }
        if cov8 == 255 && a8 == 255 {
            store_prem(data, prem_px, n);
            return;
        }
        
        
        let (sa, prem) = if cov8 == 255 {
            (a8, prem_px)
        } else {
            let sa = div255_s(a8 * cov8 + 127);
            if sa == 0 {
                return;
            }
            let s_r = div255_s((prem_px & 0xff) * cov8 + 127);
            let s_g = div255_s(((prem_px >> 8) & 0xff) * cov8 + 127);
            let s_b = div255_s(((prem_px >> 16) & 0xff) * cov8 + 127);
            (sa, s_r | (s_g << 8) | (s_b << 16) | ((sa & 0xff) << 24))
        };
        if sa == 255 {
            store_prem(data, prem, n);
            return;
        }
        if n < 8 {
            let inv32 = 256 - sa;
            let mut i = 0usize;
            while i < n {
                over_prem_px(data.add(i * 4), prem, inv32);
                i += 1;
            }
            return;
        }
        let svec = wa::u32x4_splat(prem);
        let s_lo = wa::u16x8_extend_low_u8x16(svec);
        let s_hi = wa::u16x8_extend_high_u8x16(svec);
        let inv = wa::u16x8_sub(wa::u16x8_splat(256u16), wa::u16x8_splat(sa as u16));
        let nvec = n & !3;
        let mut p = 0usize;
        while p < nvec {
            let raw = wa::v128_load(data.add(p * 4) as *const wa::v128);
            let d_lo = wa::u16x8_extend_low_u8x16(raw);
            let d_hi = wa::u16x8_extend_high_u8x16(raw);
            let o_lo = wa::u16x8_add(s_lo, wa::u16x8_shr(wa::u16x8_mul(d_lo, inv), 8));
            let o_hi = wa::u16x8_add(s_hi, wa::u16x8_shr(wa::u16x8_mul(d_hi, inv), 8));
            wa::v128_store(data.add(p * 4) as *mut wa::v128, wa::u8x16_narrow_i16x8(o_lo, o_hi));
            p += 4;
        }
        let inv32 = 256 - sa;
        let mut i = nvec;
        while i < n {
            over_prem_px(data.add(i * 4), prem, inv32);
            i += 1;
        }
    }
}

#[allow(unused)]
mod fallback {
    #[inline(always)]
    pub(crate) unsafe fn over_prem_px(q: *mut u8, prem: u32, inv: u32) {
        let x = core::ptr::read_unaligned(q as *const u32);
        let lo = (x & 0x00FF_00FF).wrapping_mul(inv) >> 8 & 0x00FF_00FF;
        let hi = ((x >> 8) & 0x00FF_00FF).wrapping_mul(inv) >> 8 & 0x00FF_00FF;
        core::ptr::write_unaligned(q as *mut u32, prem.wrapping_add(lo | (hi << 8)));
    }

        pub unsafe fn solid_grad_span(data: *mut u8, col: u32, cova: u32, n: usize) {
        let cov8 = u32::from(cova as u8);
        let a8 = (col >> 24) & 0xff;
        
        let sa = if a8 == 255 { cov8 } else { ((a8 * cov8) + 127) / 255 };
        if sa == 0 {
            return;
        }
        let s_r = ((((col & 0xff) * sa) + 127) / 255).min(255);
        let s_g = (((((col >> 8) & 0xff) * sa) + 127) / 255).min(255);
        let s_b = (((((col >> 16) & 0xff) * sa) + 127) / 255).min(255);
        if sa == 255 {
            let mut i = 0usize;
            while i < n {
                let p0 = data.add(i * 4);
                *p0 = s_r as u8;
                *p0.add(1) = s_g as u8;
                *p0.add(2) = s_b as u8;
                *p0.add(3) = 255;
                i += 1;
            }
            return;
        }
        let inv32 = 256 - sa;
        let mut i = 0usize;
        while i < n {
            let p0 = data.add(i * 4);
            *p0 = ((s_r + ((u32::from(*p0) * u32::from(inv32)) >> 8)).min(255)) as u8;
            *p0.add(1) = ((s_g + ((u32::from(*p0.add(1)) * u32::from(inv32)) >> 8)).min(255)) as u8;
            *p0.add(2) = ((s_b + ((u32::from(*p0.add(2)) * u32::from(inv32)) >> 8)).min(255)) as u8;
            *p0.add(3) = ((sa + ((u32::from(*p0.add(3)) * u32::from(inv32)) >> 8)).min(255)) as u8;
            i += 1;
        }
    }

    
    
    #[inline]
    pub(crate) unsafe fn solid_span_small(data: *mut u8, col: u32, cova: u32, n: usize) {
        let cov8 = u32::from(cova as u8);
        let a8 = (col >> 24) & 0xff;
        if cov8 == 0 || a8 == 0 {
            return;
        }
        let sa = if a8 == 255 { cov8 } else { ((a8 * cov8) + 127) / 255 };
        let s_r = ((((col & 0xff) * sa) + 127) / 255).min(255);
        let s_g = (((((col >> 8) & 0xff) * sa) + 127) / 255).min(255);
        let s_b = (((((col >> 16) & 0xff) * sa) + 127) / 255).min(255);
        let prem = s_r | (s_g << 8) | (s_b << 16) | ((sa & 0xff) << 24);
        if sa == 255 {
            let mut i = 0usize;
            while i < n {
                core::ptr::write_unaligned(data.add(i * 4) as *mut u32, prem);
                i += 1;
            }
            return;
        }
        let inv32 = 256 - sa;
        let mut i = 0usize;
        while i < n {
            let p0 = data.add(i * 4);
            *p0 = ((s_r + ((u32::from(*p0) * u32::from(inv32)) >> 8)).min(255)) as u8;
            *p0.add(1) = ((s_g + ((u32::from(*p0.add(1)) * u32::from(inv32)) >> 8)).min(255)) as u8;
            *p0.add(2) = ((s_b + ((u32::from(*p0.add(2)) * u32::from(inv32)) >> 8)).min(255)) as u8;
            *p0.add(3) = ((sa + ((u32::from(*p0.add(3)) * u32::from(inv32)) >> 8)).min(255)) as u8;
            i += 1;
        }
    }

    pub(crate) unsafe fn blend_prem_span(data: *mut u8, prem_px: u32, cova: u32, n: usize) {
        let cov8 = cova & 0xff;
        let a8 = (prem_px >> 24) & 0xff;
        if cov8 == 0 || a8 == 0 {
            return;
        }
        let sa = ((a8 * cov8) + 127) / 255;
        if sa == 0 {
            return;
        }
        let s_r = (((prem_px & 0xff) * cov8) + 127) / 255;
        let s_g = ((((prem_px >> 8) & 0xff) * cov8) + 127) / 255;
        let s_b = ((((prem_px >> 16) & 0xff) * cov8) + 127) / 255;
        if sa == 255 {
            let b = [s_r as u8, s_g as u8, s_b as u8, 255u8];
            let mut i = 0usize;
            while i < n {
                let p0 = data.add(i * 4);
                *p0 = b[0];
                *p0.add(1) = b[1];
                *p0.add(2) = b[2];
                *p0.add(3) = b[3];
                i += 1;
            }
            return;
        }
        let prem = s_r | (s_g << 8) | (s_b << 16) | (sa << 24);
        let inv32 = 256 - sa;
        let mut i = 0usize;
        while i < n {
            over_prem_px(data.add(i * 4), prem, inv32);
            i += 1;
        }
    }

    pub(crate) unsafe fn solid_cov_row(data: *mut u8, cov: *const u8, col: u32, n: usize) {
        let a8 = (col >> 24) & 0xff;
        if a8 == 0 {
            return;
        }
        for i in 0..n {
            let cov8 = u32::from(*cov.add(i));
            let sa = ((a8 * cov8) + 127) / 255;
            if sa == 0 {
                continue;
            }
            let s_r = ((((col & 0xff) * sa) + 127) / 255).min(255);
            let s_g = (((((col >> 8) & 0xff) * sa) + 127) / 255).min(255);
            let s_b = (((((col >> 16) & 0xff) * sa) + 127) / 255).min(255);
            let inv = 256 - sa;
            let q = data.add(i * 4);
            *q = ((s_r + ((u32::from(*q) * inv) >> 8)).min(255)) as u8;
            *q.add(1) = ((s_g + ((u32::from(*q.add(1)) * inv) >> 8)).min(255)) as u8;
            *q.add(2) = ((s_b + ((u32::from(*q.add(2)) * inv) >> 8)).min(255)) as u8;
            *q.add(3) = ((sa + ((u32::from(*q.add(3)) * inv) >> 8)).min(255)) as u8;
        }
    }

    pub(crate) unsafe fn paint_solid_row(
        data: *mut u8,
        cov: *const f32,
        cr: f32,
        cg: f32,
        cb: f32,
        ca: f32,
        n: usize,
    ) {
        for i in 0..n {
            let a_cov = *cov.add(i);
            let a = a_cov.clamp(0.0, 1.0);
            let sa = (ca * a).clamp(0.0, 1.0);
            let inv = 1.0 - sa;
            let idx = data.add(i * 4);
            let d0 = *idx as f32 / 255.0;
            let d1 = *idx.add(1) as f32 / 255.0;
            let d2 = *idx.add(2) as f32 / 255.0;
            let d3 = *idx.add(3) as f32 / 255.0;
            *idx = simd_byte(cr * sa + d0 * inv);
            *idx.add(1) = simd_byte(cg * sa + d1 * inv);
            *idx.add(2) = simd_byte(cb * sa + d2 * inv);
            *idx.add(3) = simd_byte(sa + d3 * inv);
        }
    }

    #[inline]
    fn simd_byte(v: f32) -> u8 {
        (v * 255.0 + 0.5).floor().clamp(0.0, 255.0) as u8
    }

    pub(crate) unsafe fn blit_srover(s: *const u8, d: *mut u8, n: usize, op: f64, full: bool) {
        if full {
            for i in (0..n).step_by(4) {
                let mut sa = *s.add(i + 3) as f32 / 255.0;
                if sa <= 0.0 {
                    continue;
                }
                sa *= op as f32;
                let inv = 1.0 - sa as f64;
                *d.add(i) = (*s.add(i) as f64 + *d.add(i) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 1) = (*s.add(i + 1) as f64 + *d.add(i + 1) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 2) = (*s.add(i + 2) as f64 + *d.add(i + 2) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 3) = (*s.add(i + 3) as f64 + *d.add(i + 3) as f64 * inv).round().clamp(0.0, 255.0) as u8;
            }
        } else {
            for i in (0..n).step_by(4) {
                let mut sa = *s.add(i + 3) as f32 / 255.0;
                if sa <= 0.0 {
                    continue;
                }
                sa *= op as f32;
                let inv = 1.0 - sa as f64;
                *d.add(i) = (*s.add(i) as f64 * op + *d.add(i) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 1) = (*s.add(i + 1) as f64 * op + *d.add(i + 1) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 2) = (*s.add(i + 2) as f64 * op + *d.add(i + 2) as f64 * inv).round().clamp(0.0, 255.0) as u8;
                *d.add(i + 3) = (sa as f64 * 255.0 + *d.add(i + 3) as f64 * inv).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    pub(crate) unsafe fn blit_dest_in_u8(f: *const u8, d: *mut u8, n: usize) {
        for i in (0..n).step_by(4) {
            let fa = u32::from(*f.add(i >> 2));
            if fa == 255 {
                continue;
            }
            for c in 0..4 {
                let v = u32::from(*d.add(i + c));
                *d.add(i + c) = (((v * fa) + 127) / 255).min(255) as u8;
            }
        }
    }

    pub(crate) unsafe fn blit_dest_in(s: *const u8, d: *mut u8, n: usize) {
        for i in (0..n).step_by(4) {
            let sa = u32::from(*s.add(i + 3));
            if sa == 255 {
                continue;
            }
            let f = sa;
            for c in 0..4 {
                let v = u32::from(*d.add(i + c));
                *d.add(i + c) = (((v * f) + 127) / 255).min(255) as u8;
            }
        }
    }

    pub(crate) unsafe fn blit_dest_out(s: *const u8, d: *mut u8, n: usize) {
        for i in (0..n).step_by(4) {
            let sa = *s.add(i + 3) as f32 / 255.0;
            let inv = 1.0 - sa;
            let dv = [
                *d.add(i) as f32 / 255.0,
                *d.add(i + 1) as f32 / 255.0,
                *d.add(i + 2) as f32 / 255.0,
                *d.add(i + 3) as f32 / 255.0,
            ];
            *d.add(i) = (dv[0] * inv * 255.0).round().clamp(0.0, 255.0) as u8;
            *d.add(i + 1) = (dv[1] * inv * 255.0).round().clamp(0.0, 255.0) as u8;
            *d.add(i + 2) = (dv[2] * inv * 255.0).round().clamp(0.0, 255.0) as u8;
            *d.add(i + 3) = (dv[3] * inv * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) use simd::{blit_dest_in, blit_dest_in_u8, blit_dest_out, blit_srover, blend_prem_span, grad_lut_cov_span, grad_lut_fill, grad_lut_span, over_prem_px, paint_solid_row, rgrad_lut_cov_span, rgrad_lut_fill, rgrad_lut_span, solid_cov_row, solid_span_small};
#[cfg(target_arch = "wasm32")]
#[doc(hidden)]
pub use simd::{solid_grad_span};

#[cfg(not(target_arch = "wasm32"))]
pub(crate) use fallback::{blit_dest_in, blit_dest_in_u8, blit_dest_out, blit_srover, blend_prem_span, over_prem_px, paint_solid_row, solid_cov_row, solid_span_small};
#[cfg(not(target_arch = "wasm32"))]
#[doc(hidden)]
pub use fallback::{solid_grad_span};
