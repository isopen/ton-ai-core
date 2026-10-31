use crate::bezier::{bezier_length, bezier_point_at, bezier_t_at_length, CubicBezierSeg};
use crate::easing::{build_easing, easing_value};
use crate::jsutil::{
    is_num_array, js_f64_vec, js_is_object, js_num_value, js_number, js_str, js_truthy, unwrap_value,
};
use crate::keypath::get_override;
use crate::types::{BezierEasingDef, CubicBezierEasing, ParsedKeyframe, ParsedProperty};
use serde_json::Value as JsonValue;

fn key_time_of(raw: &JsonValue) -> f64 {
    let t = match raw.get("t") {
        Some(JsonValue::Array(a)) => a.first(),
        other => other,
    };
    match t {
        Some(JsonValue::Number(n)) => n.as_f64().unwrap_or(f64::INFINITY),
        _ => f64::INFINITY,
    }
}

fn key_time_exact(raw: &JsonValue) -> Option<f64> {
    match raw.get("t") {
        Some(JsonValue::Array(a)) if !a.is_empty() => match &a[0] {
            JsonValue::Number(n) => n.as_f64(),
            _ => None,
        },
        Some(JsonValue::Number(n)) => n.as_f64(),
        _ => None,
    }
}

fn bezier_def(v: Option<&JsonValue>) -> Option<BezierEasingDef> {
    let obj = match v {
        Some(o) if o.is_object() => o,
        _ => return None,
    };
    let x = obj.get("x").and_then(|a| a.as_array()).map(|a| a.iter().map(js_number).collect());
    let y = obj.get("y").and_then(|a| a.as_array()).map(|a| a.iter().map(js_number).collect());
    Some(BezierEasingDef { x, y })
}

fn bezier_def_pairs(o: Option<&JsonValue>, i: Option<&JsonValue>) -> Option<CubicBezierEasing> {
    build_easing(bezier_def(o).as_ref(), bezier_def(i).as_ref())
}

fn build_keyframes(raw_k: Option<&JsonValue>) -> Vec<ParsedKeyframe> {
    let arr = match raw_k {
        Some(JsonValue::Array(a)) => a,
        _ => return Vec::new(),
    };
    let mut ordered: Vec<&JsonValue> = arr.iter().collect();
    ordered.sort_by(|a, b| {
        key_time_of(a)
            .partial_cmp(&key_time_of(b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut keyframes: Vec<ParsedKeyframe> = Vec::new();
    for raw in ordered {
        if !raw.is_object() {
            continue;
        }
        let t = match key_time_exact(raw) {
            Some(t) => t,
            None => continue,
        };
        if let Some(prev) = keyframes.last_mut() {
            prev.end_frame = Some(t);
            if raw.get("s").is_some() && raw.get("e").is_none() {
                prev.e = Some(unwrap_value(raw.get("s").unwrap()));
            }
        }
        let s = match raw.get("s") {
            Some(s) => s,
            None => continue,
        };
        let hold = matches!(raw.get("h"), Some(JsonValue::Number(n)) if n.as_f64() == Some(1.0));
        let s_unwrapped = unwrap_value(s);
        let e = if hold {
            Some(s_unwrapped.clone())
        } else if raw.get("e").is_some() {
            Some(unwrap_value(raw.get("e").unwrap()))
        } else {
            None
        };
        let to = raw
            .get("to")
            .filter(|v| v.is_array())
            .and_then(|v| js_f64_vec(Some(v)));
        let ti = raw
            .get("ti")
            .filter(|v| v.is_array())
            .and_then(|v| js_f64_vec(Some(v)));
        let h = raw
            .get("h")
            .filter(|v| !v.is_null())
            .cloned();
        let n = raw.get("n").filter(|v| !v.is_null()).cloned();
        keyframes.push(ParsedKeyframe {
            t,
            s: s_unwrapped,
            e,
            end_frame: Some(t),
            hold,
            o: bezier_def(raw.get("o")),
            i: bezier_def(raw.get("i")),
            easing: bezier_def_pairs(raw.get("o"), raw.get("i")),
            to,
            ti,
            h,
            n,
        });
    }
    keyframes
}

pub fn parse_value(v: Option<&JsonValue>) -> ParsedProperty {
    let v = match v {
        Some(v) => v,
        None => {
            return ParsedProperty {
                animated: false,
                value: JsonValue::Null,
                ..Default::default()
            }
        }
    };
    if !v.is_object() {
        return ParsedProperty {
            animated: false,
            value: v.clone(),
            ..Default::default()
        };
    }
    let keyframes = build_keyframes(v.get("k"));
    let animated = !keyframes.is_empty();
    let value = if animated {
        keyframes[0].s.clone()
    } else {
        v.get("k").cloned().unwrap_or(JsonValue::Null)
    };
    let mut prop = ParsedProperty {
        animated,
        value,
        keyframes: if animated { Some(keyframes) } else { None },
        ..Default::default()
    };
    if js_truthy(v.get("x")) && js_is_object(v.get("x").unwrap()) {
        prop.x = Some(Box::new(parse_value(v.get("x"))));
    }
    if js_truthy(v.get("y")) && js_is_object(v.get("y").unwrap()) {
        prop.y = Some(Box::new(parse_value(v.get("y"))));
    }
    prop
}

fn lerp_number(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn at_f64(v: &JsonValue, i: usize) -> f64 {
    v.as_array()
        .and_then(|a| a.get(i))
        .map(js_number)
        .unwrap_or(f64::NAN)
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
    let start_len = start.as_array().map(|a| a.len()).unwrap_or(0);
    let end_len = end.as_array().map(|a| a.len()).unwrap_or(0);
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
        JsonValue::Array(vec![js_num_value(pt[0]), js_num_value(pt[1]), js_num_value(z)])
    } else {
        JsonValue::Array(vec![js_num_value(pt[0]), js_num_value(pt[1])])
    }
}

pub fn lerp_value(start: &JsonValue, end: &JsonValue, t: f64) -> JsonValue {
    if let (Some(sa), Some(ea)) = (start.as_f64(), end.as_f64()) {
        return js_num_value(lerp_number(sa, ea, t));
    }
    if is_num_array(start) && is_num_array(end) {
        let sa = start.as_array().unwrap();
        let ea = end.as_array().unwrap();
        let len = sa.len().min(ea.len());
        let out: Vec<JsonValue> = (0..len)
            .map(|i| {
                js_num_value(lerp_number(
                    sa[i].as_f64().unwrap_or(f64::NAN),
                    ea[i].as_f64().unwrap_or(f64::NAN),
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
            return serde_json::json!({ "c": c, "v": v, "i": i, "o": o });
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
        let arr = interp.as_array().unwrap();
        if !arr.is_empty() {
            return arr[0].as_f64();
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
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap_or(f64::NAN))
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

pub fn interpolate_keyframes(property: &ParsedProperty, frame: f64) -> JsonValue {
    if let Some(o) = get_override(property, frame) {
        return o;
    }

    let kfs = match &property.keyframes {
        Some(kfs) if property.animated && !kfs.is_empty() => kfs,
        _ => return resolve_split_dimensions(property, &property.value, frame),
    };

    let first = &kfs[0];
    let last = kfs.last().unwrap();

    if frame <= first.t {
        return resolve_split_dimensions(property, &first.s, frame);
    }
    let last_end = last.end_frame.unwrap_or(last.t);
    if frame >= last_end {
        return resolve_split_dimensions(property, last.e.as_ref().unwrap_or(&last.s), frame);
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
                || matches!(&kf.h, Some(JsonValue::Number(v)) if v.as_f64() == Some(1.0));
            if hold {
                return kf.s.clone();
            }
            let start_val = &kf.s;

            let end_val = if kf.e.is_some() && next.map(|n| n.e.is_some()).unwrap_or(false) {
                kf.e.clone().unwrap()
            } else if next.is_some() {
                next.unwrap().s.clone()
            } else {
                kf.e.clone().unwrap_or_else(|| kf.s.clone())
            };
            let diff = end - kf.t;
            let duration = if diff.is_nan() {
                f64::NAN
            } else {
                diff.max(1e-6)
            };
            let mut progress = clamp01((frame - kf.t) / duration);

            let mut easing = kf.easing;
            if easing.is_none() && (kf.o.is_some() || kf.i.is_some()) {
                easing = build_easing(kf.o.as_ref(), kf.i.as_ref());
            }
            if let Some(e) = easing {
                progress = easing_value(e, progress);
            }

            let result = if kf.to.is_some()
                && kf.ti.is_some()
                && is_num_array(start_val)
                && is_num_array(&end_val)
            {
                lerp_position(start_val, &end_val, kf.to.as_ref().unwrap(), kf.ti.as_ref().unwrap(), progress)
            } else {
                lerp_value(start_val, &end_val, progress)
            };
            return resolve_split_dimensions(property, &result, frame);
        }
    }

    resolve_split_dimensions(property, last.e.as_ref().unwrap_or(&last.s), frame)
}
