use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::rast::RgbaF;

pub(crate) const LUT_SIZE: usize = 1024;

#[derive(Clone, PartialEq)]
pub(crate) struct GradStops {
    pub colors: Vec<(f32, [f32; 3])>,
    pub alphas: Vec<(f32, f32)>,
    pub alpha: f32,
}

impl core::fmt::Debug for GradStops {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("GradStops")
            .field("colors", &self.colors.len())
            .field("alphas", &self.alphas.len())
            .field("alpha", &self.alpha)
            .finish()
    }
}

pub(crate) fn stops_key(stops: &GradStops) -> u128 {
    let mut h = crate::cov_cache::Hasher128::new();
    h.mix(stops.colors.len() as u32);
    for (o, c) in &stops.colors {
        h.mix(o.to_bits());
        h.mix(c[0].to_bits());
        h.mix(c[1].to_bits());
        h.mix(c[2].to_bits());
    }
    h.mix(stops.alphas.len() as u32);
    for (o, a) in &stops.alphas {
        h.mix(o.to_bits());
        h.mix(a.to_bits());
    }
    h.mix(stops.alpha.to_bits());
    h.finish()
}

thread_local! {
    static LUTS: RefCell<HashMap<u128, Rc<Vec<[f32; 4]>>>> = RefCell::new(HashMap::new());
    static LUT_PIX: RefCell<HashMap<u128, (Rc<Vec<u32>>, bool)>> = RefCell::new(HashMap::new());
    static POOL_F32: RefCell<Vec<Vec<[f32; 4]>>> = const { RefCell::new(Vec::new()) };
    static POOL_U32: RefCell<Vec<Vec<u32>>> = const { RefCell::new(Vec::new()) };
}

fn take_pooled_u32() -> Vec<u32> {
    let mut v = POOL_U32.with(|p| p.borrow_mut().pop()).unwrap_or_default();
    v.clear();
    v
}

fn take_pooled_f32() -> Vec<[f32; 4]> {
    let mut v = POOL_F32.with(|p| p.borrow_mut().pop()).unwrap_or_default();
    v.clear();
    v
}

fn recycle_u32(v: Vec<u32>) {
    if v.capacity() >= LUT_SIZE {
        POOL_U32.with(|p| {
            let mut p = p.borrow_mut();
            if p.len() < 32 {
                p.push(v);
            }
        });
    }
}

fn recycle_f32(v: Vec<[f32; 4]>) {
    if v.capacity() >= LUT_SIZE {
        POOL_F32.with(|p| {
            let mut p = p.borrow_mut();
            if p.len() < 32 {
                p.push(v);
            }
        });
    }
}

fn color_at(stops: &GradStops, t: f32) -> [f32; 3] {
    let n = stops.colors.len();
    if n == 0 {
        return [1.0, 1.0, 1.0];
    }
    let first = stops.colors[0];
    let last = stops.colors[n - 1];
    if t <= first.0 {
        return first.1;
    }
    if t >= last.0 {
        return last.1;
    }
    let mut out = last.1;
    for i in 1..n {
        let p0 = stops.colors[i - 1];
        let p1 = stops.colors[i];
        if t <= p1.0 {
            let f = if p1.0 > p0.0 { ((t - p0.0) / (p1.0 - p0.0)).clamp(0.0, 1.0) } else { 1.0 };
            out = [
                p0.1[0] + (p1.1[0] - p0.1[0]) * f,
                p0.1[1] + (p1.1[1] - p0.1[1]) * f,
                p0.1[2] + (p1.1[2] - p0.1[2]) * f,
            ];
            break;
        }
    }
    out
}

fn alpha_at(stops: &GradStops, t: f32) -> f32 {
    let n = stops.alphas.len();
    if n == 0 {
        return 1.0;
    }
    let first = stops.alphas[0];
    let last = stops.alphas[n - 1];
    if t <= first.0 {
        return first.1;
    }
    if t > last.0 {
        return last.1;
    }
    let mut out = last.1;
    for i in 1..n {
        let p0 = stops.alphas[i - 1];
        let p1 = stops.alphas[i];
        if t <= p1.0 {
            let f = if p1.0 > p0.0 { ((t - p0.0) / (p1.0 - p0.0)).clamp(0.0, 1.0) } else { 1.0 };
            out = p0.1 + (p1.1 - p0.1) * f;
            break;
        }
    }
    out
}

pub(crate) fn sample_rgba(stops: &GradStops, t: f32) -> RgbaF {
    let c = color_at(stops, t);
    let a = (alpha_at(stops, t) * stops.alpha).clamp(0.0, 1.0);
    RgbaF {
        r: c[0],
        g: c[1],
        b: c[2],
        a,
    }
}

fn build(stops: &GradStops) -> Vec<[f32; 4]> {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::LUT);
    let mut out = take_pooled_f32();
    if colors_sorted(stops) && alphas_sorted(stops) {
        build_merge(stops, &mut out);
    } else {
        build_scan(stops, &mut out);
    }
    out
}

fn build_scan(stops: &GradStops, out: &mut Vec<[f32; 4]>) {
    let scale = (LUT_SIZE - 1) as f32;
    out.clear();
    for i in 0..LUT_SIZE {
        let c = sample_rgba(stops, i as f32 / scale);
        out.push([c.r, c.g, c.b, c.a]);
    }
}

fn build_merge(stops: &GradStops, out: &mut Vec<[f32; 4]>) {
    let scale = (LUT_SIZE - 1) as f32;
    let colors = &stops.colors;
    let alphas = &stops.alphas;
    let n = colors.len();
    let m = alphas.len();
    let mut ci = 0usize;
    let mut ai = 0usize;
    out.clear();
    for i in 0..LUT_SIZE {
        let t = i as f32 / scale;
        let c = if n == 0 {
            [1.0, 1.0, 1.0]
        } else if t <= colors[0].0 {
            colors[0].1
        } else if t >= colors[n - 1].0 {
            colors[n - 1].1
        } else {
            while ci + 2 < n && t > colors[ci + 1].0 {
                ci += 1;
            }
            let p0 = colors[ci];
            let p1 = colors[ci + 1];
            let f = if p1.0 > p0.0 { ((t - p0.0) / (p1.0 - p0.0)).clamp(0.0, 1.0) } else { 1.0 };
            [
                p0.1[0] + (p1.1[0] - p0.1[0]) * f,
                p0.1[1] + (p1.1[1] - p0.1[1]) * f,
                p0.1[2] + (p1.1[2] - p0.1[2]) * f,
            ]
        };
        let a = if m == 0 {
            1.0
        } else if t <= alphas[0].0 {
            alphas[0].1
        } else if t > alphas[m - 1].0 {
            alphas[m - 1].1
        } else {
            while ai + 2 < m && t > alphas[ai + 1].0 {
                ai += 1;
            }
            let p0 = alphas[ai];
            let p1 = alphas[ai + 1];
            let f = if p1.0 > p0.0 { ((t - p0.0) / (p1.0 - p0.0)).clamp(0.0, 1.0) } else { 1.0 };
            p0.1 + (p1.1 - p0.1) * f
        };
        let a = (a * stops.alpha).clamp(0.0, 1.0);
        out.push([c[0], c[1], c[2], a]);
    }
}

pub(crate) fn lut_of(stops: &GradStops) -> Rc<Vec<[f32; 4]>> {
    let key = stops_key(stops);
    LUTS.with(|slot| {
        let mut luts = slot.borrow_mut();
        if let Some(l) = luts.get(&key) {
            return l.clone();
        }
        if luts.len() >= 256 {
            luts.drain().for_each(|(_, l)| {
                if let Ok(v) = Rc::try_unwrap(l) {
                    recycle_f32(v);
                }
            });
        }
        let l = Rc::new(build(stops));
        luts.insert(key, l.clone());
        l
    })
}

pub(crate) fn lut_opaque_of(stops: &GradStops) -> bool {
    lut_pix_and_opaque(stops).1
}

#[inline]
pub(crate) fn lut_index(t: f32) -> usize {
    let idx = (t.clamp(0.0, 1.0) * (LUT_SIZE - 1) as f32 + 0.5) as usize;
    idx.min(LUT_SIZE - 1)
}

fn pack_u8(c: RgbaF) -> u32 {
    let r = (c.r * 255.0 + 0.5) as u8;
    let g = (c.g * 255.0 + 0.5) as u8;
    let b = (c.b * 255.0 + 0.5) as u8;
    let a = (c.a * 255.0 + 0.5) as u8;
    u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16 | u32::from(a) << 24
}

pub(crate) fn solid_col_u32(c: &crate::rast::RgbaF) -> u32 {
    pack_u8(*c)
}

fn colors_sorted(stops: &GradStops) -> bool {
    let mut last = f32::NEG_INFINITY;
    for (o, _) in &stops.colors {
        if *o < last {
            return false;
        }
        last = *o;
    }
    true
}

fn alphas_sorted(stops: &GradStops) -> bool {
    let mut last = f32::NEG_INFINITY;
    for (o, _) in &stops.alphas {
        if *o < last {
            return false;
        }
        last = *o;
    }
    true
}

fn build_pix(stops: &GradStops) -> Vec<u32> {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::LUT);
    let mut out = take_pooled_u32();
    if colors_sorted(stops) && alphas_sorted(stops) {
        build_pix_merge(stops, &mut out);
    } else {
        build_pix_scan(stops, &mut out);
    }
    out
}

fn build_pix_scan(stops: &GradStops, out: &mut Vec<u32>) {
    let scale = (LUT_SIZE - 1) as f32;
    out.clear();
    for i in 0..LUT_SIZE {
        let t = i as f32 / scale;
        let c = color_at(stops, t);
        let a = (alpha_at(stops, t) * stops.alpha).clamp(0.0, 1.0);
        let pa = (a * 255.0 + 0.5) as u32;
        let pr = (c[0].clamp(0.0, 1.0) * a * 255.0 + 0.5) as u32;
        let pg = (c[1].clamp(0.0, 1.0) * a * 255.0 + 0.5) as u32;
        let pb = (c[2].clamp(0.0, 1.0) * a * 255.0 + 0.5) as u32;
        out.push(pr | (pg << 8) | (pb << 16) | (pa << 24));
    }
}

#[cfg(target_arch = "wasm32")]
fn build_pix_merge(stops: &GradStops, out: &mut Vec<u32>) {
    use core::arch::wasm32::*;
    let colors = &stops.colors;
    let alphas = &stops.alphas;
    let n = colors.len();
    let m = alphas.len();
    let scale = (LUT_SIZE - 1) as f32;
    if n == 0 || m == 0 {
        build_pix_scan(stops, out);
        return;
    }
    out.clear();
    out.resize(LUT_SIZE, 0u32);
    let mut cb: Vec<usize> = Vec::with_capacity(n);
    for k in 0..n {
        let o = colors[k].0;
        let mut i = if k > 0 { *cb.last().unwrap() } else { 0 };
        while i < LUT_SIZE && (i as f32 / scale) <= o {
            i += 1;
        }
        cb.push(i);
    }
    let g2c = {
        let o = colors[n - 1].0;
        let mut i = 0usize;
        while i < LUT_SIZE && (i as f32 / scale) < o {
            i += 1;
        }
        i
    };
    let mut ab: Vec<usize> = Vec::with_capacity(m);
    for k in 0..m {
        let o = alphas[k].0;
        let mut i = if k > 0 { *ab.last().unwrap() } else { 0 };
        while i < LUT_SIZE && (i as f32 / scale) <= o {
            i += 1;
        }
        ab.push(i);
    }
    SCR_R.with(|r0| {
        let mut sr = r0.borrow_mut();
        sr.clear();
        sr.resize(LUT_SIZE, 0.0);
        SG.with(|g0| {
            let mut sg = g0.borrow_mut();
            sg.clear();
            sg.resize(LUT_SIZE, 0.0);
            SB.with(|b0| {
                let mut sb = b0.borrow_mut();
                sb.clear();
                sb.resize(LUT_SIZE, 0.0);
                SA.with(|a0| {
                    let mut sa = a0.borrow_mut();
                    sa.clear();
                    sa.resize(LUT_SIZE, 0.0);
                    fill_col_const(&mut *sr, &mut *sg, &mut *sb, 0, cb[0], colors[0].1);
                    for k in 0..n - 1 {
                        let lo = cb[k];
                        let hi = if k == n - 2 { g2c } else { cb[k + 1].min(g2c) };
                        fill_grad_seg(colors, k, lo, hi, &mut *sr, &mut *sg, &mut *sb, scale);
                    }
                    fill_col_const(&mut *sr, &mut *sg, &mut *sb, g2c.max(cb[0]), LUT_SIZE, colors[n - 1].1);
                    fill_val_const(&mut *sa, 0, ab[0], alphas[0].1);
                    for k in 0..m - 1 {
                        let lo = ab[k];
                        let hi = if k == m - 2 { ab[m - 1] } else { ab[k + 1].min(ab[m - 1]) };
                        fill_alpha_seg(alphas, k, lo, hi, &mut *sa, scale);
                    }
                    fill_val_const(&mut *sa, ab[m - 1], LUT_SIZE, alphas[m - 1].1);
                    let salpha = f32x4_splat(stops.alpha);
                    let zero4 = f32x4_splat(0.0);
                    let one4 = f32x4_splat(1.0);
                    let half4 = f32x4_splat(0.5);
                    let c255 = f32x4_splat(255.0);
                    let mut i = 0usize;
                    while i < LUT_SIZE {
                        let (r, g, b, av) = unsafe {
                            (
                                v128_load(sr.as_ptr().add(i) as *const v128),
                                v128_load(sg.as_ptr().add(i) as *const v128),
                                v128_load(sb.as_ptr().add(i) as *const v128),
                                v128_load(sa.as_ptr().add(i) as *const v128),
                            )
                        };
                        let a1 = f32x4_mul(av, salpha);
                        let a2 = v128_bitselect(zero4, a1, f32x4_lt(a1, zero4));
                        let a = v128_bitselect(one4, a2, f32x4_gt(a2, one4));
                        let pa = f32x4_add(f32x4_mul(a, c255), half4);
                        let rc = clamp01v(r);
                        let gc = clamp01v(g);
                        let bc = clamp01v(b);
                        let pr = f32x4_add(f32x4_mul(f32x4_mul(rc, a), c255), half4);
                        let pg = f32x4_add(f32x4_mul(f32x4_mul(gc, a), c255), half4);
                        let pb = f32x4_add(f32x4_mul(f32x4_mul(bc, a), c255), half4);
                        let pi = i32x4_trunc_sat_f32x4(pr);
                        let gi = i32x4_trunc_sat_f32x4(pg);
                        let bi = i32x4_trunc_sat_f32x4(pb);
                        let ai = i32x4_trunc_sat_f32x4(pa);
                        let px = v128_or(
                            v128_or(pi, i32x4_shl(gi, 8)),
                            v128_or(i32x4_shl(bi, 16), i32x4_shl(ai, 24)),
                        );
                        unsafe {
                            v128_store(out.as_mut_ptr().add(i) as *mut v128, px);
                        }
                        i += 4;
                    }
                });
            });
        });
    });
}

#[cfg(target_arch = "wasm32")]
fn clamp01v(x: core::arch::wasm32::v128) -> core::arch::wasm32::v128 {
    use core::arch::wasm32::*;
    let zero = f32x4_splat(0.0);
    let one = f32x4_splat(1.0);
    let a = v128_bitselect(zero, x, f32x4_lt(x, zero));
    v128_bitselect(one, a, f32x4_gt(a, one))
}

#[cfg(target_arch = "wasm32")]
fn fill_col_const(
    sr: &mut Vec<f32>,
    sg: &mut Vec<f32>,
    sb: &mut Vec<f32>,
    lo: usize,
    hi: usize,
    c: [f32; 3],
) {
    use core::arch::wasm32::*;
    if lo >= hi {
        return;
    }
    let r = f32x4_splat(c[0]);
    let g = f32x4_splat(c[1]);
    let b = f32x4_splat(c[2]);
    let vend = lo + (hi - lo) / 4 * 4;
    let mut i = lo;
    while i < vend {
        unsafe {
            v128_store(sr.as_mut_ptr().add(i) as *mut v128, r);
            v128_store(sg.as_mut_ptr().add(i) as *mut v128, g);
            v128_store(sb.as_mut_ptr().add(i) as *mut v128, b);
        }
        i += 4;
    }
    let mut j = vend;
    while j < hi {
        sr[j] = c[0];
        sg[j] = c[1];
        sb[j] = c[2];
        j += 1;
    }
}

#[cfg(target_arch = "wasm32")]
fn fill_val_const(sa: &mut Vec<f32>, lo: usize, hi: usize, v: f32) {
    use core::arch::wasm32::*;
    if lo >= hi {
        return;
    }
    let vv = f32x4_splat(v);
    let vend = lo + (hi - lo) / 4 * 4;
    let mut i = lo;
    while i < vend {
        unsafe {
            v128_store(sa.as_mut_ptr().add(i) as *mut v128, vv);
        }
        i += 4;
    }
    let mut j = vend;
    while j < hi {
        sa[j] = v;
        j += 1;
    }
}

#[cfg(target_arch = "wasm32")]
fn fill_grad_seg(
    colors: &[(f32, [f32; 3])],
    k: usize,
    lo: usize,
    hi: usize,
    sr: &mut Vec<f32>,
    sg: &mut Vec<f32>,
    sb: &mut Vec<f32>,
    scale: f32,
) {
    use core::arch::wasm32::*;
    if lo >= hi {
        return;
    }
    let p0 = colors[k].1;
    let p1 = colors[k + 1].1;
    let o0 = colors[k].0;
    let o1 = colors[k + 1].0;
    let d0 = p1[0] - p0[0];
    let d1 = p1[1] - p0[1];
    let d2 = p1[2] - p0[2];
    let v0 = f32x4_splat(p0[0]);
    let v1 = f32x4_splat(p0[1]);
    let v2 = f32x4_splat(p0[2]);
    let w0 = f32x4_splat(d0);
    let w1 = f32x4_splat(d1);
    let w2 = f32x4_splat(d2);
    let oo = f32x4_splat(o0);
    let dd = f32x4_splat(o1 - o0);
    let zero = f32x4_splat(0.0);
    let one = f32x4_splat(1.0);
    let vend = lo + (hi - lo) / 4 * 4;
    let mut i = lo;
    while i < vend {
        let t = f32x4(
            i as f32 / scale,
            (i + 1) as f32 / scale,
            (i + 2) as f32 / scale,
            (i + 3) as f32 / scale,
        );
        unsafe {
            let mut f = f32x4_div(f32x4_sub(t, oo), dd);
            f = v128_bitselect(zero, f, f32x4_lt(f, zero));
            f = v128_bitselect(one, f, f32x4_gt(f, one));
            v128_store(sr.as_mut_ptr().add(i) as *mut v128, f32x4_add(v0, f32x4_mul(w0, f)));
            v128_store(sg.as_mut_ptr().add(i) as *mut v128, f32x4_add(v1, f32x4_mul(w1, f)));
            v128_store(sb.as_mut_ptr().add(i) as *mut v128, f32x4_add(v2, f32x4_mul(w2, f)));
        }
        i += 4;
    }
    let mut j = vend;
    while j < hi {
        let t = j as f32 / scale;
        let f = ((t - o0) / (o1 - o0)).clamp(0.0, 1.0);
        sr[j] = p0[0] + d0 * f;
        sg[j] = p0[1] + d1 * f;
        sb[j] = p0[2] + d2 * f;
        j += 1;
    }
}

#[cfg(target_arch = "wasm32")]
fn fill_alpha_seg(
    alphas: &[(f32, f32)],
    k: usize,
    lo: usize,
    hi: usize,
    sa: &mut Vec<f32>,
    scale: f32,
) {
    use core::arch::wasm32::*;
    if lo >= hi {
        return;
    }
    let p0 = alphas[k].1;
    let p1 = alphas[k + 1].1;
    let o0 = alphas[k].0;
    let o1 = alphas[k + 1].0;
    let d = p1 - p0;
    let v0 = f32x4_splat(p0);
    let w0 = f32x4_splat(d);
    let oo = f32x4_splat(o0);
    let dd = f32x4_splat(o1 - o0);
    let zero = f32x4_splat(0.0);
    let one = f32x4_splat(1.0);
    let vend = lo + (hi - lo) / 4 * 4;
    let mut i = lo;
    while i < vend {
        let t = f32x4(
            i as f32 / scale,
            (i + 1) as f32 / scale,
            (i + 2) as f32 / scale,
            (i + 3) as f32 / scale,
        );
        unsafe {
            let mut f = f32x4_div(f32x4_sub(t, oo), dd);
            f = v128_bitselect(zero, f, f32x4_lt(f, zero));
            f = v128_bitselect(one, f, f32x4_gt(f, one));
            v128_store(sa.as_mut_ptr().add(i) as *mut v128, f32x4_add(v0, f32x4_mul(w0, f)));
        }
        i += 4;
    }
    let mut j = vend;
    while j < hi {
        let t = j as f32 / scale;
        let f = ((t - o0) / (o1 - o0)).clamp(0.0, 1.0);
        sa[j] = p0 + d * f;
        j += 1;
    }
}

thread_local! {
    static SCR_R: core::cell::RefCell<Vec<f32>> = const { core::cell::RefCell::new(Vec::new()) };
    static SG: core::cell::RefCell<Vec<f32>> = const { core::cell::RefCell::new(Vec::new()) };
    static SB: core::cell::RefCell<Vec<f32>> = const { core::cell::RefCell::new(Vec::new()) };
    static SA: core::cell::RefCell<Vec<f32>> = const { core::cell::RefCell::new(Vec::new()) };
}

#[cfg(not(target_arch = "wasm32"))]
fn build_pix_merge(stops: &GradStops, out: &mut Vec<u32>) {
    let scale = (LUT_SIZE - 1) as f32;
    let colors = &stops.colors;
    let alphas = &stops.alphas;
    let n = colors.len();
    let m = alphas.len();
    let mut ci = 0usize;
    let mut ai = 0usize;
    out.clear();
    for i in 0..LUT_SIZE {
        let t = i as f32 / scale;
        let c = if n == 0 {
            [1.0, 1.0, 1.0]
        } else if t <= colors[0].0 {
            colors[0].1
        } else if t >= colors[n - 1].0 {
            colors[n - 1].1
        } else {
            while ci + 2 < n && t > colors[ci + 1].0 {
                ci += 1;
            }
            let p0 = colors[ci];
            let p1 = colors[ci + 1];
            let f = if p1.0 > p0.0 { ((t - p0.0) / (p1.0 - p0.0)).clamp(0.0, 1.0) } else { 1.0 };
            [
                p0.1[0] + (p1.1[0] - p0.1[0]) * f,
                p0.1[1] + (p1.1[1] - p0.1[1]) * f,
                p0.1[2] + (p1.1[2] - p0.1[2]) * f,
            ]
        };
        let a = if m == 0 {
            1.0
        } else if t <= alphas[0].0 {
            alphas[0].1
        } else if t > alphas[m - 1].0 {
            alphas[m - 1].1
        } else {
            while ai + 2 < m && t > alphas[ai + 1].0 {
                ai += 1;
            }
            let p0 = alphas[ai];
            let p1 = alphas[ai + 1];
            let f = if p1.0 > p0.0 { ((t - p0.0) / (p1.0 - p0.0)).clamp(0.0, 1.0) } else { 1.0 };
            p0.1 + (p1.1 - p0.1) * f
        };
        let a = (a * stops.alpha).clamp(0.0, 1.0);
        let pa = (a * 255.0 + 0.5) as u32;
        let pr = (c[0].clamp(0.0, 1.0) * a * 255.0 + 0.5) as u32;
        let pg = (c[1].clamp(0.0, 1.0) * a * 255.0 + 0.5) as u32;
        let pb = (c[2].clamp(0.0, 1.0) * a * 255.0 + 0.5) as u32;
        out.push(pr | (pg << 8) | (pb << 16) | (pa << 24));
    }
}

pub(crate) fn lut_pix_of(stops: &GradStops) -> Rc<Vec<u32>> {
    lut_pix_and_opaque(stops).0
}

pub(crate) fn lut_pix_and_opaque(stops: &GradStops) -> (Rc<Vec<u32>>, bool) {
    let key = stops_key(stops);
    LUT_PIX.with(|slot| {
        let mut luts = slot.borrow_mut();
        if let Some((l, o)) = luts.get(&key) {
            return (l.clone(), *o);
        }
        if luts.len() >= 256 {
            luts.drain().for_each(|(_, (l, _))| {
                if let Ok(v) = Rc::try_unwrap(l) {
                    recycle_u32(v);
                }
            });
        }
        let l = Rc::new(build_pix(stops));
        let o = l.iter().all(|&p| (p >> 24) == 255);
        luts.insert(key, (l.clone(), o));
        (l, o)
    })
}

#[inline]
pub(crate) fn lut_at(lut: &[[f32; 4]], t: f32) -> [f32; 4] {
    lut[lut_index(t)]
}
