





use crate::rast;
use crate::rast::{Blend, PaintStyle, PixBuf, RgbaF};
use crate::bezier::{bezier_length, bezier_split, bezier_t_at_length, CubicBezierSeg};
use crate::prof;
use crate::types::*;

use crate::json::Value as JsonValue;
use std::cell::RefCell;
use std::borrow::Cow;
use std::rc::Rc;

pub const EPS: f64 = 0.000001;
const DASH_TOLERANCE: f64 = 0.1;
const DASH_ITER_CAP: u32 = 10000;
const STAR_POINTS_CAP: f64 = 10000.0;
const SQRT_2: f64 = std::f64::consts::SQRT_2;
const MAX_PARENT_DEPTH: usize = 64;

const REPEATER_DRAW_BUDGET: usize = 200000;

#[inline]
fn veq(a: f64, b: f64) -> bool {
    (a - b).abs() < EPS
}
#[inline]
fn vzero(a: f64) -> bool {
    a.abs() <= EPS
}
#[inline]
fn clamp01(v: f64) -> f64 {
    if v < 0.0 {
        0.0
    } else if v > 1.0 {
        1.0
    } else {
        v
    }
}





pub fn prop_json(prop: Option<&ParsedProperty>, frame: f64) -> JsonValue {
    prop_json_ref(prop, frame).into_owned()
}



#[inline]
pub fn prop_json_ref<'a>(prop: Option<&'a ParsedProperty>, frame: f64) -> Cow<'a, JsonValue> {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::PROP);
    let t0 = prof::now();
    let out = match prop {
        Some(p) => crate::keyframes::interpolate_keyframes_cow(p, frame),
        None => Cow::Owned(JsonValue::Null),
    };
    prof::add(prof::INTERP, t0);
    out
}

pub fn prop_num(prop: Option<&ParsedProperty>, frame: f64, def: f64) -> f64 {
    if let Some(p) = prop {
        if p.keyframes.is_none()
            && p.x.is_none()
            && p.y.is_none()
            && p.override_value.is_none()
            && !p.animated
        {
            match &p.value {
                JsonValue::Number(n) => {
                    return if n.is_finite() { *n } else { def };
                }
                JsonValue::Nums(n) => {
                    if let Some(x) = n.first() {
                        return if x.is_finite() { x } else { def };
                    }
                }
                JsonValue::Array(a) => {
                    if let Some(JsonValue::Number(n)) = a.first() {
                        return if n.is_finite() { *n } else { def };
                    }
                }
                _ => {}
            }
        }
        if let Some(n) = crate::keyframes::interp_num(p, frame) {
            return if n.is_finite() { n } else { def };
        }
    }
    let v = prop_json_ref(prop, frame);
    match v.as_ref() {
        JsonValue::Number(n) => *n,
        JsonValue::Nums(n) => n.first().unwrap_or(def),
        JsonValue::Array(a) => a.first().and_then(|x| x.as_f64()).unwrap_or(def),
        other => {
            let n = js_f64(other);
            if n.is_finite() {
                n
            } else {
                def
            }
        }
    }
}

fn js_f64(v: &JsonValue) -> f64 {
    match v {
        JsonValue::Number(n) => *n,
        JsonValue::String(s) => s.parse::<f64>().unwrap_or(f64::NAN),
        JsonValue::Nums(n) => n.first().unwrap_or(f64::NAN),
        JsonValue::Array(a) => a.first().and_then(|x| x.as_f64()).unwrap_or(f64::NAN),
        _ => f64::NAN,
    }
}

pub fn prop_arr(prop: Option<&ParsedProperty>, frame: f64, def: &[f64]) -> Vec<f64> {
    if let Some(p) = prop {
        if p.keyframes.is_none()
            && p.x.is_none()
            && p.y.is_none()
            && p.override_value.is_none()
            && !p.animated
        {
            if let Some(out) = nums_vec(&p.value) {
                if !out.is_empty() && out.iter().all(|x| x.is_finite()) {
                    return out;
                }
            }
        }
    }
    let v = prop_json_ref(prop, frame);
    if let Some(out) = nums_vec(&v) {
        if out.iter().all(|x| x.is_finite()) {
            return out;
        }
    }
    def.to_vec()
}

fn nums_vec(v: &JsonValue) -> Option<Vec<f64>> {
    match v {
        JsonValue::Array(a) => Some(a.iter().map(js_f64).collect()),
        JsonValue::Nums(n) => Some(n.iter().collect()),
        _ => None,
    }
}




#[inline]
fn arr_pair(a: &[JsonValue], def: [f64; 2]) -> Option<[f64; 2]> {
    if a.is_empty() {
        return None;
    }
    let mut out = def;
    for (i, v) in a.iter().enumerate().take(2) {
        let f = js_f64(v);
        if !f.is_finite() {
            return None;
        }
        out[i] = f;
    }
    for v in a.iter().skip(2) {
        if !js_f64(v).is_finite() {
            return None;
        }
    }
    Some(out)
}

fn arr_pair_val(v: &JsonValue, def: [f64; 2]) -> Option<[f64; 2]> {
    match v {
        JsonValue::Array(a) => arr_pair(a, def),
        JsonValue::Nums(n) => {
            if n.is_empty() {
                return None;
            }
            let mut out = def;
            for (i, x) in n.iter().enumerate().take(2) {
                if !x.is_finite() {
                    return None;
                }
                out[i] = x;
            }
            Some(out)
        }
        _ => None,
    }
}

#[inline]
fn prop_pair(prop: Option<&ParsedProperty>, frame: f64, def: [f64; 2]) -> [f64; 2] {
    if let Some(p) = prop {
        if p.keyframes.is_none()
            && p.x.is_none()
            && p.y.is_none()
            && p.override_value.is_none()
            && !p.animated
        {
            if let Some(v) = arr_pair_val(&p.value, def) {
                return v;
            }
        }
    }
    let v = prop_json_ref(prop, frame);
    if let Some(v) = arr_pair_val(v.as_ref(), def) {
        return v;
    }
    def
}





pub type Mat3 = [f64; 6];

pub const fn mat_identity() -> Mat3 {
    [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
}

pub fn mat_translate(x: f64, y: f64) -> Mat3 {
    [1.0, 0.0, 0.0, 1.0, x, y]
}

pub fn mat_scale(sx: f64, sy: f64) -> Mat3 {
    [sx, 0.0, 0.0, sy, 0.0, 0.0]
}

pub fn mat_rotate(deg: f64) -> Mat3 {
    let r = deg * std::f64::consts::PI / 180.0;
    let (s, c) = r.sin_cos();
    [c, s, -s, c, 0.0, 0.0]
}

pub fn mat_mul(m1: Mat3, m2: Mat3) -> Mat3 {
    [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ]
}

pub fn mat_apply(m: Mat3, x: f64, y: f64) -> (f64, f64) {
    (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
}

pub fn mat_scale_of(m: Mat3) -> f64 {
    let (p1x, p1y) = mat_apply(m, 0.0, 0.0);
    let (p2x, p2y) = mat_apply(m, SQRT_2, SQRT_2);
    let dx = p2x - p1x;
    let dy = p2y - p1y;
    ((dx * dx + dy * dy).sqrt()) / 2.0
}

pub fn seg_len_rlottie(dx: f64, dy: f64) -> f64 {
    let (ax, ay) = (dx.abs(), dy.abs());
    if ax > ay {
        ax + 0.375 * ay
    } else {
        ay + 0.375 * ax
    }
}

fn position_angle(prop: Option<&ParsedProperty>, frame: f64) -> f64 {
    let p = match prop {
        Some(p) if p.animated && p.keyframes.as_ref().map_or(false, |k| !k.is_empty()) => p,
        _ => return 0.0,
    };
    let kfs = p.keyframes.as_ref().unwrap();
    let first = &kfs[0];
    let last = kfs.last().unwrap();
    if frame <= first.t {
        return 0.0;
    }
    let last_end = last.end_frame.unwrap_or(last.t);
    if frame >= last_end {
        return 0.0;
    }
    let mut lo: isize = 0;
    let mut hi: isize = kfs.len() as isize - 1;
    while lo <= hi {
        let mid = (lo + hi) >> 1;
        let kf = &kfs[mid as usize];
        let end = kf.end_frame.unwrap_or_else(|| kfs.get(mid as usize + 1).map_or(kf.t, |n| n.t));
        if frame < kf.t {
            hi = mid - 1;
        } else if frame >= end {
            lo = mid + 1;
        } else {
            let (to, ti) = match (&kf.to, &kf.ti) {
                (Some(to), Some(ti)) => (to, ti),
                _ => return 0.0,
            };
            let (sv, ev) = match (num_pair2(&kf.s), crate::keyframes::keyframe_end(kfs, mid as usize).and_then(num_pair2)) {
                (Some(sv), Some(ev)) => (sv, ev),
                _ => return 0.0,
            };
            let duration = (end - kf.t).max(1e-6);
            let mut progress = clamp01((frame - kf.t) / duration);
            if let Some(curve) = kf.easing_curve.as_deref() {
                progress = curve.value(progress);
            } else if kf.o.is_some() || kf.i.is_some() {
                if let Some(e) = crate::easing::build_easing(kf.o.as_ref(), kf.i.as_ref()) {
                    progress = crate::easing::easing_value(e, progress);
                }
            }
            let seg = CubicBezierSeg {
                p0: [sv[0], sv[1]],
                p1: [sv[0] + to.get(0).copied().unwrap_or(0.0), sv[1] + to.get(1).copied().unwrap_or(0.0)],
                p2: [ev[0] + ti.get(0).copied().unwrap_or(0.0), ev[1] + ti.get(1).copied().unwrap_or(0.0)],
                p3: [ev[0], ev[1]],
            };
            let len = bezier_length(&seg);
            if len < 1e-6 {
                return 0.0;
            }
            let t = bezier_t_at_length(&seg, progress * len, len);
            let mt = 1.0 - t;
            let d = t * t;
            let a = -mt * mt;
            let b = 1.0 - 4.0 * t + 3.0 * d;
            let c = 2.0 * t - 3.0 * d;
            let dx = a * seg.p0[0] + b * seg.p1[0] + c * seg.p2[0] + d * seg.p3[0];
            let dy = a * seg.p0[1] + b * seg.p1[1] + c * seg.p2[1] + d * seg.p3[1];
            return dy.atan2(dx) * (180.0 / std::f64::consts::PI);
        }
    }
    0.0
}

fn num_pair2(v: &JsonValue) -> Option<[f64; 2]> {
    match v {
        JsonValue::Nums(n) => Some([n.get(0)?, n.get(1)?]),
        JsonValue::Array(a) => Some([js_f64(a.get(0)?), js_f64(a.get(1)?)]),
        _ => None,
    }
}

pub fn mat_from_transform(tr: Option<&ParsedTransform>, frame: f64, auto_orient: bool) -> Mat3 {
    match tr {
        Some(t) => mat_from_parts(
            t.position.as_ref(),
            t.rotation.as_ref(),
            t.scale.as_ref(),
            t.anchor.as_ref(),
            t.skew.as_ref(),
            t.skew_axis.as_ref(),
            frame,
            auto_orient,
        ),
        None => mat_from_parts(None, None, None, None, None, None, frame, auto_orient),
    }
}

#[allow(clippy::too_many_arguments)]
fn mat_from_parts(
    position: Option<&ParsedProperty>,
    rotation: Option<&ParsedProperty>,
    scale: Option<&ParsedProperty>,
    anchor: Option<&ParsedProperty>,
    skew: Option<&ParsedProperty>,
    skew_axis: Option<&ParsedProperty>,
    frame: f64,
    auto_orient: bool,
) -> Mat3 {
    let pos = prop_pair(position, frame, [0.0, 0.0]);
    let mut rot = prop_num(rotation, frame, 0.0);
    if auto_orient {
        rot += position_angle(position, frame);
    }
    let sc = prop_pair(scale, frame, [100.0, 100.0]);
    let sx = sc[0];
    let sy = sc[1];
    let anc = prop_pair(anchor, frame, [0.0, 0.0]);
    let mut m = mat_translate(pos[0], pos[1]);
    m = mat_mul(m, mat_rotate(rot));
    let skew_v = prop_num(skew, frame, 0.0);
    if !vzero(skew_v) {
        let axis = prop_num(skew_axis, frame, 0.0) * std::f64::consts::PI / 180.0;
        let tan = (skew_v * std::f64::consts::PI / 180.0).tan();
        let c = axis.cos();
        let s = axis.sin();
        let shear: Mat3 = [1.0 - tan * s * c, -tan * s * s, tan * c * c, 1.0 + tan * s * c, 0.0, 0.0];
        m = mat_mul(m, shear);
    }
    m = mat_mul(m, mat_scale(sx / 100.0, sy / 100.0));
    m = mat_mul(m, mat_translate(-anc[0], -anc[1]));
    m
}



fn mat_from_shape_transform(shape: &ParsedShape, frame: f64) -> Mat3 {
    mat_from_parts(
        shape.position.as_ref(),
        shape.rotation.as_ref(),
        shape.scale.as_ref(),
        shape.anchor.as_ref(),
        None,
        None,
        frame,
        false,
    )
}





#[derive(Clone, Debug, PartialEq)]
pub enum Pc {
    M([f64; 2]),
    L([f64; 2]),
    C([f64; 6]),
    Z,
}

pub type PathCmds = Vec<Pc>;

#[derive(Clone, Debug)]
pub struct Vert {
    pub v: [f64; 2],
    pub i: [f64; 2],
    pub o: [f64; 2],
}

pub struct Contour {
    pub verts: Vec<Vert>,
    pub closed: bool,
}

fn verts_to_cmds(verts: &[Vert], closed: bool) -> PathCmds {
    if verts.is_empty() {
        return Vec::new();
    }
    let mut cmds: PathCmds = Vec::with_capacity(verts.len() * 2 + 2);
    for (idx, v) in verts.iter().enumerate() {
        if idx == 0 {
            cmds.push(Pc::M(v.v));
        } else {
            let prev = &verts[idx - 1];
            cmds.push(Pc::C([
                prev.v[0] + prev.o[0],
                prev.v[1] + prev.o[1],
                v.v[0] + v.i[0],
                v.v[1] + v.i[1],
                v.v[0],
                v.v[1],
            ]));
        }
    }
    if closed && !verts.is_empty() && verts.len() > 1 {
        let first = &verts[0];
        let last = &verts[verts.len() - 1];
        cmds.push(Pc::C([
            last.v[0] + last.o[0],
            last.v[1] + last.o[1],
            first.v[0] + first.i[0],
            first.v[1] + first.i[1],
            first.v[0],
            first.v[1],
        ]));
        cmds.push(Pc::Z);
    }
    cmds
}



const BEZIER_MAGIC: f64 = 0.5522847498;

fn rect_to_verts(p: &[f64], s: &[f64], r: f64) -> Vec<Vert> {
    let (cx, cy) = (p[0], p[1]);
    let w = s[0] / 2.0;
    let h = s[1] / 2.0;
    let cr = r.clamp(0.0, w.min(h));
    let (left, right, top, bottom) = (cx - w, cx + w, cy - h, cy + h);
    let mk = |v: [f64; 2], i: [f64; 2], o: [f64; 2]| Vert { v, i, o };
    if cr <= 0.0 {
        return vec![
            mk([right, top], [0.0; 2], [0.0; 2]),
            mk([right, bottom], [0.0; 2], [0.0; 2]),
            mk([left, bottom], [0.0; 2], [0.0; 2]),
            mk([left, top], [0.0; 2], [0.0; 2]),
        ];
    }
    let k = cr * BEZIER_MAGIC;
    vec![
        mk([right, top + cr], [0.0, -k], [0.0, k]),
        mk([right, bottom - cr], [0.0, -k], [0.0, k]),
        mk([right - cr, bottom], [k, 0.0], [-k, 0.0]),
        mk([left + cr, bottom], [-k, 0.0], [-k, 0.0]),
        mk([left, bottom - cr], [0.0, k], [0.0, -k]),
        mk([left, top + cr], [0.0, k], [0.0, -k]),
        mk([left + cr, top], [-k, 0.0], [k, 0.0]),
        mk([right - cr, top], [k, 0.0], [k, 0.0]),
    ]
}

fn ellipse_to_verts(p: &[f64], s: &[f64]) -> Vec<Vert> {
    let (cx, cy) = (p[0], p[1]);
    let rx = s[0] / 2.0;
    let ry = s[1] / 2.0;
    let kx = rx * BEZIER_MAGIC;
    let ky = ry * BEZIER_MAGIC;
    vec![
        Vert { v: [cx, cy - ry], i: [-kx, 0.0], o: [kx, 0.0] },
        Vert { v: [cx + rx, cy], i: [0.0, -ky], o: [0.0, ky] },
        Vert { v: [cx, cy + ry], i: [kx, 0.0], o: [-kx, 0.0] },
        Vert { v: [cx - rx, cy], i: [0.0, ky], o: [0.0, -ky] },
    ]
}

fn reverse_verts(verts: &[Vert]) -> Vec<Vert> {
    verts
        .iter()
        .rev()
        .map(|v| Vert { v: v.v, i: v.o, o: v.i })
        .collect()
}

fn star_to_verts(shape: &ParsedShape, frame: f64) -> Vec<Vert> {
    let raw_points = prop_num(shape.points.as_ref(), frame, 5.0);
    if !raw_points.is_finite() || raw_points <= 0.0 {
        return Vec::new();
    }
    let points = raw_points.min(STAR_POINTS_CAP);
    let inner_r = prop_num(shape.inner_radius.as_ref(), frame, 0.0);
    let outer_r = prop_num(shape.outer_radius.as_ref(), frame, 0.0);
    let inner_round = prop_num(shape.inner_roundness.as_ref(), frame, 0.0) / 100.0;
    let outer_round = prop_num(shape.outer_roundness.as_ref(), frame, 0.0) / 100.0;
    let rotation = prop_num(shape.rotation.as_ref(), frame, 0.0);
    let pos = prop_arr(shape.position.as_ref(), frame, &[0.0, 0.0]);
    let (cx, cy) = (pos[0], pos[1]);

    let mut verts: Vec<Vert> = Vec::new();
    if shape.star_type == Some(2.0) {
        const POLYGON_MAGIC: f64 = 0.25;
        let mut current_angle = -90.0f64.to_radians();
        let angle_per_point = (2.0 * std::f64::consts::PI) / points.floor();
        let num_points = points.floor() as usize;
        let roundness = inner_round + outer_round;
        let mut x = outer_r * current_angle.cos();
        let mut y = outer_r * current_angle.sin();
        current_angle += angle_per_point;
        verts.push(Vert { v: [x, y], i: [0.0; 2], o: [0.0; 2] });
        let has_round = !vzero(roundness);
        for _ in 0..num_points {
            let (px, py) = (x, y);
            x = outer_r * current_angle.cos();
            y = outer_r * current_angle.sin();
            if has_round {
                let cp1_theta = py.atan2(px) - std::f64::consts::FRAC_PI_2;
                let cp2_theta = y.atan2(x) - std::f64::consts::FRAC_PI_2;
                let (cp1dx, cp1dy) = (cp1_theta.cos(), cp1_theta.sin());
                let (cp2dx, cp2dy) = (cp2_theta.cos(), cp2_theta.sin());
                let cpx = outer_r * roundness * POLYGON_MAGIC;
                verts.last_mut().unwrap().o = [-cpx * cp1dx, -cpx * cp1dy];
                verts.push(Vert { v: [x, y], i: [cpx * cp2dx, cpx * cp2dy], o: [0.0; 2] });
            } else {
                verts.push(Vert { v: [x, y], i: [0.0; 2], o: [0.0; 2] });
            }
            current_angle += angle_per_point;
        }
    } else {
        const POLYSTAR_MAGIC: f64 = 0.47829 / 0.28;
        let mut current_angle = -90.0f64.to_radians();
        #[allow(unused_assignments)]
        let (mut x, mut y) = (0.0, 0.0);
        let mut partial_radius = 0.0;
        let angle_per_point = (2.0 * std::f64::consts::PI) / points;
        let half_angle = angle_per_point / 2.0;
        let partial_amount = points - points.floor();
        let mut long_segment = false;
        let num_points = points.ceil() as usize * 2;
        let has_round = !vzero(inner_round) || !vzero(outer_round);

        if !veq(partial_amount, 0.0) {
            current_angle += half_angle * (1.0 - partial_amount);
        }
        if !veq(partial_amount, 0.0) {
            partial_radius = inner_r + partial_amount * (outer_r - inner_r);
            x = partial_radius * current_angle.cos();
            y = partial_radius * current_angle.sin();
            current_angle += angle_per_point * partial_amount / 2.0;
        } else {
            x = outer_r * current_angle.cos();
            y = outer_r * current_angle.sin();
            current_angle += half_angle;
        }
        verts.push(Vert { v: [x, y], i: [0.0; 2], o: [0.0; 2] });
        for i in 0..num_points {
            let mut radius = if long_segment { outer_r } else { inner_r };
            let mut d_theta = half_angle;
            if !veq(partial_radius, 0.0) && i == num_points - 2 {
                d_theta = angle_per_point * partial_amount / 2.0;
            }
            if !veq(partial_radius, 0.0) && i == num_points - 1 {
                radius = partial_radius;
            }
            let (px, py) = (x, y);
            x = radius * current_angle.cos();
            y = radius * current_angle.sin();
            if has_round {
                let cp1_theta = py.atan2(px) - std::f64::consts::FRAC_PI_2;
                let cp2_theta = y.atan2(x) - std::f64::consts::FRAC_PI_2;
                let (cp1dx, cp1dy) = (cp1_theta.cos(), cp1_theta.sin());
                let (cp2dx, cp2dy) = (cp2_theta.cos(), cp2_theta.sin());
                let (cp1_round, cp2_round) = if long_segment { (inner_round, outer_round) } else { (outer_round, inner_round) };
                let (cp1_r, cp2_r) = if long_segment { (inner_r, outer_r) } else { (outer_r, inner_r) };
                let mut cp1x = cp1_r * cp1_round * POLYSTAR_MAGIC * cp1dx / points;
                let mut cp1y = cp1_r * cp1_round * POLYSTAR_MAGIC * cp1dy / points;
                let cp2x = cp2_r * cp2_round * POLYSTAR_MAGIC * cp2dx / points;
                let cp2y = cp2_r * cp2_round * POLYSTAR_MAGIC * cp2dy / points;
                if !veq(partial_amount, 0.0) && (i == 0 || i == num_points - 1) {
                    cp1x *= partial_amount;
                    cp1y *= partial_amount;
                }
                verts.last_mut().unwrap().o = [-cp1x, -cp1y];
                verts.push(Vert { v: [x, y], i: [cp2x, cp2y], o: [0.0; 2] });
            } else {
                verts.push(Vert { v: [x, y], i: [0.0; 2], o: [0.0; 2] });
            }
            current_angle += d_theta;
            long_segment = !long_segment;
        }
    }

    let b = rotation * std::f64::consts::PI / 180.0;
    let (s, c) = b.sin_cos();
    for vtx in verts.iter_mut() {
        let (px, py) = (vtx.v[0], vtx.v[1]);
        vtx.v = [c * px - s * py + cx, s * px + c * py + cy];
        let (ix, iy) = (vtx.i[0], vtx.i[1]);
        vtx.i = [c * ix - s * iy, s * ix + c * iy];
        let (ox, oy) = (vtx.o[0], vtx.o[1]);
        vtx.o = [c * ox - s * oy, s * ox + c * oy];
    }
    verts
}



fn line_length(x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    let x = (x2 - x1).abs();
    let y = (y2 - y1).abs();
    if x > y {
        x + 0.375 * y
    } else {
        y + 0.375 * x
    }
}

pub fn path_length(cmds: &[Pc]) -> f64 {
    let mut len = 0.0;
    let mut prev = (0.0, 0.0);
    for cmd in cmds {
        match cmd {
            Pc::M(p) => prev = (p[0], p[1]),
            Pc::L(p) => {
                len += line_length(prev.0, prev.1, p[0], p[1]);
                prev = (p[0], p[1]);
            }
            Pc::C(c) => {
                len += bezier_length(&CubicBezierSeg {
                    p0: [prev.0, prev.1],
                    p1: [c[0], c[1]],
                    p2: [c[2], c[3]],
                    p3: [c[4], c[5]],
                });
                prev = (c[4], c[5]);
            }
            Pc::Z => {}
        }
    }
    len
}

struct Dasher {
    out: PathCmds,
    dash: Vec<f64>,
    phase: f64,
    index: usize,
    current_length: f64,
    start_new_segment: bool,
    cur_pt: (f64, f64),
    discard: bool,
}

impl Dasher {
    fn dash_get(&self, i: usize) -> f64 {
        self.dash.get(i).copied().unwrap_or(f64::NAN)
    }

    fn update_active_segment(&mut self) {
        self.start_new_segment = true;
        let size = 2usize;
        if self.discard {
            self.discard = false;
            self.index = (self.index + 1) % size;
            self.current_length = self.dash_get(self.index * 2);
        } else {
            self.discard = true;
            self.current_length = self.dash_get(self.index * 2 + 1);
        }
        if self.current_length.is_finite() && vzero(self.current_length) {
            self.update_active_segment();
        }
    }

    fn add_line(&mut self, p: (f64, f64)) {
        if self.discard {
            return;
        }
        if self.start_new_segment {
            self.out.push(Pc::M([self.cur_pt.0, self.cur_pt.1]));
            self.start_new_segment = false;
        }
        self.out.push(Pc::L([p.0, p.1]));
    }

    fn add_cubic(&mut self, c1: [f64; 2], c2: [f64; 2], e: [f64; 2]) {
        if self.discard {
            return;
        }
        if self.start_new_segment {
            self.out.push(Pc::M([self.cur_pt.0, self.cur_pt.1]));
            self.start_new_segment = false;
        }
        self.out.push(Pc::C([c1[0], c1[1], c2[0], c2[1], e[0], e[1]]));
    }

    fn advance_phase(&mut self) {
        let cycle = self.dash_get(0) + self.dash_get(1);
        if !cycle.is_finite() || cycle <= 1e-9 {
            return;
        }
        let phase = if self.phase.is_finite() { self.phase } else { 0.0 };
        let mut p = phase % cycle;
        if p < 0.0 {
            p += cycle;
        }
        let mut guard = 0usize;
        while p > 1e-9 && guard < 16384 {
            guard += 1;
            let cl = self.current_length;
            if !cl.is_finite() {
                return;
            }
            if p < cl {
                self.current_length = cl - p;
                p = 0.0;
            } else {
                p -= cl;
                self.update_active_segment();
            }
        }
    }

    fn move_to(&mut self, p: (f64, f64)) {
        self.discard = false;
        self.start_new_segment = true;
        self.cur_pt = p;
        self.index = 0;
        self.current_length = self.dash_get(0);
        if vzero(self.current_length) {
            self.update_active_segment();
        }
        if self.phase.abs() > 1e-9 {
            self.advance_phase();
        }
    }

    fn line_to(&mut self, p: (f64, f64)) {
        let len = line_length(self.cur_pt.0, self.cur_pt.1, p.0, p.1);
        if len <= self.current_length {
            self.current_length -= len;
            self.add_line(p);
        } else {
            let mut length = len;
            let mut line = (self.cur_pt.0, self.cur_pt.1, p.0, p.1);
            let mut iter = 0;
            while length > self.current_length && iter < DASH_ITER_CAP {
                iter += 1;
                length -= self.current_length;
                let t = self.current_length / (self.current_length + length);
                let split_x = line.0 + (line.2 - line.0) * t;
                let split_y = line.1 + (line.3 - line.1) * t;
                self.add_line((split_x, split_y));
                self.update_active_segment();
                line = (split_x, split_y, line.2, line.3);
                self.cur_pt = (line.0, line.1);
            }
            if length > DASH_TOLERANCE {
                self.current_length -= length;
                self.add_line((line.2, line.3));
            }
        }
        if self.current_length.is_finite() && self.current_length < DASH_TOLERANCE {
            self.update_active_segment();
        }
        self.cur_pt = p;
    }

    fn cubic_to(&mut self, c1: [f64; 2], c2: [f64; 2], e: [f64; 2]) {
        let mut bez = CubicBezierSeg {
            p0: [self.cur_pt.0, self.cur_pt.1],
            p1: c1,
            p2: c2,
            p3: e,
        };
        let mut bez_len = bezier_length(&bez);
        let full_len = bez_len;
        if bez_len <= self.current_length {
            self.current_length -= bez_len;
            self.add_cubic(c1, c2, e);
        } else {
            let mut iter = 0;
            while bez_len > self.current_length && iter < DASH_ITER_CAP {
                let total = if iter == 0 { full_len } else { bezier_length(&bez) };
                iter += 1;
                bez_len -= self.current_length;
                let t = bezier_t_at_length(&bez, self.current_length, total);
                let (left, right) = bezier_split(&bez, t);
                self.add_cubic(left.p1, left.p2, left.p3);
                self.update_active_segment();
                bez = right;
                self.cur_pt = (bez.p0[0], bez.p0[1]);
            }
            if bez_len > DASH_TOLERANCE {
                self.current_length -= bez_len;
                self.add_cubic(bez.p1, bez.p2, bez.p3);
            }
        }
        if self.current_length.is_finite() && self.current_length < DASH_TOLERANCE {
            self.update_active_segment();
        }
        self.cur_pt = (e[0], e[1]);
    }
}

fn dasher(cmds: &[Pc], dash: &[f64], offset: f64) -> PathCmds {
    if dash.is_empty() || dash.iter().any(|d| !d.is_finite() || *d < 0.0) || !dash.iter().any(|d| *d > 0.0) {
        return cmds.to_vec();
    }
    let mut d = Dasher {
        dash: dash.to_vec(),
        out: Vec::new(),
        phase: offset,
        index: 0,
        current_length: 0.0,
        start_new_segment: true,
        cur_pt: (0.0, 0.0),
        discard: false,
    };
    for cmd in cmds {
        match cmd {
            Pc::M(p) => d.move_to((p[0], p[1])),
            Pc::L(p) => d.line_to((p[0], p[1])),
            Pc::C(c) => d.cubic_to([c[0], c[1]], [c[2], c[3]], [c[4], c[5]]),
            Pc::Z => {}
        }
    }
    d.out
}

fn trim_path(cmds: &[Pc], start: f64, end: f64, length: f64) -> PathCmds {
    let t0 = prof::now();
    let out = trim_path_impl(cmds, start, end, length);
    prof::add(prof::TRIM, t0);
    out
}

fn trim_path_impl(cmds: &[Pc], start: f64, end: f64, length: f64) -> PathCmds {
    if veq(start, end) {
        return Vec::new();
    }
    if (veq(start, 0.0) && veq(end, 1.0)) || (veq(start, 1.0) && veq(end, 0.0)) {
        return cmds.to_vec();
    }
    if length <= 0.0 {
        return Vec::new();
    }
    const MAX: f64 = f64::MAX;
    let dash: Vec<f64> = if start < end {
        vec![0.0, length * start, (end - start) * length, MAX]
    } else {
        vec![length * end, (start - end) * length, (1.0 - start) * length, MAX]
    };
    dasher(cmds, &dash, 0.0)
}

#[inline]
fn mat_is_identity(m: Mat3) -> bool {
    m[0] == 1.0 && m[1] == 0.0 && m[2] == 0.0 && m[3] == 1.0 && m[4] == 0.0 && m[5] == 0.0
}

#[inline]
fn snap(v: f64) -> f64 {
    (v * 16.0).round_ties_even() * 0.0625
}

#[inline]
fn is_small_path(cmds: &[Pc]) -> bool {
    cmds.len() <= 2
}

fn transform_cmds_ext_into(cmds: &[Pc], m: Mat3, out: &mut PathCmds) -> Option<(f64, f64, f64, f64)> {
    out.reserve(cmds.len());
    if mat_is_identity(m) {
        let mut x0 = f64::INFINITY;
        let mut y0 = f64::INFINITY;
        let mut x1 = f64::NEG_INFINITY;
        let mut y1 = f64::NEG_INFINITY;
        let mut add = |x: f64, y: f64| {
            if x < x0 { x0 = x; }
            if y < y0 { y0 = y; }
            if x > x1 { x1 = x; }
            if y > y1 { y1 = y; }
        };
        for cmd in cmds {
            match *cmd {
                Pc::M(p) => add(p[0], p[1]),
                Pc::L(p) => add(p[0], p[1]),
                Pc::C(c) => { add(c[0], c[1]); add(c[2], c[3]); add(c[4], c[5]); }
                Pc::Z => {}
            }
            out.push(cmd.clone());
        }
        return if x0.is_finite() { Some((x0, y0, x1, y1)) } else { None };
    }
    let do_snap = is_small_path(cmds);
    let mut x0 = f64::INFINITY;
    let mut y0 = f64::INFINITY;
    let mut x1 = f64::NEG_INFINITY;
    let mut y1 = f64::NEG_INFINITY;
    let mut add = |x: f64, y: f64| {
        if x < x0 { x0 = x; }
        if y < y0 { y0 = y; }
        if x > x1 { x1 = x; }
        if y > y1 { y1 = y; }
    };
    for cmd in cmds {
        out.push(match *cmd {
            Pc::M(p) => {
                let (x, y) = mat_apply(m, p[0], p[1]);
                let (x, y) = if do_snap { (snap(x), snap(y)) } else { (x, y) };
                add(x, y);
                Pc::M([x, y])
            }
            Pc::L(p) => {
                let (x, y) = mat_apply(m, p[0], p[1]);
                let (x, y) = if do_snap { (snap(x), snap(y)) } else { (x, y) };
                add(x, y);
                Pc::L([x, y])
            }
            Pc::C(c) => {
                let (x1_, y1_) = mat_apply(m, c[0], c[1]);
                let (x2_, y2_) = mat_apply(m, c[2], c[3]);
                let (x3_, y3_) = mat_apply(m, c[4], c[5]);
                let (x1_, y1_, x2_, y2_, x3_, y3_) = if do_snap {
                    (snap(x1_), snap(y1_), snap(x2_), snap(y2_), snap(x3_), snap(y3_))
                } else {
                    (x1_, y1_, x2_, y2_, x3_, y3_)
                };
                add(x1_, y1_);
                add(x2_, y2_);
                add(x3_, y3_);
                Pc::C([x1_, y1_, x2_, y2_, x3_, y3_])
            }
            Pc::Z => Pc::Z,
        });
    }
    if x0.is_finite() { Some((x0, y0, x1, y1)) } else { None }
}

fn transform_cmds(cmds: &[Pc], m: Mat3) -> PathCmds {
    let mut out: PathCmds = Vec::with_capacity(cmds.len());
    transform_cmds_ext_into(cmds, m, &mut out);
    out
}





#[derive(Clone, Copy, Debug)]
pub struct Rgba(pub f64, pub f64, pub f64, pub f64);

fn color_at(v: &JsonValue, alpha: f64) -> Rgba {
    match v {
        JsonValue::Array(a) if !a.is_empty() => {
            let r = js_f64(&a[0]);
            let g = a.get(1).map_or(0.0, js_f64);
            let b = a.get(2).map_or(0.0, js_f64);
            let a2 = if a.len() > 3 { js_f64(&a[3]) } else { 1.0 };
            Rgba(r, g, b, a2 * alpha)
        }
        JsonValue::Nums(n) => {
            let r = n.get(0).unwrap_or(f64::NAN);
            let g = n.get(1).unwrap_or(0.0);
            let b = n.get(2).unwrap_or(0.0);
            let a2 = if n.len() > 3 { n.get(3).unwrap_or(1.0) } else { 1.0 };
            Rgba(r, g, b, a2 * alpha)
        }
        JsonValue::Number(n) => {
            let mut bits = *n as i64;
            if bits < 0 {
                bits += 0x1_0000_0000i64;
            }
            if bits > 0xFFFF_FFFF || bits < 0 {
                bits = 0;
            }
            let r = ((bits >> 16) & 0xff) as f64 / 255.0;
            let g = ((bits >> 8) & 0xff) as f64 / 255.0;
            let b = (bits & 0xff) as f64 / 255.0;
            Rgba(r, g, b, alpha)
        }
        _ => Rgba(0.0, 0.0, 0.0, alpha),
    }
}

fn rgba_f(c: Rgba) -> RgbaF {
    RgbaF {
        r: c.0.clamp(0.0, 1.0) as f32,
        g: c.1.clamp(0.0, 1.0) as f32,
        b: c.2.clamp(0.0, 1.0) as f32,
        a: c.3.clamp(0.0, 1.0) as f32,
    }
}





fn num_elem(v: &JsonValue, i: usize) -> Option<f64> {
    match v {
        JsonValue::Nums(n) => n.get(i),
        JsonValue::Array(a) => a.get(i).map(js_f64),
        _ => None,
    }
}

fn gradient_stops(g: &ParsedGradient, frame: f64, alpha: f64) -> crate::gradlut::GradStops {
    if let Ok(cached) = g.stops_cache.0.read() {
        if let Some(stops) = cached.as_ref() {
            let mut out = stops.clone();
            out.alpha = alpha as f32;
            return out;
        }
    }
    let built = gradient_stops_build(g, frame);
    if prop_is_static(Some(&g.stops)) && (!built.colors.is_empty() || !built.alphas.is_empty()) {
        let mut to_store = built.clone();
        to_store.alpha = 0.0;
        if let Ok(mut slot) = g.stops_cache.0.write() {
            if slot.is_none() {
                *slot = Some(to_store);
            }
        }
    }
    let mut out = built;
    out.alpha = alpha as f32;
    out
}

fn gradient_stops_build(g: &ParsedGradient, frame: f64) -> crate::gradlut::GradStops {
    let stops_raw = prop_json_ref(Some(&g.stops), frame);
    let sr = stops_raw.as_ref();
    let mut out = crate::gradlut::GradStops {
        colors: Vec::new(),
        alphas: Vec::new(),
        alpha: 1.0,
    };
    if !sr.is_array() {
        return out;
    }
    if let Some(arr) = sr.as_array() {
        if let Some(first) = arr.first() {
            if first.is_array() {
                let mut any_alpha = false;
                for entry in arr {
                    let elen = entry.arr_len().unwrap_or(0);
                    if elen == 0 {
                        continue;
                    }
                    let off = num_elem(entry, 0).unwrap_or(0.0) as f32;
                    let r = num_elem(entry, 1).unwrap_or(0.0) as f32;
                    let gg = num_elem(entry, 2).unwrap_or(0.0) as f32;
                    let b = num_elem(entry, 3).unwrap_or(0.0) as f32;
                    let a = if elen > 4 {
                        any_alpha = true;
                        num_elem(entry, 4).unwrap_or(1.0) as f32
                    } else {
                        1.0
                    };
                    out.colors.push((off, [r, gg, b]));
                    out.alphas.push((off, a));
                }
                if !any_alpha {
                    out.alphas.clear();
                }
                return out;
            }
        }
    }
    let total = sr.arr_len().unwrap_or(0);
    if total == 0 {
        return out;
    }
    let mut count = g.color_points.unwrap_or(0.0);
    if !(count > 0.0) {
        count = (total / 4) as f64;
    }
    let n = (count as usize).min(64).min(total / 4);
    for i in 0..n {
        let base = i * 4;
        out.colors.push((
            num_elem(sr, base).unwrap_or(0.0) as f32,
            [
                num_elem(sr, base + 1).unwrap_or(0.0) as f32,
                num_elem(sr, base + 2).unwrap_or(0.0) as f32,
                num_elem(sr, base + 3).unwrap_or(0.0) as f32,
            ],
        ));
    }
    let mut i = n * 4;
    while i + 1 < total {
        out.alphas.push((
            num_elem(sr, i).unwrap_or(0.0) as f32,
            num_elem(sr, i + 1).unwrap_or(1.0) as f32,
        ));
        i += 2;
    }
    out
}





#[derive(Clone)]
struct CapturedPath {
    cmds: Rc<PathCmds>,
    matrix: Mat3,
}

#[derive(Clone)]
struct PaintRec<'a> {
    shape: &'a ParsedShape,
    start: usize,
    len: usize,
    matrix: Mat3,
    alpha: f64,
}

#[derive(Clone)]
struct RepeatCopyRec<'a> {
    shape: &'a ParsedShape,
    content: &'a [ParsedShape],
    mat: Mat3,
    alpha: f64,
}

#[derive(Default)]
struct WalkState<'a> {
    paths: Vec<CapturedPath>,
    paints: Vec<PaintRec<'a>>,
    repeat_copies: Vec<RepeatCopyRec<'a>>,
}

fn repeater_matrix(tr: Option<&ParsedTransform>, frame: f64, n: f64) -> Mat3 {
    let pos = prop_pair(tr.and_then(|t| t.position.as_ref()), frame, [0.0, 0.0]);
    let anchor = prop_pair(tr.and_then(|t| t.anchor.as_ref()), frame, [0.0, 0.0]);
    let rot = prop_num(tr.and_then(|t| t.rotation.as_ref()), frame, 0.0);
    let scale = prop_pair(tr.and_then(|t| t.scale.as_ref()), frame, [100.0, 100.0]);
    let sx = (scale[0] / 100.0).powi(n as i32);
    let sy = (scale[1] / 100.0).powi(n as i32);
    let mut m = mat_translate(pos[0] * n + anchor[0], pos[1] * n + anchor[1]);
    m = mat_mul(m, mat_scale(sx, sy));
    m = mat_mul(m, mat_rotate(rot * n));
    m = mat_mul(m, mat_translate(-anchor[0], -anchor[1]));
    m
}

fn max_property_number(prop: Option<&ParsedProperty>, fallback: f64) -> f64 {
    let Some(p) = prop else { return fallback };
    let mut m = fallback;
    let mut consider = |v: &JsonValue| {
        let n = js_f64(v);
        if n.is_finite() && n > m {
            m = n;
        }
    };
    consider(&p.value);
    for k in p.keyframes.iter().flatten() {
        consider(&k.s);
        if let Some(e) = &k.e {
            consider(e);
        }
    }
    m
}

type GeomCache = std::collections::HashMap<usize, Option<Rc<PathCmds>>>;

#[derive(Default)]
struct GeomCaches {
    stat: GeomCache,
    anim: Vec<(usize, u64, Option<Rc<PathCmds>>)>,
    frame: u64,
}

fn prop_is_static(prop: Option<&ParsedProperty>) -> bool {
    match prop {
        Some(p) => !p.animated && p.keyframes.is_none() && p.override_value.is_none(),
        None => true,
    }
}

fn shape_is_static(shape: &ParsedShape) -> bool {
    match shape.shape_type.as_str() {
        "path" => prop_is_static(shape.vertices.as_ref()),
        "ellipse" => prop_is_static(shape.position.as_ref()) && prop_is_static(shape.size.as_ref()),
        "rect" => {
            prop_is_static(shape.position.as_ref())
                && prop_is_static(shape.size.as_ref())
                && match &shape.rd {
                    Some(rd) => prop_is_static(rd.radius.as_ref()),
                    None => prop_is_static(shape.radius.as_ref()),
                }
        }
        "star" => {
            prop_is_static(shape.points.as_ref())
                && prop_is_static(shape.inner_radius.as_ref())
                && prop_is_static(shape.outer_radius.as_ref())
                && prop_is_static(shape.inner_roundness.as_ref())
                && prop_is_static(shape.outer_roundness.as_ref())
                && prop_is_static(shape.rotation.as_ref())
                && prop_is_static(shape.position.as_ref())
        }
        _ => false,
    }
}

fn shape_cmds(shape: &ParsedShape, frame: f64, cache: &mut GeomCaches) -> Option<Rc<PathCmds>> {
    let key = shape as *const ParsedShape as usize;
    if !shape_is_static(shape) {
        let fb = frame.to_bits();
        if cache.frame != fb {
            cache.anim.clear();
            cache.frame = fb;
        }
        if let Some((_, _, out)) = cache.anim.iter().find(|e| e.0 == key && e.1 == fb) {
            return out.clone();
        }
        let t0 = prof::now();
        let out = shape_cmds_impl(shape, frame).map(Rc::new);
        prof::add(prof::SHAPE, t0);
        if cache.anim.len() < 512 {
            cache.anim.push((key, fb, out.clone()));
        }
        return out;
    }
    if let Some(entry) = cache.stat.get(&key) {
        return entry.clone();
    }
    let t0 = prof::now();
    let out = shape_cmds_impl(shape, frame).map(Rc::new);
    prof::add(prof::SHAPE, t0);
    cache.stat.insert(key, out.clone());
    out
}

thread_local! {
    static VERT_POOL: RefCell<Vec<Vec<f64>>> = const { RefCell::new(Vec::new()) };
}

fn verts_emit_contour(cmds: &mut PathCmds, flat: &[f64], nv: usize, ni: usize, no: usize, closed: bool) {
    if nv == 0 {
        return;
    }
    let ib = nv * 2;
    let ob = ib + ni * 2;
    let at = |b: usize, j: usize| -> [f64; 2] { [flat[b + j * 2], flat[b + j * 2 + 1]] };
    let pair = |b: usize, j: usize, n: usize| -> [f64; 2] {
        if j < n {
            at(b, j)
        } else {
            [0.0, 0.0]
        }
    };
    cmds.reserve(nv * 2 + 2);
    let v0 = at(0, 0);
    cmds.push(Pc::M(v0));
    let mut prev_v = v0;
    let mut prev_o = pair(ob, 0, no);
    for j in 1..nv {
        let vj = at(0, j);
        let ij = pair(ib, j, ni);
        cmds.push(Pc::C([
            prev_v[0] + prev_o[0],
            prev_v[1] + prev_o[1],
            vj[0] + ij[0],
            vj[1] + ij[1],
            vj[0],
            vj[1],
        ]));
        prev_v = vj;
        prev_o = pair(ob, j, no);
    }
    if closed && nv > 1 {
        let i0 = pair(ib, 0, ni);
        cmds.push(Pc::C([
            prev_v[0] + prev_o[0],
            prev_v[1] + prev_o[1],
            v0[0] + i0[0],
            v0[1] + i0[1],
            v0[0],
            v0[1],
        ]));
        cmds.push(Pc::Z);
    }
}

fn verts_emit_shape(cmds: &mut PathCmds, sh: &VertShape) {
    for c in sh.contours.iter() {
        verts_emit_contour(cmds, &c.flat, c.nv, c.ni, c.no, c.closed.unwrap_or(true));
    }
}

fn verts_cmds_at(vf: &VertFast, frame: f64) -> Option<PathCmds> {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::PROP);
    let t0 = prof::now();
    let out = verts_cmds_at_impl(vf, frame);
    prof::add(prof::INTERP, t0);
    out
}

fn verts_cmds_at_impl(vf: &VertFast, frame: f64) -> Option<PathCmds> {
    let mut cmds: PathCmds = Vec::new();
    if !vf.animated {
        verts_emit_shape(&mut cmds, &vf.value);
        return if cmds.is_empty() { None } else { Some(cmds) };
    }
    let kfs = &vf.keyframes;
    if kfs.is_empty() {
        return None;
    }
    let first = &kfs[0];
    let last = kfs.last().unwrap();
    if frame <= first.t {
        verts_emit_shape(&mut cmds, &first.s);
        return if cmds.is_empty() { None } else { Some(cmds) };
    }
    let last_end = last.end_frame.unwrap_or(last.t);
    if frame >= last_end {
        verts_emit_shape(&mut cmds, last.e.as_ref().unwrap_or(&last.s));
        return if cmds.is_empty() { None } else { Some(cmds) };
    }
    let mut lo: isize = 0;
    let mut hi: isize = kfs.len() as isize - 1;
    while lo <= hi {
        let mid = (lo + hi) >> 1;
        let kf = &kfs[mid as usize];
        let next = kfs.get(mid as usize + 1);
        let end = kf.end_frame.unwrap_or_else(|| next.map(|n| n.t).unwrap_or(kf.t));
        if frame < kf.t {
            hi = mid - 1;
        } else if frame >= end {
            lo = mid + 1;
        } else {
            if kf.hold {
                verts_emit_shape(&mut cmds, &kf.s);
                return if cmds.is_empty() { None } else { Some(cmds) };
            }
            let diff = end - kf.t;
            let duration = if diff.is_nan() { f64::NAN } else { diff.max(1e-6) };
            let mut t = clamp01((frame - kf.t) / duration);
            if let Some(curve) = kf.easing_curve.as_deref() {
                t = curve.value(t);
            }
            let e_sh = kf.e.as_ref().unwrap_or(&kf.s);
            if kf.snap {
                let sh = if t >= 0.5 { e_sh } else { &kf.s };
                verts_emit_shape(&mut cmds, sh);
                return if cmds.is_empty() { None } else { Some(cmds) };
            }
            let sc = &kf.s.contours[0];
            let ec = &e_sh.contours[0];
            let nv = sc.nv.min(ec.nv);
            let ni = if sc.ni > 0 && ec.ni > 0 { sc.ni.min(ec.ni) } else { 0 };
            let no = if sc.no > 0 && ec.no > 0 { sc.no.min(ec.no) } else { 0 };
            let mut flat: Vec<f64> = VERT_POOL.with(|p| {
                let mut v = p.borrow_mut().pop().unwrap_or_default();
                v.clear();
                v.reserve((nv + ni + no) * 2);
                v
            });
            for j in 0..nv {
                let a = sc.flat[j * 2];
                let b = ec.flat[j * 2];
                flat.push(a + (b - a) * t);
                let a = sc.flat[j * 2 + 1];
                let b = ec.flat[j * 2 + 1];
                flat.push(a + (b - a) * t);
            }
            let sb = sc.nv * 2;
            let eb = ec.nv * 2;
            for j in 0..ni {
                let a = sc.flat[sb + j * 2];
                let b = ec.flat[eb + j * 2];
                flat.push(a + (b - a) * t);
                let a = sc.flat[sb + j * 2 + 1];
                let b = ec.flat[eb + j * 2 + 1];
                flat.push(a + (b - a) * t);
            }
            let so = (sc.nv + sc.ni) * 2;
            let eo = (ec.nv + ec.ni) * 2;
            for j in 0..no {
                let a = sc.flat[so + j * 2];
                let b = ec.flat[eo + j * 2];
                flat.push(a + (b - a) * t);
                let a = sc.flat[so + j * 2 + 1];
                let b = ec.flat[eo + j * 2 + 1];
                flat.push(a + (b - a) * t);
            }
            let closed = ec.closed.or(sc.closed).unwrap_or(true);
            verts_emit_contour(&mut cmds, &flat, nv, ni, no, closed);
            if flat.capacity() > 0 {
                VERT_POOL.with(|p| {
                    let mut p = p.borrow_mut();
                    if p.len() < 64 {
                        p.push(flat);
                    }
                });
            }
            return if cmds.is_empty() { None } else { Some(cmds) };
        }
    }
    None
}

fn shape_cmds_impl(shape: &ParsedShape, frame: f64) -> Option<PathCmds> {
    match shape.shape_type.as_str() {
        "roundedCorner" => None,
        "path" => {
            if let Some(vf) = &shape.verts_fast {
                return verts_cmds_at(vf, frame);
            }
            let raw = prop_json_ref(shape.vertices.as_ref(), frame);
            let raw = raw.as_ref();
            if raw.is_null() || raw.is_string() {
                return None;
            }
            let mut cmds: PathCmds = Vec::new();
            #[inline(always)]
            fn pt2(v: &JsonValue) -> [f64; 2] {
                match v {
                    JsonValue::Nums(n) => [n.first().unwrap_or(0.0), n.get(1).unwrap_or(0.0)],
                    JsonValue::Array(a) => {
                        let x = match a.first() {
                            Some(JsonValue::Number(n)) => *n,
                            Some(v) => js_f64(v),
                            None => 0.0,
                        };
                        let y = match a.get(1) {
                            Some(JsonValue::Number(n)) => *n,
                            Some(v) => js_f64(v),
                            None => 0.0,
                        };
                        [x, y]
                    }
                    _ => [num_elem(v, 0).unwrap_or(0.0), num_elem(v, 1).unwrap_or(0.0)],
                }
            }
            #[inline(always)]
            fn pair_opt_pt(arr: Option<&Vec<JsonValue>>, j: usize) -> [f64; 2] {
                match arr.and_then(|a| a.get(j)) {
                    Some(v) => pt2(v),
                    None => [0.0, 0.0],
                }
            }
            let push_entry = |ct: &JsonValue, cmds: &mut PathCmds| {
                let varr = match ct.get("v").and_then(|v| v.as_array()) {
                    Some(v) if !v.is_empty() => v,
                    _ => return,
                };
                let iarr = ct.get("i").and_then(|v| v.as_array());
                let oarr = ct.get("o").and_then(|v| v.as_array());
                let closed = match ct.get("c") {
                    Some(JsonValue::Bool(b)) => *b,
                    _ => true,
                };
                let n = varr.len();
                cmds.reserve(n * 2 + 2);
                let v0 = pt2(&varr[0]);
                cmds.push(Pc::M(v0));
                let mut prev_v = v0;
                let mut prev_o = pair_opt_pt(oarr, 0);
                for j in 1..n {
                    let vj = pt2(&varr[j]);
                    let ij = pair_opt_pt(iarr, j);
                    cmds.push(Pc::C([
                        prev_v[0] + prev_o[0],
                        prev_v[1] + prev_o[1],
                        vj[0] + ij[0],
                        vj[1] + ij[1],
                        vj[0],
                        vj[1],
                    ]));
                    prev_v = vj;
                    prev_o = pair_opt_pt(oarr, j);
                }
                if closed && n > 1 {
                    let i0 = pair_opt_pt(iarr, 0);
                    cmds.push(Pc::C([
                        prev_v[0] + prev_o[0],
                        prev_v[1] + prev_o[1],
                        v0[0] + i0[0],
                        v0[1] + i0[1],
                        v0[0],
                        v0[1],
                    ]));
                    cmds.push(Pc::Z);
                }
            };
            if let JsonValue::Array(a) = raw {
                for it in a.iter() {
                    if it.is_object() && it.get("v").is_some() {
                        push_entry(it, &mut cmds);
                    }
                }
            } else if raw.is_object() && raw.get("v").is_some() {
                push_entry(raw, &mut cmds);
            } else {
                return None;
            }
            if cmds.is_empty() {
                None
            } else {
                Some(cmds)
            }
        }
        "ellipse" => {
            let p = prop_pair(shape.position.as_ref(), frame, [0.0, 0.0]);
            let s = prop_pair(shape.size.as_ref(), frame, [100.0, 100.0]);
            let mut verts = ellipse_to_verts(&p, &s);
            if shape.direction == Some(3.0) {
                verts = reverse_verts(&verts);
            }
            Some(verts_to_cmds(&verts, true))
        }
        "rect" => {
            let p = prop_pair(shape.position.as_ref(), frame, [0.0, 0.0]);
            let s = prop_pair(shape.size.as_ref(), frame, [100.0, 100.0]);
            let r = match &shape.rd {
                Some(rd) => prop_num(rd.radius.as_ref(), frame, 0.0),
                None => match shape.radius.as_ref() {
                    Some(rad) => prop_num(Some(rad), frame, 0.0),
                    None => 0.0,
                },
            };
            let mut verts = rect_to_verts(&p, &s, r);
            if shape.direction == Some(3.0) {
                verts = reverse_verts(&verts);
            }
            Some(verts_to_cmds(&verts, true))
        }
        "star" => Some(verts_to_cmds(&star_to_verts(shape, frame), true)),
        _ => None,
    }
}

fn walk_shape_group<'a>(shapes: &'a [ParsedShape], frame: f64, mat: Mat3, alpha: f64, walk: &mut WalkState<'a>, start: usize, cache: &mut GeomCaches) {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::WALK);
    
    if let Some(idx) = shapes.iter().rposition(|s| s.shape_type == "repeater") {
        walk.repeat_copies.push(RepeatCopyRec {
            shape: &shapes[idx],
            content: &shapes[..idx],
            mat,
            alpha,
        });
        let after = &shapes[(idx + 1).min(shapes.len())..];
        if !after.is_empty() {
            walk_shape_group(after, frame, mat, alpha, walk, walk.paths.len(), cache);
        }
        return;
    }

    struct PendingPaint {
        shape: *const ParsedShape,
        matrix: Mat3,
        alpha: f64,
        cutoff: usize,
    }
    thread_local! {
        static PENDING_POOL: RefCell<Vec<Vec<PendingPaint>>> = const { RefCell::new(Vec::new()) };
    }
    let mut pending: Vec<PendingPaint> = PENDING_POOL.with(|p| p.borrow_mut().pop().unwrap_or_default());
    for shape in shapes {
        let ty = shape.shape_type.as_str();
        if ty == "transform" {
            continue;
        }
        if ty == "group" {
            let Some(children) = shape.children.as_deref() else { continue };
            let mut g_mat = mat;
            let mut g_alpha = alpha;
            for child in children {
                if child.shape_type == "transform" {
                    g_mat = mat_mul(mat, mat_from_shape_transform(child, frame));
                    g_alpha = alpha * (prop_num(child.opacity.as_ref(), frame, 100.0) / 100.0);
                }
            }
            walk_shape_group(children, frame, g_mat, g_alpha, walk, walk.paths.len(), cache);
            continue;
        }
        if ty == "trim" {
            if walk.paths.len() > start {
                apply_trim_to_paths(&mut walk.paths[start..], shape, trim_props(shape, frame));
            }
            continue;
        }
        if matches!(ty, "fill" | "stroke" | "gradientFill" | "gradientStroke") {
            let paint_alpha = alpha * (prop_num(shape.opacity.as_ref(), frame, 100.0) / 100.0);
            pending.push(PendingPaint {
                shape: shape as *const ParsedShape,
                matrix: mat,
                alpha: paint_alpha,
                cutoff: walk.paths.len(),
            });
            continue;
        }
        if ty == "merge" {
            continue;
        }
        if let Some(cmds) = shape_cmds(shape, frame, cache) {
            walk.paths.push(CapturedPath { cmds, matrix: mat });
        }
    }

    for p in pending.iter() {
        let own_count = p.cutoff.saturating_sub(start);
        let shape = unsafe { &*p.shape };
        walk.paints.push(PaintRec {
            shape,
            start,
            len: own_count,
            matrix: p.matrix,
            alpha: p.alpha,
        });
    }
    pending.clear();
    PENDING_POOL.with(|p| {
        let mut pool = p.borrow_mut();
        if pool.len() < 64 {
            pool.push(pending);
        }
    });
}

struct TrimProps {
    start: f64,
    end: f64,
    offset: f64,
}

fn trim_props(trim: &ParsedShape, frame: f64) -> TrimProps {
    TrimProps {
        start: prop_num(trim.start.as_ref(), frame, 0.0) / 100.0,
        end: prop_num(trim.end.as_ref(), frame, 100.0) / 100.0,
        offset: (prop_num(trim.offset.as_ref(), frame, 0.0) % 360.0) / 360.0,
    }
}

fn trim_ranges(p: &TrimProps) -> ([(f64, f64); 2], usize) {
    let diff = (p.start - p.end).abs();
    if veq(diff, 0.0) {
        return ([(0.0, 0.0), (0.0, 0.0)], 1);
    }
    if veq(diff, 1.0) {
        return ([(0.0, 1.0), (0.0, 0.0)], 1);
    }
    let s = p.start + p.offset;
    let e = p.end + p.offset;
    let noloop = |a: f64, b: f64| (a.min(b), a.max(b));
    let loopf = |a: f64, b: f64| (a.max(b), a.min(b));
    let (ss, ee) = if p.offset >= 0.0 {
        if s <= 1.0 && e <= 1.0 {
            noloop(s, e)
        } else if s > 1.0 && e > 1.0 {
            noloop(s - 1.0, e - 1.0)
        } else if s > 1.0 {
            loopf(s - 1.0, e)
        } else {
            loopf(s, e - 1.0)
        }
    } else if s >= 0.0 && e >= 0.0 {
        noloop(s, e)
    } else if s < 0.0 && e < 0.0 {
        noloop(1.0 + s, 1.0 + e)
    } else if s < 0.0 {
        loopf(1.0 + s, e)
    } else {
        loopf(s, 1.0 + e)
    };
    if ss <= ee {
        ([(ss, ee), (0.0, 0.0)], 1)
    } else {
        ([(0.0, ee), (ss, 1.0)], 2)
    }
}

fn apply_trim_to_paths(paths: &mut [CapturedPath], trim: &ParsedShape, p: TrimProps) {
    let (ranges, count) = trim_ranges(&p);
    if DRAW_LOG_ON.with(|c| c.get()) {
        let tag = CUR_LAYER_TAG.with(|t| t.borrow().clone());
        let line = format!(
            "TRIM {} name={} => {:.4}..{:.4} n={} scope={} mode={:?}",
            tag,
            trim.name.as_deref().unwrap_or("-"),
            ranges[0].0,
            ranges[count - 1].1,
            count,
            paths.len(),
            trim.trim_mode
        );
        DRAW_LOG.with(|l| l.borrow_mut().push(line));
    }
    if count == 1 {
        let span = ranges[0].1 - ranges[0].0;
        if veq(span, 0.0) {
            for path in paths.iter_mut() {
                Rc::make_mut(&mut path.cmds).clear();
            }
            return;
        }
        if veq(span, 1.0) {
            return;
        }
    }
    let simultaneous = trim.trim_mode != Some(TrimMode::Individually);
    let lengths: Vec<f64> = paths.iter().map(|path| path_length(&path.cmds)).collect();
    let total_len = if simultaneous { 0.0 } else { lengths.iter().sum() };
    if !simultaneous && total_len <= 0.0 {
        return;
    }
    let mut acc = 0.0;
    for (path, &len) in paths.iter_mut().zip(lengths.iter()) {
        let (unit, base) = if simultaneous { (len, 0.0) } else { (total_len, acc) };
        acc += len;
        if len <= 0.0 {
            path.cmds = Rc::new(PathCmds::new());
            continue;
        }
        let mut out: PathCmds = Vec::new();
        for &(lo, hi) in ranges.iter().take(count) {
            let c0 = (lo * unit - base).clamp(0.0, len);
            let c1 = (hi * unit - base).clamp(0.0, len);
            if c1 - c0 > 0.0 {
                out.extend(trim_path(&path.cmds, c0 / len, c1 / len, len));
            }
        }
        path.cmds = Rc::new(out);
    }
}






pub struct StrokeCfg {
    pub width: f64,
    pub cap: u8,
    pub join: u8,
    pub miter_limit: f64,
}

const CAP_BUTT: u8 = 1;
const CAP_ROUND: u8 = 2;
const CAP_SQUARE: u8 = 3;
const JOIN_ROUND: u8 = 2;

fn stroke_of(paint: &PaintRec<'_>, frame: f64) -> (StrokeCfg, Option<(Vec<f64>, f64)>) {
    let scale = mat_scale_of(paint.matrix);
    let mut cfg = StrokeCfg {
        width: (prop_num(paint.shape.stroke_width.as_ref(), frame, 0.0) * scale).max(0.0),
        cap: CAP_BUTT,
        join: 1,
        miter_limit: 4.0,
    };
    let lc = paint.shape.line_cap.unwrap_or(1.0);
    cfg.cap = match lc as i32 {
        2 => CAP_ROUND,
        3 => CAP_SQUARE,
        _ => CAP_BUTT,
    };
    let lj = paint.shape.line_join.unwrap_or(1.0);
    cfg.join = match lj as i32 {
        2 => JOIN_ROUND,
        3 => 3,
        _ => 1,
    };
    if let Some(ml) = paint.shape.miter_limit {
        cfg.miter_limit = ml;
    }
    let mut dash_values: Vec<f64> = Vec::new();
    let mut dash_offset = 0.0;
    let mut invalid = false;
    if let Some(dashes) = &paint.shape.dashes {
        for d in dashes {
            let v = prop_num(Some(&d.value), frame, 0.0);
            if !v.is_finite() || v < 0.0 {
                invalid = true;
                break;
            }
            if d.name.as_deref() == Some("o") {
                dash_offset = v * scale;
            } else {
                dash_values.push(v * scale);
            }
        }
    }
    let pattern = if invalid || dash_values.len() < 2 {
        None
    } else {
        let mut no_length = true;
        let mut no_gap = true;
        let mut i = 0;
        while i + 1 < dash_values.len() {
            if !vzero(dash_values[i]) {
                no_length = false;
            }
            if !vzero(dash_values[i + 1]) {
                no_gap = false;
            }
            i += 2;
        }
        if no_length {
            return (cfg, None);
        }
        if no_gap {
            None
        } else {
            Some((dash_values, dash_offset))
        }
    };
    (cfg, pattern)
}

fn paint_style(paint: &PaintRec<'_>, frame: f64) -> Option<PaintStyle> {
    let g = paint.shape.gradient.as_ref();
    if let Some(g) = g {
        let s = prop_pair(Some(&g.start_point), frame, [0.0, 0.0]);
        let e = prop_pair(Some(&g.end_point), frame, [0.0, 0.0]);
        let (sx, sy) = mat_apply(paint.matrix, s[0], s[1]);
        let (ex, ey) = mat_apply(paint.matrix, e[0], e[1]);
        let gs = gradient_stops(g, frame, paint.alpha);
        if gs.colors.is_empty() {
            return None;
        }
        if g.gradient_type == GradientType::Radial {
            let r = seg_len_rlottie(e[0] - s[0], e[1] - s[1]);
            let m = paint.matrix;
            let det = m[0] * m[3] - m[1] * m[2];
            if det.abs() <= 1e-12 {
                return None;
            }
            let ia = m[3] / det;
            let ib = -m[1] / det;
            let ic = -m[2] / det;
            let id = m[0] / det;
            let itx = (m[2] * m[5] - m[3] * m[4]) / det;
            let ity = (m[1] * m[4] - m[0] * m[5]) / det;
            return Some(PaintStyle::Radial {
                map: crate::rast::RadialMap {
                    ia: ia as f32,
                    ib: ib as f32,
                    ic: ic as f32,
                    id: id as f32,
                    ox: (itx - s[0]) as f32,
                    oy: (ity - s[1]) as f32,
                    inv_r: if r > 1e-6 { (1.0 / r) as f32 } else { 0.0 },
                },
                stops: gs,
            });
        }
        return Some(PaintStyle::Linear {
            x0: sx as f32,
            y0: sy as f32,
            x1: ex as f32,
            y1: ey as f32,
            stops: gs,
        });
    }
    let color = prop_json_ref(paint.shape.color.as_ref(), frame);
    let rgba = color_at(color.as_ref(), paint.alpha);
    Some(PaintStyle::Solid(rgba_f(rgba)))
}


thread_local! {
    static DRAW_LOG_ON: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
    static CUR_LAYER_TAG: core::cell::RefCell<String> = const { core::cell::RefCell::new(String::new()) };
    static DRAW_LOG: core::cell::RefCell<Vec<String>> = const { core::cell::RefCell::new(Vec::new()) };
    static PAINT_DBG: core::cell::RefCell<Vec<String>> = const { core::cell::RefCell::new(Vec::new()) };
}

#[doc(hidden)]
pub fn set_draw_log(on: bool) {
    DRAW_LOG_ON.with(|c| c.set(on));
    if on {
        DRAW_LOG.with(|l| l.borrow_mut().clear());
    }
}

#[doc(hidden)]
pub fn draw_log_dump() -> String {
    DRAW_LOG.with(|l| l.borrow().join("\n"))
}

#[doc(hidden)]
pub fn paint_dbg_dump() -> String {
    PAINT_DBG.with(|l| l.borrow().join("\n"))
}

#[doc(hidden)]
pub fn paint_dbg_clear() {
    PAINT_DBG.with(|l| l.borrow_mut().clear());
}

fn draw_paints(pixmap: &mut PixBuf, paints: &[PaintRec<'_>], paths: &[CapturedPath], frame: f64, blend: Blend, scratch: &mut PathCmds) {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::DRAW);
    for paint in paints.iter().rev() {
        let t0 = prof::now();
        draw_paint_impl(pixmap, paint, paths, frame, blend, scratch);
        prof::add(prof::PAINT, t0);
    }
}

fn add_paint_item(cmds: &Rc<PathCmds>, matrix: Mat3, scratch: &mut PathCmds, bounds: &mut Option<(f64, f64, f64, f64)>) {
    if cmds.is_empty() {
        return;
    }
    #[cfg(feature = "prof")]
    {
        let k = geo_probe_key(cmds, &matrix);
        XPROBE.with(|c| {
            let mut m = c.borrow_mut();
            let fr = XPROBE_FR.with(|f| f.get());
            prof::count(prof::XPT, 1);
            match m.get(&k) {
                Some(&lf) if lf == fr.wrapping_sub(1) => prof::count(prof::XHIT, 1),
                _ => prof::count(prof::XMISS, 1),
            }
            if fr % 97 == 0 && m.len() > 65536 {
                m.clear();
            }
            m.insert(k, fr);
        });
    }
    let b = transform_cmds_ext_into(cmds, matrix, scratch);
    if let Some((x0, y0, x1, y1)) = b {
        *bounds = Some(match *bounds {
            Some((gx0, gy0, gx1, gy1)) => (gx0.min(x0), gy0.min(y0), gx1.max(x1), gy1.max(y1)),
            None => (x0, y0, x1, y1),
        });
    }
}

#[cfg(feature = "prof")]
fn geo_probe_key(cmds: &Rc<PathCmds>, matrix: &Mat3) -> u64 {
    let mut h = crate::cov_cache::Hasher128::new();
    h.mix_u64(Rc::as_ptr(cmds) as usize as u64);
    for v in matrix {
        h.mix_f64(*v);
    }
    let f = h.finish();
    (f as u64) ^ ((f >> 64) as u64)
}

#[cfg(feature = "prof")]
thread_local! {
    static XPROBE: core::cell::RefCell<std::collections::HashMap<u64, u32>> = core::cell::RefCell::new(std::collections::HashMap::new());
    static XPROBE_FR: core::cell::Cell<u32> = const { core::cell::Cell::new(1) };
    static XPROBE_SEEN: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

fn draw_paint_impl(pixmap: &mut PixBuf, paint: &PaintRec<'_>, paths: &[CapturedPath], frame: f64, blend: Blend, scratch: &mut PathCmds) {
    if crate::cov_cache::skip_draw() {
        return;
    }
    if crate::cov_cache::skip_one_now() {
        return;
    }
    if DRAW_LOG_ON.with(|c| c.get()) {
        let idx = crate::cov_cache::cur_draw_index();
        let tag = CUR_LAYER_TAG.with(|t| t.borrow().clone());
        let line = format!(
            "{} {} {} {} a={:.3}",
            idx,
            tag,
            paint.shape.shape_type.as_str(),
            paint.shape.name.as_deref().unwrap_or("-"),
            paint.alpha
        );
        DRAW_LOG.with(|l| l.borrow_mut().push(line));
    }
    prof::count(prof::DRAW, 1);
    let ty = paint.shape.shape_type.as_str();
    let is_fill = ty == "fill" || ty == "gradientFill";
    scratch.clear();
    let t0c = prof::now();
    let mut bounds: Option<(f64, f64, f64, f64)> = None;
    if let Some(items) = paths.get(paint.start..paint.start.saturating_add(paint.len)) {
        for item in items {
            add_paint_item(&item.cmds, item.matrix, scratch, &mut bounds);
        }
    }
    prof::add(prof::PCMD, t0c);
    if scratch.is_empty() {
        return;
    }
    let t0s = prof::now();
    let Some(style) = paint_style(paint, frame) else {
        prof::add(prof::PSTYLE, t0s);
        return;
    };
    if blend == Blend::SrcOver {
        if let rast::PaintStyle::Solid(c) = &style {
            if c.a <= 0.0 {
                prof::add(prof::PSTYLE, t0s);
                return;
            }
        }
    }
    let even_odd = if paint.shape.fill_rule == Some(FillRule::Evenodd) { true } else { false };
    let w = pixmap.width() as f64;
    let h = pixmap.height() as f64;
    if is_fill {
        prof::add(prof::PSTYLE, t0s);
        if let Some((bx0, by0, bx1, by1)) = bounds {
            if bx1 <= 0.0 || by1 <= 0.0 || bx0 >= w || by0 >= h {
                return;
            }
        }
        let t0f = prof::now();
        rast::fill_with(pixmap, scratch, even_odd, &style, blend, 1.0);
        prof::add(prof::FILL, t0f);
    } else {
        let (cfg, pattern) = stroke_of(paint, frame);
        if DRAW_LOG_ON.with(|c| c.get()) {
            let m = paint.matrix;
            PAINT_DBG.with(|l| l.borrow_mut().push(format!(
                "stroke w={:.4} scale={:.4} raw={:.4} m=[{:.4},{:.4},{:.4},{:.4},{:.4},{:.4}] cmds={} cbbox={:.1},{:.1}..{:.1},{:.1}",
                cfg.width,
                mat_scale_of(m),
                prop_num(paint.shape.stroke_width.as_ref(), frame, 0.0),
                m[0], m[1], m[2], m[3], m[4], m[5],
                scratch.len(),
                bounds.map(|b| b.0).unwrap_or(0.0),
                bounds.map(|b| b.1).unwrap_or(0.0),
                bounds.map(|b| b.2).unwrap_or(0.0),
                bounds.map(|b| b.3).unwrap_or(0.0)
            )));
        }
        prof::add(prof::PSTYLE, t0s);
        let pad = (cfg.width * 0.5 * cfg.miter_limit.max(1.0)).max(0.0) + 1.0;
        if let Some((bx0, by0, bx1, by1)) = bounds {
            if bx1 + pad <= 0.0 || by1 + pad <= 0.0 || bx0 - pad >= w || by0 - pad >= h {
                return;
            }
        }
        let Some((dash, offset)) = pattern else {
            let t0f = prof::now();
            rast::stroke(pixmap, scratch, cfg.width, cfg.cap, cfg.join, cfg.miter_limit, &style, blend);
            prof::add(prof::STRK, t0f);
            return;
        };
        let dashing = dasher(scratch, &dash, offset);
        if !dashing.is_empty() {
            let t0f = prof::now();
            rast::stroke(pixmap, &dashing, cfg.width, cfg.cap, cfg.join, cfg.miter_limit, &style, blend);
            prof::add(prof::STRK, t0f);
        }
    }
}

fn render_repeat_copies(pixmap: &mut PixBuf, rec: &RepeatCopyRec<'_>, frame: f64, blend: Blend, scratch: &mut PathCmds, cache: &mut GeomCaches) {
    let r = &rec.shape;
    let copies_float = prop_num(r.copies.as_ref(), frame, 0.0);
    if !copies_float.is_finite() || copies_float <= 0.0 {
        return;
    }
    let max_copies = max_property_number(r.copies.as_ref(), 0.0);
    let max_copies = if !max_copies.is_finite() || max_copies <= 0.0 { 0 } else { 10000.min(max_copies.trunc() as usize) };
    if max_copies == 0 {
        return;
    }
    let offset_raw = prop_num(r.copies_offset.as_ref(), frame, 0.0);
    let offset = if offset_raw.is_finite() { offset_raw } else { 0.0 };
    let tr = r.transform.as_ref();
    let so = prop_num(tr.and_then(|t| t.start_opacity.as_ref()), frame, 100.0) / 100.0;
    let eo = prop_num(tr.and_then(|t| t.end_opacity.as_ref()), frame, 100.0) / 100.0;
    let visible = copies_float.trunc() as i64;
    let mut count = 0usize;
    let mut walk = WalkState::default();
    for i in 0..max_copies {
        if count >= REPEATER_DRAW_BUDGET {
            break;
        }
        count += 1;
        let mut alpha = rec.alpha * (so + (eo - so) * (i as f64 / copies_float));
        if i as i64 >= visible {
            alpha = 0.0;
        }
        if alpha <= 0.0 {
            continue;
        }
        let copy_mat = mat_mul(rec.mat, repeater_matrix(tr, frame, i as f64 + 1.0 + offset));
        walk.paths.clear();
        walk.paints.clear();
        walk.repeat_copies.clear();
        walk_shape_group(rec.content, frame, copy_mat, alpha, &mut walk, 0, cache);
        for copy in walk.repeat_copies.iter() {
            render_repeat_copies(pixmap, copy, frame, blend, scratch, cache);
        }
        draw_paints(pixmap, &walk.paints, &walk.paths, frame, blend, scratch);
    }
}
pub fn render_shapes(shape_layer: &ParsedLayer, frame: f64, mat: Mat3, pixmap: &mut PixBuf, blend: Blend, seed_alpha: f64, ctx: &mut FrameCtx) {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::RESERVE);
    let Some(shapes) = shape_layer.shapes.as_deref() else { return };
    let mut walk = WalkState::default();
    let tx = prof::now();
    walk_shape_group(shapes, frame, mat, seed_alpha, &mut walk, 0, &mut ctx.geom);
    prof::add(prof::XFRM, tx);
    let mut scratch: PathCmds = core::mem::take(&mut ctx.scratch);
    let t0c = prof::now();
    let copies = walk.repeat_copies.clone();
    prof::add(prof::CLONE, t0c);
    if blend == Blend::SrcOver && seed_alpha < 1.0 && walk.paints.len() > 1 {
        for copy in copies.iter() {
            render_repeat_copies(pixmap, copy, frame, blend, &mut scratch, &mut ctx.geom);
        }
        let mut buf = ctx.take(pixmap.width(), pixmap.height());
        draw_paints(&mut buf, &walk.paints, &walk.paths, frame, blend, &mut scratch);
        let t0 = prof::now();
        rast::blit(&buf, pixmap, Blend::SrcOver, 1.0);
        prof::add(prof::BLIT, t0);
        ctx.give(buf);
        scratch.clear();
        ctx.scratch = scratch;
        return;
    }
    for copy in copies.iter() {
        render_repeat_copies(pixmap, copy, frame, blend, &mut scratch, &mut ctx.geom);
    }
    draw_paints(pixmap, &walk.paints, &walk.paths, frame, blend, &mut scratch);
    scratch.clear();
    ctx.scratch = scratch;
}








pub struct FrameCtx {
    pool: Vec<PixBuf>,
    scratch: PathCmds,
    geom: GeomCaches,
}

impl FrameCtx {
    pub fn new() -> Self {
        FrameCtx { pool: Vec::new(), scratch: Vec::new(), geom: GeomCaches::default() }
    }

    fn take(&mut self, w: u32, h: u32) -> PixBuf {
        let t0p = prof::now();
        for i in (0..self.pool.len()).rev() {
            let p = &mut self.pool[i];
            if p.width() == w && p.height() == h {
                let mut p = self.pool.swap_remove(i);
                p.clear();
                prof::add(prof::PREP, t0p);
                return p;
            }
        }
        let p = PixBuf::new(w, h).unwrap();
        prof::add(prof::PREP, t0p);
        p
    }

    fn give(&mut self, p: PixBuf) {
        self.pool.push(p);
    }
}

fn layer_visible(layer: &ParsedLayer, frame: f64) -> bool {
    if let Some(ip) = layer.in_frame {
        if frame < ip {
            return false;
        }
    }
    if let Some(op) = layer.out_frame {
        if frame > op {
            return false;
        }
    }
    true
}

fn lookup_layer(layers: &[ParsedLayer], index: f64) -> Option<&ParsedLayer> {
    layers.iter().find(|l| l.index == Some(index))
}

fn layer_combined_matrix(layer: &ParsedLayer, frame: f64, layers: &[ParsedLayer], base: Mat3) -> Mat3 {
    let mut chain = [mat_identity(); MAX_PARENT_DEPTH];
    let mut n = 0usize;
    let mut parent = layer.parent_index.and_then(|idx| lookup_layer(layers, idx));
    while let Some(p) = parent {
        if n >= MAX_PARENT_DEPTH {
            break;
        }
        chain[n] = mat_from_transform(Some(&p.transform), frame, false);
        n += 1;
        parent = p.parent_index.and_then(|idx| lookup_layer(layers, idx));
    }
    let mut m = base;
    while n > 0 {
        n -= 1;
        m = mat_mul(m, chain[n]);
    }
    mat_mul(m, mat_from_transform(Some(&layer.transform), frame, layer.auto_orient == Some(1.0)))
}

pub struct RenderInstance {
    pub anim: ParsedAnimation,
    asset_layers: std::collections::HashMap<String, std::sync::Arc<Vec<ParsedLayer>>>,
    
    ctx: FrameCtx,
    static_flag: Option<bool>,
    static_bmp: Option<(u32, u32, Vec<u8>)>,
    static_dst: (usize, usize),
    frame_cache: Option<bool>,
    frame_plan: Option<crate::framesig::SigPlan>,
    frame_sig: Option<u128>,
    frame_bmp: Option<(u32, u32, Vec<u8>)>,
    frame_dst: (usize, usize),
    frame_hits: u32,
    frame_misses: u32,
    frame_streak: u32,
}

impl RenderInstance {
    pub fn new(anim: ParsedAnimation) -> Self {
        let mut asset_layers = std::collections::HashMap::new();
        for a in &anim.assets {
            if let (Some(id), Some(layers)) = (&a.id, &a.layers) {
                asset_layers.insert(id.to_string(), std::sync::Arc::clone(layers));
            }
        }
        RenderInstance {
            anim,
            asset_layers,
            ctx: FrameCtx::new(),
            static_flag: None,
            static_bmp: None,
            static_dst: (0, 0),
            frame_cache: None,
            frame_plan: None,
            frame_sig: None,
            frame_bmp: None,
            frame_dst: (0, 0),
            frame_hits: 0,
            frame_misses: 0,
            frame_streak: 0,
        }
    }

    
    pub fn render_frame(&mut self, frame: f64, w: u32, h: u32) -> Option<PixBuf> {
        let mut dst = PixBuf::new(w, h)?;
        self.render_frame_into(&mut dst, frame);
        Some(dst)
    }

    
    
    
    pub fn render_frame_into(&mut self, dst: &mut PixBuf, frame: f64) {
        let Self {
            anim,
            asset_layers,
            ctx,
            static_flag,
            static_bmp,
            static_dst,
            frame_cache,
            frame_plan,
            frame_sig,
            frame_bmp,
            frame_dst,
            frame_hits,
            frame_misses,
            frame_streak,
        } = self;
        let w = dst.width();
        let h = dst.height();
        let is_static = match *static_flag {
            Some(v) => v,
            None => {
                let v = !anim.layers.is_empty() && crate::static_check::is_frame_invariant(anim);
                *static_flag = Some(v);
                v
            }
        };
        let dst_key = (dst.data().as_ptr() as usize, dst.data().len());
        if is_static {
            if let Some((cw, ch, data)) = static_bmp.as_ref() {
                if *cw == w && *ch == h && data.len() == dst.data().len() {
                    if *static_dst != dst_key {
                        dst.data_mut().copy_from_slice(data);
                        dst.mark_all();
                        *static_dst = dst_key;
                    }
                    return;
                }
            }
        }
        *static_dst = (0, 0);
        let cache_on = match *frame_cache {
            Some(v) => v,
            None => {
                let tb = prof::now();
                let built = crate::framesig::SigPlan::build(anim, 64);
                prof::add(prof::SIGB, tb);
                let v = (w as usize) * (h as usize) <= 640 * 640
                    && match built {
                        Some(p) => {
                            *frame_plan = Some(p);
                            true
                        }
                        None => false,
                    };
                *frame_cache = Some(v);
                v
            }
        };
        let sig = if cache_on {
            let t0 = prof::now();
            let s = frame_plan.as_ref().map(|p| p.signature(frame)).unwrap_or(0);
            prof::add(prof::SIGP, t0);
            Some(s)
        } else {
            None
        };
        if let Some(sig) = sig {
            let reuse = *frame_sig == Some(sig)
                && frame_bmp
                    .as_ref()
                    .is_some_and(|(cw, ch, data)| *cw == w && *ch == h && data.len() == dst.data().len());
            if reuse {
                if *frame_dst != dst_key {
                    let data = &frame_bmp.as_ref().unwrap().2;
                    dst.data_mut().copy_from_slice(data);
                    dst.mark_all();
                    *frame_dst = dst_key;
                }
                *frame_hits = frame_hits.saturating_add(1);
                *frame_streak = 0;
                prof::count(prof::SIGHIT, 1);
                return;
            }
        }
        crate::cov_cache::frame_tick(w as usize, h as usize);
        #[cfg(feature = "prof")]
        {
            XPROBE_FR.with(|f| f.set(f.get().wrapping_add(1)));
            XPROBE_SEEN.with(|c| c.set(false));
        }
        dst.fill(0);
        render_comp(ctx, asset_layers, dst, &anim.layers, frame, composition_matrix(anim, w, h), 1.0, w, h);
        if let Some(sig) = sig {
            *frame_sig = Some(sig);
            match frame_bmp.as_mut() {
                Some((cw, ch, data)) if *cw == w && *ch == h && data.len() == dst.data().len() => {
                    data.copy_from_slice(dst.data());
                }
                _ => *frame_bmp = Some((w, h, dst.data().to_vec())),
            }
            *frame_dst = dst_key;
            *frame_misses = frame_misses.saturating_add(1);
            *frame_streak = frame_streak.saturating_add(1);
            if *frame_streak >= 6 && (*frame_hits as u64) * 4 < u64::from(*frame_misses) {
                *frame_cache = Some(false);
                *frame_plan = None;
            }
        }
        if is_static {
            *static_bmp = Some((w, h, dst.data().to_vec()));
            *static_dst = dst_key;
        }
    }
}

fn assets_of<'a>(
    asset_layers: &'a std::collections::HashMap<String, std::sync::Arc<Vec<ParsedLayer>>>,
    ref_id: Option<&str>,
) -> Option<&'a Vec<ParsedLayer>> {
    asset_layers.get(ref_id?).map(|v| v.as_ref())
}

pub fn composition_matrix(anim: &ParsedAnimation, w: u32, h: u32) -> Mat3 {
    let sx = w as f64 / anim.width;
    let sy = h as f64 / anim.height;
    let scale = sx.min(sy);
    let tx = (w as f64 - anim.width * scale) / 2.0;
    let ty = (h as f64 - anim.height * scale) / 2.0;
    mat_mul(mat_translate(tx, ty), mat_scale(scale, scale))
}

fn render_comp(
    ctx: &mut FrameCtx,
    assets: &std::collections::HashMap<String, std::sync::Arc<Vec<ParsedLayer>>>,
    dst: &mut PixBuf,
    layers: &[ParsedLayer],
    frame: f64,
    base: Mat3,
    parent_alpha: f64,
    canvas_w: u32,
    canvas_h: u32,
) {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::RESERVE);
    
    
    let mut matte_idx: Option<usize> = None;
    for i in (0..layers.len()).rev() {
        let layer = &layers[i];
        if layer.matte_type.is_some_and(|t| t != MatteType::None) {
            matte_idx = Some(i);
            continue;
        }
        if matte_idx.is_none() && layer.matte_target == Some(true) && layer.matte_type.is_none() {
            continue;
        }
        if layer_visible(layer, frame) {
            match matte_idx {
                Some(mi) => {
                    if layer_visible(&layers[mi], frame) {
                        render_matte_pair(assets, ctx, dst, mi, i, layers, frame, base, parent_alpha, canvas_w, canvas_h);
                    }
                }
                None => render_layer(assets, ctx, dst, layer, layers, frame, base, parent_alpha, canvas_w, canvas_h),
            }
        }
        matte_idx = None;
    }
}

#[allow(clippy::too_many_arguments)]
fn render_matte_pair(
    assets: &std::collections::HashMap<String, std::sync::Arc<Vec<ParsedLayer>>>,
    ctx: &mut FrameCtx,
    dst: &mut PixBuf,
    matte_i: usize,
    src_i: usize,
    layers: &[ParsedLayer],
    frame: f64,
    base: Mat3,
    parent_alpha: f64,
    canvas_w: u32,
    canvas_h: u32,
) {
    let mut src_buf = ctx.take(canvas_w, canvas_h);
    let mut matte_buf = ctx.take(canvas_w, canvas_h);
    render_layer(
        assets,
        ctx,
        &mut src_buf,
        &layers[src_i],
        layers,
        frame,
        base,
        parent_alpha,
        canvas_w,
        canvas_h,
    );
    render_layer(
        assets,
        ctx,
        &mut matte_buf,
        &layers[matte_i],
        layers,
        frame,
        base,
        parent_alpha,
        canvas_w,
        canvas_h,
    );
    let matte_type = layers[matte_i].matte_type.unwrap_or(MatteType::None);
    if matches!(matte_type, MatteType::Luma | MatteType::LumaInv) {
        rast::apply_luma(&mut src_buf);
    }
    let cut = match matte_type {
        MatteType::Alpha | MatteType::Luma => true,
        _ => false,
    };
    let t0 = prof::now();
    rast::matte_apply(&mut matte_buf, &src_buf, cut);
    ctx.give(src_buf);
    let t1 = prof::now();
    rast::blit(&matte_buf, dst, Blend::SrcOver, 1.0);
    prof::add(prof::BLIT, t0);
    prof::add(prof::BLIT, t1);
    ctx.give(matte_buf);
}

#[allow(clippy::too_many_arguments)]
fn render_layer(
    assets: &std::collections::HashMap<String, std::sync::Arc<Vec<ParsedLayer>>>,
    ctx: &mut FrameCtx,
    dst: &mut PixBuf,
    layer: &ParsedLayer,
    layers: &[ParsedLayer],
    frame: f64,
    base: Mat3,
    parent_alpha: f64,
    canvas_w: u32,
    canvas_h: u32,
) {
    let t0c = prof::now();
    prof::add(prof::CLONE, t0c);
    let has_masks = layer.layer_type != LayerType::Null
        && layer.masks.as_ref().is_some_and(|ms| ms.iter().any(|m| m.mode != MaskMode::None));
    if has_masks {
        let masks: &[ParsedMask] = layer.masks.as_deref().unwrap_or(&[]);
        render_layer_with_masks(assets, ctx, dst, layer, layers, masks, frame, base, parent_alpha, canvas_w, canvas_h);
        return;
    }
    render_layer_inner(assets, ctx, dst, layer, layers, frame, base, parent_alpha, canvas_w, canvas_h);
}

#[allow(clippy::too_many_arguments)]
fn render_layer_with_masks(
    assets: &std::collections::HashMap<String, std::sync::Arc<Vec<ParsedLayer>>>,
    ctx: &mut FrameCtx,
    dst: &mut PixBuf,
    layer: &ParsedLayer,
    layers: &[ParsedLayer],
    masks: &[ParsedMask],
    frame: f64,
    base: Mat3,
    parent_alpha: f64,
    canvas_w: u32,
    canvas_h: u32,
) {
    let _g = crate::prof::aprobe::enter(crate::prof::aprobe::RESERVE);
    let mut content = ctx.take(canvas_w, canvas_h);
    render_layer_inner(assets, ctx, &mut content, layer, layers, frame, base, parent_alpha, canvas_w, canvas_h);

    let layer_mat = layer_combined_matrix(layer, frame, layers, base);
    if masks.len() == 1 {
        let mk = &masks[0];
        let raw = prop_json_ref(Some(&mk.path), frame);
        let cmds = mask_cmds(raw.as_ref());
        if !cmds.is_empty() {
            let t0x = prof::now();
            let cmds = transform_cmds(&cmds, layer_mat);
            prof::add(prof::PCMD, t0x);
            let alpha = (prop_num(Some(&mk.opacity), frame, 100.0) / 100.0).clamp(0.0, 1.0);
            let t0m = prof::now();
            let spans = rast::mask_spans(canvas_w, canvas_h, &cmds, false);
            rast::modulate_mask_spans(&mut content, &spans, mk.mode == MaskMode::Subtract, mk.inverted, (alpha * 255.0 + 0.5) as u32);
            prof::add(prof::BLIT, t0m);
            let t0 = prof::now();
            rast::blit(&content, dst, Blend::SrcOver, 1.0);
            prof::add(prof::BLIT, t0);
            ctx.give(content);
            return;
        }
    }
    let mut ops: Vec<(MaskMode, bool, u64, PathCmds)> = Vec::new();
    let mut chain_key = crate::cov_cache::Hasher128::new();
    chain_key.mix(canvas_w);
    chain_key.mix(canvas_h);
    for mk in masks {
        let raw = prop_json_ref(Some(&mk.path), frame);
        let cmds = mask_cmds(raw.as_ref());
        if cmds.is_empty() {
            continue;
        }
        let t0x = prof::now();
        let cmds = transform_cmds(&cmds, layer_mat);
        prof::add(prof::PCMD, t0x);
        let alpha = (prop_num(Some(&mk.opacity), frame, 100.0) / 100.0).clamp(0.0, 1.0);
        let ckey = rast::cmds_key_for_mask(3, false, canvas_w as usize, canvas_h as usize, &cmds, &[]);
        chain_key.mix(mk.mode as u8 as u32);
        chain_key.mix(if mk.inverted { 1 } else { 0 });
        chain_key.mix_f64(alpha);
        chain_key.mix(ckey as u32);
        chain_key.mix((ckey >> 32) as u32);
        chain_key.mix((ckey >> 64) as u32);
        chain_key.mix((ckey >> 96) as u32);
        ops.push((mk.mode, mk.inverted, alpha.to_bits(), cmds));
    }
    if ops.is_empty() {
        render_layer_inner(assets, ctx, dst, layer, layers, frame, base, parent_alpha, canvas_w, canvas_h);
        ctx.give(content);
        return;
    }
    let chain = chain_key.finish();
    if let Some(plane) = crate::cov_cache::mask_plane_hit(chain) {
        let t0m = prof::now();
        rast::blit_dest_in_u8(&plane, &mut content);
        prof::add(prof::BLIT, t0m);
        let t0 = prof::now();
        rast::blit(&content, dst, Blend::SrcOver, 1.0);
        prof::add(prof::BLIT, t0);
        ctx.give(content);
        return;
    }
    let mut mask_buf = ctx.take(canvas_w, canvas_h);
    let mut seeded = false;
    for (op_mode, inv, alpha_bits, cmds) in ops.iter() {
        let mk_mode = *op_mode;
        let inv = *inv;
        let alpha = f64::from_bits(*alpha_bits);
        let mk_mode_for_match = mk_mode;
        let white = |a: f64| -> PaintStyle {
            PaintStyle::Solid(RgbaF { r: 1.0, g: 1.0, b: 1.0, a: a.clamp(0.0, 1.0) as f32 })
        };
        let mk_mode_ref = &mk_mode_for_match;
        match mk_mode_ref {
            MaskMode::Subtract => {
                if !seeded {
                    let t0p = prof::now();
                    mask_buf.fill(0xff);
                    prof::add(prof::PREP, t0p);
                    seeded = true;
                }
                let t0f = prof::now();
                rast::fill_with(&mut mask_buf, &cmds, false, &white(1.0), Blend::DestOut, 1.0);
                prof::add(prof::FILL, t0f);
            }
            MaskMode::Intersect => {
                if inv {
                    if !seeded {
                        let t0p = prof::now();
                        mask_buf.fill(0xff);
                        prof::add(prof::PREP, t0p);
                        seeded = true;
                    }
                    let t0f = prof::now();
                    rast::fill_with(&mut mask_buf, &cmds, false, &white(1.0), Blend::DestOut, 1.0);
                    prof::add(prof::FILL, t0f);
                } else if !seeded {
                    let t0f = prof::now();
                    rast::fill_with(&mut mask_buf, &cmds, false, &white(alpha), Blend::SrcOver, 1.0);
                    prof::add(prof::FILL, t0f);
                    seeded = true;
                } else {
                    let t0f = prof::now();
                    rast::fill_with(&mut mask_buf, &cmds, false, &white(alpha), Blend::DestIn, 1.0);
                    prof::add(prof::FILL, t0f);
                }
            }
            _ => {
                if inv {
                    if !seeded {
                        let t0p = prof::now();
                        mask_buf.fill(0xff);
                        prof::add(prof::PREP, t0p);
                        seeded = true;
                    }
                    let t0f = prof::now();
                    rast::fill_with(&mut mask_buf, &cmds, false, &white(1.0), Blend::DestOut, 1.0);
                    prof::add(prof::FILL, t0f);
                } else {
                    let t0f = prof::now();
                    rast::fill_with(&mut mask_buf, &cmds, false, &white(alpha), Blend::SrcOver, 1.0);
                    prof::add(prof::FILL, t0f);
                    seeded = true;
                }
            }
        }
    }
    if seeded {
        let t0m = prof::now();
        rast::blit(&mask_buf, &mut content, Blend::DestIn, 1.0);
        prof::add(prof::BLIT, t0m);
        let plane = std::rc::Rc::new(rast::alpha_plane(&mask_buf));
        crate::cov_cache::mask_plane_insert(chain, plane);
        let t0 = prof::now();
        rast::blit(&content, dst, Blend::SrcOver, 1.0);
        prof::add(prof::BLIT, t0);
    } else {
        render_layer_inner(assets, ctx, dst, layer, layers, frame, base, parent_alpha, canvas_w, canvas_h);
    }
    ctx.give(mask_buf);
    ctx.give(content);
}

#[allow(clippy::too_many_arguments)]
fn render_layer_inner(
    assets: &std::collections::HashMap<String, std::sync::Arc<Vec<ParsedLayer>>>,
    ctx: &mut FrameCtx,
    dst: &mut PixBuf,
    layer: &ParsedLayer,
    layers: &[ParsedLayer],
    frame: f64,
    base: Mat3,
    parent_alpha: f64,
    canvas_w: u32,
    canvas_h: u32,
) {
    if !layer_visible(layer, frame) {
        return;
    }
    let m = layer_combined_matrix(layer, frame, layers, base);
    let opacity = parent_alpha * (prop_num(layer.transform.opacity.as_ref(), frame, 100.0) / 100.0);
    if vzero(opacity) {
        return;
    }
    if DRAW_LOG_ON.with(|c| c.get()) {
        let tag = format!(
            "{}#{}",
            layer.name.as_deref().unwrap_or("?"),
            layer.index.map(|v| v as i64).unwrap_or(-1)
        );
        CUR_LAYER_TAG.with(|t| *t.borrow_mut() = tag);
    }

    match layer.layer_type {
        LayerType::Shape => {
            render_shapes(layer, frame, m, dst, Blend::SrcOver, opacity, ctx);
        }
        LayerType::Null => {}
        LayerType::Text | LayerType::Image => {
            
        }
        LayerType::Solid => {
            let sw = layer.solid_width.unwrap_or(0.0);
            let sh = layer.solid_height.unwrap_or(0.0);
            let cmds: PathCmds = vec![
                Pc::M([sw, 0.0]),
                Pc::L([sw, sh]),
                Pc::L([0.0, sh]),
                Pc::L([0.0, 0.0]),
                Pc::Z,
            ];
            let cmds = transform_cmds(&cmds, m);
            let scol = layer.solid_color.as_deref().unwrap_or("#000000");
            let rgba = parse_hex_color(scol).unwrap_or(Rgba(0.0, 0.0, 0.0, opacity));
            let style = PaintStyle::Solid(rgba_f(Rgba(rgba.0, rgba.1, rgba.2, rgba.3 * opacity)));
            rast::fill_with(dst, &cmds, false, &style, Blend::SrcOver, 1.0);
        }
        LayerType::Precomp => {
            render_precomp(assets, ctx, dst, layer, frame, m, opacity, Blend::SrcOver, canvas_w, canvas_h);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn render_precomp(
    assets: &std::collections::HashMap<String, std::sync::Arc<Vec<ParsedLayer>>>,
    ctx: &mut FrameCtx,
    dst: &mut PixBuf,
    layer: &ParsedLayer,
    frame: f64,
    m: Mat3,
    opacity: f64,
    blend: Blend,
    canvas_w: u32,
    canvas_h: u32,
) {
    let t0c = prof::now();
    let children = match assets_of(assets, layer.ref_id.as_deref()) {
        Some(c) => c,
        None => return,
    };
    prof::add(prof::CLONE, t0c);
    let mut mapped_frame = frame - layer.start_time.unwrap_or(0.0);
    mapped_frame = if let Some(stretch) = layer.stretch {
        (mapped_frame / stretch).trunc()
    } else {
        mapped_frame
    };

    let complex = children.len() > 1;
    let direct = blend == Blend::SrcOver && (veq(opacity, 1.0) || !complex);
    let child_alpha = if direct { opacity } else { 1.0 };

    let clip = match (layer.layer_width, layer.layer_height) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => {
            let (x0, y0) = mat_apply(m, 0.0, 0.0);
            let (x1, y1) = mat_apply(m, w, 0.0);
            let (x2, y2) = mat_apply(m, w, h);
            let (x3, y3) = mat_apply(m, 0.0, h);
            Some([
                [x0 as f32, y0 as f32],
                [x1 as f32, y1 as f32],
                [x2 as f32, y2 as f32],
                [x3 as f32, y3 as f32],
            ])
        }
        _ => None,
    };
    if let Some(q) = clip {
        crate::rast::clip_push(q);
    }
    if direct {
        render_comp(ctx, assets, dst, &children, mapped_frame, m, child_alpha, canvas_w, canvas_h);
        if clip.is_some() {
            crate::rast::clip_pop();
        }
        return;
    }
    let mut buf = ctx.take(canvas_w, canvas_h);
    render_comp(ctx, assets, &mut buf, &children, mapped_frame, m, 1.0, canvas_w, canvas_h);
    if clip.is_some() {
        crate::rast::clip_pop();
    }
    let t0 = prof::now();
    rast::blit(&buf, dst, blend, opacity);
    prof::add(prof::BLIT, t0);
    ctx.give(buf);
}

fn mask_cmds(raw: &JsonValue) -> PathCmds {
    let t0 = prof::now();
    let out = mask_cmds_impl(raw);
    prof::add(prof::SHAPE, t0);
    out
}

fn mask_cmds_impl(raw: &JsonValue) -> PathCmds {
    if raw.is_null() || raw.is_string() {
        return Vec::new();
    }
    let entries: Vec<&JsonValue> = if let JsonValue::Array(a) = raw {
        a.iter().filter(|it| it.is_object()).collect()
    } else {
        vec![raw]
    };
    let mut out: PathCmds = Vec::new();
    for ct in entries {
        let varr = match ct.get("v").and_then(|v| v.as_array()) {
            Some(v) if !v.is_empty() => v,
            _ => continue,
        };
        let iarr = ct.get("i").and_then(|v| v.as_array());
        let oarr = ct.get("o").and_then(|v| v.as_array());
        let closed = match ct.get("c") {
            Some(JsonValue::Bool(b)) => *b,
            _ => true,
        };
        let mut verts: Vec<Vert> = Vec::new();
        for (j, vv) in varr.iter().enumerate() {
            let arr2 = |x: Option<&JsonValue>, idx: usize| -> [f64; 2] {
                match x {
                    Some(v) => [
                        num_elem(v, idx).unwrap_or(0.0),
                        num_elem(v, idx + 1).unwrap_or(0.0),
                    ],
                    None => [0.0, 0.0],
                }
            };
            verts.push(Vert { v: arr2(Some(vv), 0), i: arr2(iarr.as_ref().and_then(|a| a.get(j)), 0), o: arr2(oarr.as_ref().and_then(|a| a.get(j)), 0) });
        }
        out.extend(verts_to_cmds(&verts, closed));
    }
    out
}

fn parse_hex_color(s: &str) -> Option<Rgba> {
    let m = s.trim().trim_start_matches('#');
    if m.len() != 6 {
        return None;
    }
    let n = u32::from_str_radix(m, 16).ok()?;
    Some(Rgba((n >> 16 & 0xff) as f64 / 255.0, (n >> 8 & 0xff) as f64 / 255.0, (n & 0xff) as f64 / 255.0, 1.0))
}



#[doc(hidden)]
pub fn debug_layers(anim: &ParsedAnimation, frame: f64) -> String {
    let mut out = String::new();
    fn dump_shape(s: &ParsedShape, depth: usize, frame: f64, out: &mut String) {
        let pad = "  ".repeat(depth);
        let extra = if s.shape_type.as_str() == "trim" {
            format!(
                " s={:.2} e={:.2} o={:.2} mode={:?}",
                prop_num(s.start.as_ref(), frame, 0.0),
                prop_num(s.end.as_ref(), frame, 100.0),
                prop_num(s.offset.as_ref(), frame, 0.0),
                s.trim_mode
            )
        } else if s.shape_type.as_str() == "stroke" || s.shape_type.as_str() == "gradientStroke" {
            format!(
                " op={:.2} w={:.2} cap={:?} join={:?} ml={:?} dash={:?}",
                prop_num(s.opacity.as_ref(), frame, 100.0),
                prop_num(s.stroke_width.as_ref(), frame, 0.0),
                s.line_cap,
                s.line_join,
                s.miter_limit,
                s.dashes.as_ref().map(|d| d.iter().map(|x| (prop_num(Some(&x.value), frame, 0.0) * 100.0).round() / 100.0).collect::<Vec<f64>>())
            )
        } else if s.shape_type.as_str() == "path" {
            let cmds = shape_cmds_impl(s, frame);
            let mut b = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
            let mut n = 0usize;
            if let Some(c) = cmds.as_ref() {
                for p in c {
                    let pts: &[[f64; 2]] = match p {
                        Pc::M(a) => core::slice::from_ref(a),
                        Pc::L(a) => core::slice::from_ref(a),
                        Pc::C(a) => &[[a[0], a[1]], [a[2], a[3]], [a[4], a[5]]],
                        Pc::Z => &[],
                    };
                    for q in pts {
                        n += 1;
                        b.0 = b.0.min(q[0]);
                        b.1 = b.1.min(q[1]);
                        b.2 = b.2.max(q[0]);
                        b.3 = b.3.max(q[1]);
                    }
                }
            }
            let kf = s.vertices.as_ref().and_then(|p| p.keyframes.as_ref()).map(|k| {
                k.iter()
                    .map(|f| {
                        format!(
                            "{:.1}/{}/{}/{}",
                            f.t,
                            f.end_frame.map(|v| format!("{:.1}", v)).unwrap_or_else(|| "-".to_string()),
                            if f.o.is_some() || f.i.is_some() { "e" } else { "-" },
                            if f.hold { "h" } else { "-" }
                        )
                    })
                    .collect::<Vec<String>>()
                    .join(",")
            }).unwrap_or_default();
            let edv = match s.vertices.as_ref() {
                Some(p) => {
                    let (n, d) = crate::keyframes::end_value_diff(p);
                    format!("{}/{}", n, d)
                }
                None => "-".to_string(),
            };
            let pr = match s.vertices.as_ref().and_then(|p| crate::keyframes::debug_progress(p, frame)) {
                Some((t, e, raw, prog, comps, oi)) => match comps {
                    Some(c) => format!(
                        " t={:.3} end={:.3} raw={:.6} eased={:.6} cb={:.3},{:.3},{:.3},{:.3}{}",
                        t, e, raw, prog, c.x1, c.y1, c.x2, c.y2, oi
                    ),
                    None => format!(" t={:.3} end={:.3} raw={:.6} eased={:.6} cb=none{}", t, e, raw, prog, oi),
                },
                None => String::new(),
            };
            format!(
                " op={:.2} n={} bbox={:.1},{:.1}..{:.1},{:.1} anim={} edv={}{} kf={}",
                prop_num(s.opacity.as_ref(), frame, 100.0),
                n,
                b.0,
                b.1,
                b.2,
                b.3,
                s.vertices.as_ref().map_or(false, |p| p.animated),
                edv,
                pr,
                kf
            )
        } else if s.shape_type.as_str() == "transform" {
            let ed = |p: Option<&ParsedProperty>| match p {
                Some(p) => {
                    let (n, d) = crate::keyframes::end_value_diff(p);
                    format!("{}/{}", n, d)
                }
                None => "-".to_string(),
            };
            let anc = prop_pair(s.anchor.as_ref(), frame, [0.0, 0.0]);
            let pos = prop_pair(s.position.as_ref(), frame, [0.0, 0.0]);
            let sc = prop_pair(s.scale.as_ref(), frame, [100.0, 100.0]);
            let rot = prop_num(s.rotation.as_ref(), frame, 0.0);
            format!(
                " op={:.2} anc={:.3},{:.3} pos={:.3},{:.3} sc={:.3},{:.3} rot={:.3} eda={} eds={} edp={} edr={}",
                prop_num(s.opacity.as_ref(), frame, 100.0),
                anc[0], anc[1], pos[0], pos[1], sc[0], sc[1], rot,
                ed(s.anchor.as_ref()), ed(s.scale.as_ref()), ed(s.position.as_ref()), ed(s.rotation.as_ref())
            )
        } else {
            format!(" op={:.2}", prop_num(s.opacity.as_ref(), frame, 100.0))
        };
        out.push_str(&format!(
            "{}shape {} name={}{}\n",
            pad,
            s.shape_type.as_str(),
            s.name.as_deref().unwrap_or("-"),
            extra
        ));
        if let Some(ch) = s.children.as_deref() {
            for c in ch {
                dump_shape(c, depth + 1, frame, out);
            }
        }
    }
    fn dump_layer(l: &ParsedLayer, frame: f64, out: &mut String) {
        out.push_str(&format!(
            "layer idx={:?} ty={:?} name={} in={:?} out={:?} st={:?} stretch={:?} hidden={:?} matte={:?} mt={:?} masks={} op={:.2} ao={:?}\n",
            l.index,
            l.layer_type,
            l.name.as_deref().unwrap_or("-"),
            l.in_frame,
            l.out_frame,
            l.start_time,
            l.stretch,
            l.hidden,
            l.matte_type,
            l.matte_target,
            l.masks.as_ref().map_or(0, |m| m.len()),
            prop_num(l.transform.opacity.as_ref(), frame, 100.0),
            l.auto_orient
        ));
        let anc = prop_pair(l.transform.anchor.as_ref(), frame, [0.0, 0.0]);
        let pos = prop_pair(l.transform.position.as_ref(), frame, [0.0, 0.0]);
        let sc = prop_pair(l.transform.scale.as_ref(), frame, [100.0, 100.0]);
        let rot = prop_num(l.transform.rotation.as_ref(), frame, 0.0);
        let sk = prop_num(l.transform.skew.as_ref(), frame, 0.0);
        let sa = prop_num(l.transform.skew_axis.as_ref(), frame, 0.0);
        let ed = |p: Option<&ParsedProperty>| match p {
            Some(p) => {
                let (n, d) = crate::keyframes::end_value_diff(p);
                format!("{}/{}", n, d)
            }
            None => "-".to_string(),
        };
        out.push_str(&format!(
            "  xf parent={:?} anc={:.3},{:.3} pos={:.3},{:.3} sc={:.3},{:.3} rot={:.3} sk={:.3} sa={:.3} edp={} eds={} edr={} eda={}\n",
            l.parent_index, anc[0], anc[1], pos[0], pos[1], sc[0], sc[1], rot, sk, sa,
            ed(l.transform.position.as_ref()),
            ed(l.transform.scale.as_ref()),
            ed(l.transform.rotation.as_ref()),
            ed(l.transform.anchor.as_ref())
        ));
        if let Some(sh) = l.shapes.as_deref() {
            for s in sh {
                dump_shape(s, 1, frame, out);
            }
        }
    }
    for l in anim.layers.iter() {
        dump_layer(l, frame, &mut out);
    }
    for a in anim.assets.iter() {
        out.push_str(&format!("asset {}\n", a.id.as_deref().unwrap_or("-")));
        if let Some(layers) = a.layers.as_deref() {
            for l in layers.iter() {
                dump_layer(l, frame, &mut out);
            }
        }
    }
    out
}
