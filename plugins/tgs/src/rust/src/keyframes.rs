use crate::bezier::{bezier_length, bezier_point_at, bezier_t_at_length, CubicBezierSeg};
use crate::easing::{build_easing, easing_value, CubicBezier};
use crate::jsutil::{
    is_num_array, js_is_object, js_num_value, js_number, js_truthy, unwrap_value_owned,
};
use crate::keypath::get_override;
use crate::types::{BezierEasingDef, ParsedKeyframe, ParsedProperty, ParsedPropertyData};
use crate::json::Value as JsonValue;

fn key_time_of(raw: &JsonValue) -> f64 {
    let t = match raw.get("t") {
        Some(v) if v.is_array() => v.arr_first_num(),
        Some(JsonValue::Number(n)) => Some(*n),
        _ => None,
    };
    match t {
        Some(n) => n,
        None => f64::INFINITY,
    }
}

fn key_time_exact(raw: &JsonValue) -> Option<f64> {
    match raw.get("t") {
        Some(v) if v.is_array() => v.arr_first_num(),
        Some(JsonValue::Number(n)) => Some(*n),
        _ => None,
    }
}

fn owned_f64_vec(v: JsonValue) -> Option<Vec<f64>> {
    match v {
        JsonValue::Nums(n) => Some(n.iter().collect()),
        JsonValue::Array(a) => Some(a.iter().map(js_number).collect()),
        _ => None,
    }
}

fn owned_first_f64(v: JsonValue) -> Option<f64> {
    match v {
        JsonValue::Number(n) => Some(n),
        JsonValue::Nums(n) => n.first(),
        JsonValue::Array(a) => a.first().map(crate::jsutil::js_number),
        JsonValue::String(_) | JsonValue::Bool(_) => Some(crate::jsutil::js_number(&v)),
        _ => None,
    }
}

fn bezier_def_owned(v: Option<JsonValue>) -> Option<BezierEasingDef> {
    let mut obj = match v {
        Some(o) if o.is_object() => o,
        _ => return None,
    };
    let x = obj.take("x").and_then(owned_first_f64);
    let y = obj.take("y").and_then(owned_first_f64);
    Some(BezierEasingDef { x, y })
}

fn is_keyframe(raw: &JsonValue) -> bool {
    raw.is_object() && key_time_exact(raw).is_some() && raw.get("s").is_some()
}

fn build_keyframes_owned(items: Vec<JsonValue>) -> Vec<ParsedKeyframe> {
    let mut ordered: Vec<(f64, JsonValue)> = items.into_iter().map(|v| (key_time_of(&v), v)).collect();
    if !ordered.windows(2).all(|w| !(w[0].0 > w[1].0)) {
        ordered.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    }
    let mut keyframes: Vec<ParsedKeyframe> = Vec::with_capacity(ordered.len());
    for (_, mut raw) in ordered {
        if !raw.is_object() {
            continue;
        }
        let t = match key_time_exact(&raw) {
            Some(t) => t,
            None => continue,
        };
        let s_val = raw.take("s");
        if let Some(prev) = keyframes.last_mut() {
            prev.end_frame = Some(t);
        }
        let s = match s_val {
            Some(s) => s,
            None => continue,
        };
        let hold = matches!(raw.get("h"), Some(JsonValue::Number(n)) if *n == 1.0);
        let s_unwrapped = unwrap_value_owned(s);
        let e = raw.take("e").map(unwrap_value_owned);
        let to = raw.take("to").and_then(owned_f64_vec);
        let ti = raw.take("ti").and_then(owned_f64_vec);
        let h = raw.take("h").filter(|v| !v.is_null());
        let n = raw.take("n").filter(|v| !v.is_null());
        let o = bezier_def_owned(raw.take("o"));
        let i = bezier_def_owned(raw.take("i"));
        let easing = build_easing(o.as_ref(), i.as_ref());
        let easing_curve = easing.map(|e| Box::new(CubicBezier::from_easing(e)));
        keyframes.push(ParsedKeyframe {
            t,
            s: s_unwrapped,
            e,
            end_frame: Some(t),
            hold,
            o,
            i,
            easing,
            easing_curve,
            to,
            ti,
            h,
            n,
        });
    }
    keyframes
}

pub(crate) fn keyframe_end<'a>(kfs: &'a [ParsedKeyframe], i: usize) -> Option<&'a JsonValue> {
    let kf = kfs.get(i)?;
    let own = if kf.hold { Some(&kf.s) } else { kf.e.as_ref() };
    match kfs.get(i + 1) {
        Some(next) => {
            if next.e.is_some() {
                own
            } else {
                Some(&next.s)
            }
        }
        None => own,
    }
}

pub(crate) fn property_from_k(k: Option<JsonValue>) -> ParsedProperty {
    match k {
        Some(JsonValue::Array(items)) if items.iter().any(is_keyframe) => {
            let keyframes = build_keyframes_owned(items);
            let value = keyframes[0].s.clone();
            ParsedProperty::new(ParsedPropertyData {
                animated: true,
                value,
                keyframes: Some(keyframes),
                ..Default::default()
            })
        }
        other => ParsedProperty::new(ParsedPropertyData {
            animated: false,
            value: other.unwrap_or(JsonValue::Null),
            ..Default::default()
        }),
    }
}

pub fn parse_value(v: Option<&JsonValue>) -> ParsedProperty {
    parse_value_owned(v.cloned())
}

pub fn parse_value_owned(v: Option<JsonValue>) -> ParsedProperty {
    let mut v = match v {
        Some(v) => v,
        None => {
            return ParsedProperty::new(ParsedPropertyData {
                animated: false,
                value: JsonValue::Null,
                ..Default::default()
            });
        }
    };
    if !v.is_object() {
        return ParsedProperty::new(ParsedPropertyData {
            animated: false,
            value: v,
            ..Default::default()
        });
    }
    let mut prop = property_from_k(v.take("k"));
    if js_truthy(v.get("x")) && js_is_object(v.get("x").unwrap()) {
        prop.x = Some(Box::new(parse_value_owned(v.take("x"))));
    }
    if js_truthy(v.get("y")) && js_is_object(v.get("y").unwrap()) {
        prop.y = Some(Box::new(parse_value_owned(v.take("y"))));
    }
    prop
}

pub(crate) fn lerp_number(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn at_f64(v: &JsonValue, i: usize) -> f64 {
    match v {
        JsonValue::Nums(n) => n.get(i).unwrap_or(f64::NAN),
        JsonValue::Array(a) => a.get(i).map(js_number).unwrap_or(f64::NAN),
        _ => f64::NAN,
    }
}

fn num_or_zero(v: f64) -> f64 {
    if v.is_finite() {
        v
    } else {
        0.0
    }
}

fn lerp_position(start: &JsonValue, end: &JsonValue, to: &[f64], ti: &[f64], t: f64) -> JsonValue {
    let tangent = |tangents: &[f64], i: usize| -> f64 {
        tangents
            .get(i)
            .copied()
            .unwrap_or(f64::NAN)
    };
    let seg = CubicBezierSeg {
        p0: [at_f64(start, 0), at_f64(start, 1)],
        p1: [at_f64(start, 0) + tangent(to, 0), at_f64(start, 1) + tangent(to, 1)],
        p2: [at_f64(end, 0) + tangent(ti, 0), at_f64(end, 1) + tangent(ti, 1)],
        p3: [at_f64(end, 0), at_f64(end, 1)],
    };
    let len = bezier_length(&seg);
    let start_len = start.arr_len().unwrap_or(0);
    let end_len = end.arr_len().unwrap_or(0);
    let has_z = start_len > 2 || end_len > 2;
    if len < 1e-6 {
        let bx = lerp_number(at_f64(start, 0), at_f64(end, 0), t);
        let by = lerp_number(at_f64(start, 1), at_f64(end, 1), t);
        return if has_z {
            let z = lerp_number(num_or_zero(at_f64(start, 2)), num_or_zero(at_f64(end, 2)), t);
            JsonValue::Array(vec![js_num_value(bx), js_num_value(by), js_num_value(z)])
        } else {
            JsonValue::Array(vec![js_num_value(bx), js_num_value(by)])
        };
    }
    let tt = bezier_t_at_length(&seg, t * len, len);
    let pt = bezier_point_at(&seg, tt);
    if has_z {
        let z = lerp_number(num_or_zero(at_f64(start, 2)), num_or_zero(at_f64(end, 2)), t);
        if pt[0].is_finite() && pt[1].is_finite() && z.is_finite() {
            return JsonValue::Nums(crate::json::Nums::of3(pt[0], pt[1], z));
        }
        JsonValue::Array(vec![js_num_value(pt[0]), js_num_value(pt[1]), js_num_value(z)])
    } else {
        if pt[0].is_finite() && pt[1].is_finite() {
            return JsonValue::Nums(crate::json::Nums::of2(pt[0], pt[1]));
        }
        JsonValue::Array(vec![js_num_value(pt[0]), js_num_value(pt[1])])
    }
}

pub fn lerp_value(start: &JsonValue, end: &JsonValue, t: f64) -> JsonValue {
    if let (Some(sa), Some(ea)) = (start.as_f64(), end.as_f64()) {
        return js_num_value(lerp_number(sa, ea, t));
    }
    if is_num_array(start) && is_num_array(end) {
        let len = start.arr_len().unwrap_or(0).min(end.arr_len().unwrap_or(0));
        if len == 2 || len == 3 {
            let v0 = lerp_number(at_f64(start, 0), at_f64(end, 0), t);
            let v1 = lerp_number(at_f64(start, 1), at_f64(end, 1), t);
            if len == 2 {
                if v0.is_finite() && v1.is_finite() {
                    return JsonValue::Nums(crate::json::Nums::of2(v0, v1));
                }
            } else {
                let v2 = lerp_number(at_f64(start, 2), at_f64(end, 2), t);
                if v0.is_finite() && v1.is_finite() && v2.is_finite() {
                    return JsonValue::Nums(crate::json::Nums::of3(v0, v1, v2));
                }
            }
        }
        let out: Vec<JsonValue> = (0..len)
            .map(|i| {
                js_num_value(lerp_number(
                    at_f64(start, i),
                    at_f64(end, i),
                    t,
                ))
            })
            .collect();
        return JsonValue::Array(out);
    }
    if start.is_object() && end.is_object() {
        let start_v = start.get("v").filter(|v| v.is_array());
        let end_v = end.get("v").filter(|v| v.is_array());
        if let (Some(start_v), Some(end_v)) = (start_v, end_v) {
            let c = end
                .get("c")
                .cloned()
                .or_else(|| start.get("c").cloned())
                .unwrap_or(JsonValue::Null);
            let v = lerp_value_array(Some(start_v), Some(end_v), t);
            let i = lerp_value_array(start.get("i"), end.get("i"), t);
            let o = lerp_value_array(start.get("o"), end.get("o"), t);
            let mut m = crate::json::Map::new();
            m.insert("c".to_string(), c);
            m.insert("v".to_string(), JsonValue::Array(v));
            m.insert("i".to_string(), JsonValue::Array(i));
            m.insert("o".to_string(), JsonValue::Array(o));
            return JsonValue::Object(m);
        }
    }
    if t >= 0.5 {
        end.clone()
    } else {
        start.clone()
    }
}

fn lerp_value_array(a: Option<&JsonValue>, b: Option<&JsonValue>, t: f64) -> Vec<JsonValue> {
    let mut out: Vec<JsonValue> = Vec::new();
    if let (Some(na), Some(nb)) = (a.and_then(|x| x.as_nums()), b.and_then(|x| x.as_nums())) {
        let len = na.len().min(nb.len());
        out.reserve(len);
        for idx in 0..len {
            out.push(js_num_value(lerp_number(na.get(idx).unwrap(), nb.get(idx).unwrap(), t)));
        }
        return out;
    }
    if let (Some(aa), Some(bb)) = (a.and_then(|x| x.as_array()), b.and_then(|x| x.as_array())) {
        let len = aa.len().min(bb.len());
        out.reserve(len);
        for idx in 0..len {
            out.push(lerp_value(&aa[idx], &bb[idx], t));
        }
    }
    out
}

fn clamp01(v: f64) -> f64 {
    if v < 0.0 {
        0.0
    } else if v > 1.0 {
        1.0
    } else {
        v
    }
}

fn axis_interpolate(interp: &JsonValue) -> Option<f64> {
    if is_num_array(interp) {
        if interp.arr_len().unwrap_or(0) > 0 {
            return interp.arr_first_num();
        }
        return None;
    }
    interp.as_f64()
}

fn resolve_split_dimensions(prop: &ParsedProperty, value: &JsonValue, frame: f64) -> JsonValue {
    if prop.x.is_none() && prop.y.is_none() {
        return value.clone();
    }
    let mut base: Vec<f64> = if is_num_array(value) {
        (0..value.arr_len().unwrap_or(0))
            .map(|i| value.arr_at(i).unwrap_or(f64::NAN))
            .collect()
    } else {
        vec![0.0, 0.0]
    };
    while base.len() < 2 {
        base.push(0.0);
    }
    if let Some(x) = &prop.x {
        let xv = interpolate_keyframes(x, frame);
        if let Some(x0) = axis_interpolate(&xv) {
            base[0] = x0;
        }
    }
    if let Some(y) = &prop.y {
        let yv = interpolate_keyframes(y, frame);
        if let Some(y0) = axis_interpolate(&yv) {
            base[1] = y0;
        }
    }
    JsonValue::Array(base.into_iter().map(js_num_value).collect())
}


fn val_num(v: &JsonValue) -> Option<f64> {
    match v {
        JsonValue::Number(n) => Some(*n),
        JsonValue::Nums(n) => match n.first() {
            Some(x) => Some(x),
            None => Some(0.0),
        },
        JsonValue::Array(a) => match a.first() {
            Some(JsonValue::Number(n)) => Some(*n),
            None => Some(0.0),
            _ => None,
        },
        _ => None,
    }
}

fn interp_num_core(prop: &ParsedProperty, frame: f64) -> Option<f64> {
    let kfs = prop.keyframes.as_ref().filter(|k| prop.animated && !k.is_empty())?;
    let first = kfs.first()?;
    let last = kfs.last()?;
    if frame <= first.t {
        return val_num(&first.s);
    }
    let last_end = last.end_frame.unwrap_or(last.t);
    if frame >= last_end {
        return val_num(last.e.as_ref().unwrap_or(&last.s));
    }
    let mut lo: isize = 0;
    let mut hi: isize = kfs.len() as isize - 1;
    while lo <= hi {
        let mid = (lo + hi) >> 1;
        let kf = &kfs[mid as usize];
        let next = kfs.get(mid as usize + 1);
        let end = kf
            .end_frame
            .unwrap_or_else(|| next.map(|n| n.t).unwrap_or(kf.t));
        if frame < kf.t {
            hi = mid - 1;
        } else if frame >= end {
            lo = mid + 1;
        } else {
            let hold = kf.hold || matches!(&kf.h, Some(JsonValue::Number(v)) if *v == 1.0);
            if hold {
                return val_num(&kf.s);
            }
            if kf.to.is_some() || kf.ti.is_some() {
                return None;
            }
            let start_val = &kf.s;
            let end_val: &JsonValue = if kf.e.is_some() && next.map(|n| n.e.is_some()).unwrap_or(false) {
                kf.e.as_ref().unwrap()
            } else if let Some(n) = next {
                &n.s
            } else {
                kf.e.as_ref().unwrap_or(&kf.s)
            };
            let (sv, ev) = match (val_num(start_val), val_num(end_val)) {
                (Some(sv), Some(ev)) => (sv, ev),
                _ => return None,
            };
            let diff = end - kf.t;
            let duration = if diff.is_nan() { f64::NAN } else { diff.max(1e-6) };
            let mut progress = clamp01((frame - kf.t) / duration);
            if let Some(curve) = kf.easing_curve.as_deref() {
                progress = curve.value(progress);
            } else if kf.o.is_some() || kf.i.is_some() {
                if let Some(e) = build_easing(kf.o.as_ref(), kf.i.as_ref()) {
                    progress = easing_value(e, progress);
                }
            }
            return Some(lerp_number(sv, ev, progress));
        }
    }
    val_num(last.e.as_ref().unwrap_or(&last.s))
}

pub fn interp_num(prop: &ParsedProperty, frame: f64) -> Option<f64> {
    if prop.override_value.is_some() {
        return None;
    }
    if prop.x.is_none() && prop.y.is_none() {
        return interp_num_core(prop, frame);
    }
    let (mut b0, mut b1) = match &prop.value {
        JsonValue::Array(a) => {
            let g = |i: usize| a.get(i).and_then(|v| v.as_f64()).unwrap_or(0.0);
            (g(0), g(1))
        }
        JsonValue::Nums(n) => (n.get(0).unwrap_or(0.0), n.get(1).unwrap_or(0.0)),
        JsonValue::Number(n) => (*n, 0.0),
        _ => (0.0, 0.0),
    };
    if let Some(x) = &prop.x {
        b0 = interp_num(x, frame)?;
    }
    if let Some(y) = &prop.y {
        b1 = interp_num(y, frame)?;
    }
    let _ = b1;
    Some(b0)
}


pub fn interpolate_keyframes(property: &ParsedProperty, frame: f64) -> JsonValue {
    interpolate_keyframes_cow(property, frame).into_owned()
}

fn resolve_split_dimensions_cow<'a>(
    prop: &ParsedProperty,
    value: &'a JsonValue,
    frame: f64,
) -> std::borrow::Cow<'a, JsonValue> {
    if prop.x.is_none() && prop.y.is_none() {
        std::borrow::Cow::Borrowed(value)
    } else {
        std::borrow::Cow::Owned(resolve_split_dimensions(prop, value, frame))
    }
}

pub fn interpolate_keyframes_cow<'a>(
    property: &'a ParsedProperty,
    frame: f64,
) -> std::borrow::Cow<'a, JsonValue> {
    if property.override_value.is_some() {
        return std::borrow::Cow::Owned(get_override(property, frame).unwrap_or(JsonValue::Null));
    }

    let kfs = match &property.keyframes {
        Some(kfs) if property.animated && !kfs.is_empty() => kfs,
        _ => return resolve_split_dimensions_cow(property, &property.value, frame),
    };

    let first = &kfs[0];
    let last = kfs.last().unwrap();

    if frame <= first.t {
        return resolve_split_dimensions_cow(property, &first.s, frame);
    }
    let last_end = last.end_frame.unwrap_or(last.t);
    if frame >= last_end {
        return resolve_split_dimensions_cow(property, last.e.as_ref().unwrap_or(&last.s), frame);
    }

    let mut lo: isize = 0;
    let mut hi: isize = kfs.len() as isize - 1;
    while lo <= hi {
        let mid = (lo + hi) >> 1;
        let kf = &kfs[mid as usize];
        let next = kfs.get(mid as usize + 1);
        let end = kf
            .end_frame
            .unwrap_or_else(|| next.map(|n| n.t).unwrap_or(kf.t));
        if frame < kf.t {
            hi = mid - 1;
        } else if frame >= end {
            lo = mid + 1;
        } else {
            let hold = kf.hold
                || matches!(&kf.h, Some(JsonValue::Number(v)) if *v == 1.0);
            if hold {
                return std::borrow::Cow::Borrowed(&kf.s);
            }
            let start_val = &kf.s;

            let end_val: &JsonValue = if kf.e.is_some() && next.map(|n| n.e.is_some()).unwrap_or(false) {
                kf.e.as_ref().unwrap()
            } else if let Some(n) = next {
                &n.s
            } else {
                kf.e.as_ref().unwrap_or(&kf.s)
            };
            let diff = end - kf.t;
            let duration = if diff.is_nan() {
                f64::NAN
            } else {
                diff.max(1e-6)
            };
            let mut progress = clamp01((frame - kf.t) / duration);

            if let Some(curve) = kf.easing_curve.as_deref() {
                progress = curve.value(progress);
            } else if kf.o.is_some() || kf.i.is_some() {
                if let Some(e) = build_easing(kf.o.as_ref(), kf.i.as_ref()) {
                    progress = easing_value(e, progress);
                }
            }

            let result = if kf.to.is_some()
                && kf.ti.is_some()
                && is_num_array(start_val)
                && is_num_array(end_val)
            {
                lerp_position(start_val, end_val, kf.to.as_ref().unwrap(), kf.ti.as_ref().unwrap(), progress)
            } else {
                lerp_value(start_val, end_val, progress)
            };
            if property.x.is_none() && property.y.is_none() {
                return std::borrow::Cow::Owned(result);
            }
            return std::borrow::Cow::Owned(resolve_split_dimensions(property, &result, frame));
        }
    }

    resolve_split_dimensions_cow(property, last.e.as_ref().unwrap_or(&last.s), frame)
}

#[doc(hidden)]
pub fn end_value_diff(prop: &ParsedProperty) -> (usize, f64) {
    fn walk(a: &JsonValue, b: &JsonValue, d: &mut f64) {
        match (a, b) {
            (JsonValue::Number(x), JsonValue::Number(y)) => {
                let v = (x - y).abs();
                if v > *d {
                    *d = v;
                }
            }
            (JsonValue::Nums(x), JsonValue::Nums(y)) => {
                for (p, q) in x.iter().zip(y.iter()) {
                    let v = (p - q).abs();
                    if v > *d {
                        *d = v;
                    }
                }
            }
            (JsonValue::Array(x), JsonValue::Array(y)) => {
                for (p, q) in x.iter().zip(y.iter()) {
                    walk(p, q, d);
                }
            }
            (JsonValue::Object(x), JsonValue::Object(y)) => {
                for (k, v) in x.iter() {
                    if let Some(w) = y.get(k) {
                        walk(v, w, d);
                    }
                }
            }
            _ => {}
        }
    }
    let mut n = 0usize;
    let mut d = 0.0f64;
    if let Some(kfs) = prop.keyframes.as_ref() {
        for i in 0..kfs.len().saturating_sub(1) {
            if let Some(e) = kfs[i].e.as_ref() {
                n += 1;
                walk(e, &kfs[i + 1].s, &mut d);
            }
        }
    }
    (n, d)
}

#[doc(hidden)]
pub fn debug_progress(prop: &ParsedProperty, frame: f64) -> Option<(f64, f64, f64, f64, Option<crate::types::CubicBezierEasing>, String)> {
    let kfs = prop.keyframes.as_ref()?;
    if !prop.animated || kfs.is_empty() {
        return None;
    }
    let first = &kfs[0];
    let last = kfs.last().unwrap();
    if frame <= first.t {
        return None;
    }
    let last_end = last.end_frame.unwrap_or(last.t);
    if frame >= last_end {
        return None;
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
            let diff = end - kf.t;
            let duration = diff.max(1e-6);
            let raw = clamp01((frame - kf.t) / duration);
            let mut progress = raw;
            let mut comps = kf.easing;
            let raw_oi = format!(" o={:?} i={:?}", kf.o, kf.i);
            if let Some(curve) = kf.easing_curve.as_deref() {
                progress = curve.value(progress);
            } else if kf.o.is_some() || kf.i.is_some() {
                if let Some(e) = build_easing(kf.o.as_ref(), kf.i.as_ref()) {
                    comps = Some(e);
                    progress = easing_value(e, progress);
                }
            }
            return Some((kf.t, end, raw, progress, comps, raw_oi));
        }
    }
    None
}
