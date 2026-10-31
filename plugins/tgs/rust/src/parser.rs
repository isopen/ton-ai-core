use crate::jsutil::{
    js_is_object, js_number, js_number_of, js_opt_str, js_str, js_strict_eq, js_strict_number, js_truthy,
};
use crate::types::{
    FillRule, GradientType, LayerInfo, LayerType, MatteType, MaskMode, ParsedAnimation, ParsedAsset, ParsedDash,
    ParsedGradient, ParsedLayer, ParsedMarker, ParsedMask, ParsedShape, ParsedText, ParsedTextKeyframe,
    ParsedTransform, TrimMode,
};
use serde_json::Value as JsonValue;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

pub type ParseError = crate::TgsError;

#[derive(Clone)]
pub struct ParseOptions {
    pub key: Option<String>,
    pub cache: bool,
}

const DEFAULT_CACHE_SIZE: f64 = 10.0;

struct ModelCache {
    size: f64,
    map: HashMap<String, ParsedAnimation>,
    order: VecDeque<String>,
}

fn model_cache() -> &'static Mutex<ModelCache> {
    static CACHE: OnceLock<Mutex<ModelCache>> = OnceLock::new();
    CACHE.get_or_init(|| {
        Mutex::new(ModelCache {
            size: DEFAULT_CACHE_SIZE,
            map: HashMap::new(),
            order: VecDeque::new(),
        })
    })
}

pub fn configure_model_cache_size(size: f64) {
    let mut guard = model_cache().lock().unwrap();
    guard.size = if size > 0.0 { size } else { 0.0 };
    if guard.size == 0.0 {
        guard.map.clear();
        guard.order.clear();
    }
}

fn cache_touch(guard: &mut ModelCache, key: &str) -> Option<ParsedAnimation> {
    let existing = guard.map.get(key)?.clone();
    guard.map.remove(key);
    guard.order.retain(|k| k != key);
    guard.map.insert(key.to_string(), existing.clone());
    guard.order.push_back(key.to_string());
    Some(existing)
}

fn cache_get_value(key: &str) -> Option<ParsedAnimation> {
    let guard = model_cache().lock().unwrap();
    guard.map.get(key).cloned()
}

fn cache_put(key: &str, value: ParsedAnimation) {
    let mut guard = model_cache().lock().unwrap();
    let size = guard.size;
    if size <= 0.0 {
        return;
    }
    let _ = cache_touch(&mut guard, key);
    guard.order.retain(|k| k != key);
    guard.order.push_back(key.to_string());
    guard.map.insert(key.to_string(), value);
    while guard.map.len() as f64 > size {
        if let Some(oldest) = guard.order.pop_front() {
            guard.map.remove(&oldest);
        } else {
            break;
        }
    }
}

fn shape_type_name(ty: Option<&JsonValue>) -> String {
    static MAP: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    let map = MAP.get_or_init(|| {
        HashMap::from([
            ("gr", "group"),
            ("rc", "rect"),
            ("el", "ellipse"),
            ("sh", "path"),
            ("fl", "fill"),
            ("sr", "star"),
            ("mm", "merge"),
            ("tm", "trim"),
            ("rp", "repeater"),
            ("gs", "gradientStroke"),
            ("gf", "gradientFill"),
            ("st", "stroke"),
            ("rd", "roundedCorner"),
            ("tr", "transform"),
        ])
    });
    match ty {
        Some(JsonValue::String(raw)) => {
            if let Some(mapped) = map.get(raw.as_str()) {
                mapped.to_string()
            } else {
                raw.clone()
            }
        }
        Some(other) => js_str(other),
        None => String::new(),
    }
}

fn parse_transform(ks: Option<&JsonValue>) -> ParsedTransform {
    static EMPTY: OnceLock<JsonValue> = OnceLock::new();
    let empty = EMPTY.get_or_init(|| serde_json::json!({}));
    let ks = ks.unwrap_or_else(|| empty);
    let mut result = ParsedTransform {
        opacity: Some(parse_value(ks.get("o"))),
        rotation: Some(parse_value(ks.get("r"))),
        position: Some(parse_value(ks.get("p"))),
        anchor: Some(parse_value(ks.get("a"))),
        scale: Some(parse_value(ks.get("s"))),
        skew: None,
        skew_axis: None,
        start_opacity: None,
        end_opacity: None,
    };
    if js_truthy(ks.get("sk")) {
        result.skew = Some(parse_value(ks.get("sk")));
    }
    if js_truthy(ks.get("sa")) {
        result.skew_axis = Some(parse_value(ks.get("sa")));
    }
    if js_truthy(ks.get("so")) {
        result.start_opacity = Some(parse_value(ks.get("so")));
    }
    if js_truthy(ks.get("eo")) {
        result.end_opacity = Some(parse_value(ks.get("eo")));
    }
    result
}

fn parse_gradient_shape(s: &JsonValue) -> ParsedGradient {
    ParsedGradient {
        gradient_type: if matches!(s.get("t"), Some(JsonValue::Number(n)) if n.as_f64() == Some(2.0)) {
            GradientType::Radial
        } else {
            GradientType::Linear
        },
        start_point: parse_value(s.get("s")),
        end_point: parse_value(s.get("e")),
        highlight_length: if js_truthy(s.get("h")) {
            Some(parse_value(s.get("h")))
        } else {
            None
        },
        highlight_angle: if js_truthy(s.get("a")) {
            Some(parse_value(s.get("a")))
        } else {
            None
        },
        color_points: s.get("g").and_then(|g| g.get("p")).and_then(|p| p.as_f64()),
        stops: parse_value(s.get("g").and_then(|g| g.get("k"))),
    }
}

pub fn parse_shape(s: &JsonValue) -> Option<ParsedShape> {
    if !js_is_object(s) {
        return None;
    }
    if js_truthy(s.get("hd")) {
        return None;
    }
    let mut result = ParsedShape {
        shape_type: shape_type_name(s.get("ty")),
        ..Default::default()
    };
    if js_truthy(s.get("nm")) {
        result.name = js_opt_str(s.get("nm"));
    }
    if js_truthy(s.get("mn")) {
        result.match_name = js_opt_str(s.get("mn"));
    }
    if let Some(ix) = s.get("ix").filter(|v| !v.is_null()) {
        result.index = Some(js_number(ix));
    }
    if js_truthy(s.get("it")) {
        if let Some(arr) = s.get("it").and_then(|v| v.as_array()) {
            result.children = Some(arr.iter().filter_map(parse_shape).collect());
        }
    }
    let ty = result.shape_type.clone();
    if ty == "trim" {
        if js_truthy(s.get("s")) {
            result.start = Some(parse_value(s.get("s")));
        }
        if js_truthy(s.get("e")) {
            result.end = Some(parse_value(s.get("e")));
        }
        if js_truthy(s.get("o")) {
            result.offset = Some(parse_value(s.get("o")));
        }
        if let Some(m) = s.get("m").filter(|v| !v.is_null()) {
            result.trim_mode = Some(if js_number(m) == 2.0 {
                TrimMode::Individually
            } else {
                TrimMode::Simultaneously
            });
        }
        return Some(result);
    }
    if ty == "fill" {
        if js_truthy(s.get("c")) {
            result.color = Some(parse_value(s.get("c")));
        }
        if js_truthy(s.get("o")) {
            result.opacity = Some(parse_value(s.get("o")));
        }
        match s.get("r") {
            Some(JsonValue::Number(n)) if n.as_f64() == Some(2.0) => {
                result.fill_rule = Some(FillRule::Evenodd);
            }
            Some(JsonValue::Number(n)) if n.as_f64() == Some(1.0) => {
                result.fill_rule = Some(FillRule::Winding);
            }
            _ => {}
        }
        return Some(result);
    }
    if ty == "stroke" {
        if js_truthy(s.get("c")) {
            result.color = Some(parse_value(s.get("c")));
        }
        if js_truthy(s.get("o")) {
            result.opacity = Some(parse_value(s.get("o")));
        }
        if js_truthy(s.get("w")) {
            result.stroke_width = Some(parse_value(s.get("w")));
        }
        if let Some(v) = s.get("lc").filter(|v| !v.is_null()) {
            result.line_cap = Some(js_number(v));
        }
        if let Some(v) = s.get("lj").filter(|v| !v.is_null()) {
            result.line_join = Some(js_number(v));
        }
        if let Some(v) = s.get("ml").filter(|v| !v.is_null()) {
            result.miter_limit = Some(js_number(v));
        }
        if let Some(JsonValue::Array(dashes)) = s.get("d").filter(|v| js_truthy(Some(v))) {
            result.dashes = Some(
                dashes
                    .iter()
                    .map(|d| ParsedDash {
                        name: js_opt_str(d.get("n")),
                        value: parse_value(d.get("v")),
                    })
                    .collect(),
            );
        }
        return Some(result);
    }
    if ty == "gradientFill" || ty == "gradientStroke" {
        result.gradient = Some(parse_gradient_shape(s));
        if js_truthy(s.get("o")) {
            result.opacity = Some(parse_value(s.get("o")));
        }
        if ty == "gradientStroke" {
            if js_truthy(s.get("w")) {
                result.stroke_width = Some(parse_value(s.get("w")));
            }
            if let Some(v) = s.get("lc").filter(|v| !v.is_null()) {
                result.line_cap = Some(js_number(v));
            }
            if let Some(v) = s.get("lj").filter(|v| !v.is_null()) {
                result.line_join = Some(js_number(v));
            }
            if let Some(v) = s.get("ml").filter(|v| !v.is_null()) {
                result.miter_limit = Some(js_number(v));
            }
            if let Some(JsonValue::Array(dashes)) = s.get("d").filter(|v| js_truthy(Some(v))) {
                result.dashes = Some(
                    dashes
                        .iter()
                        .map(|d| ParsedDash {
                            name: js_opt_str(d.get("n")),
                            value: parse_value(d.get("v")),
                        })
                        .collect(),
                );
            }
        }
        return Some(result);
    }
    if ty == "ellipse" {
        if js_truthy(s.get("p")) {
            result.position = Some(parse_value(s.get("p")));
        }
        if js_truthy(s.get("s")) {
            result.size = Some(parse_value(s.get("s")));
        }
        if let Some(d @ JsonValue::Number(_)) = s.get("d") {
            result.direction = Some(js_number(d));
        }
        return Some(result);
    }
    if ty == "rect" {
        if js_truthy(s.get("p")) {
            result.position = Some(parse_value(s.get("p")));
        }
        if js_truthy(s.get("s")) {
            result.size = Some(parse_value(s.get("s")));
        }
        if js_truthy(s.get("r")) {
            result.radius = Some(parse_value(s.get("r")));
        }
        if let Some(d @ JsonValue::Number(_)) = s.get("d") {
            result.direction = Some(js_number(d));
        }
        if js_truthy(s.get("rd")) {
            result.rd = Some(Box::new(ParsedShape {
                shape_type: "roundedCorner".to_string(),
                radius: Some(parse_value(s.get("rd"))),
                ..Default::default()
            }));
        }
        return Some(result);
    }
    if ty == "roundedCorner" {
        if js_truthy(s.get("r")) {
            result.radius = Some(parse_value(s.get("r")));
        }
        return Some(result);
    }
    if ty == "path" {
        if js_truthy(s.get("ks")) {
            result.vertices = Some(parse_value(s.get("ks")));
        }
        return Some(result);
    }
    if ty == "star" {
        if js_truthy(s.get("p")) {
            result.position = Some(parse_value(s.get("p")));
        }
        if let Some(sy @ JsonValue::Number(_)) = s.get("sy") {
            result.star_type = Some(js_number(sy));
        }
        if js_truthy(s.get("pt")) {
            result.points = Some(parse_value(s.get("pt")));
        }
        if js_truthy(s.get("r")) {
            result.rotation = Some(parse_value(s.get("r")));
        }
        if js_truthy(s.get("or")) {
            result.outer_radius = Some(parse_value(s.get("or")));
        }
        if js_truthy(s.get("ir")) {
            result.inner_radius = Some(parse_value(s.get("ir")));
        }
        if let Some(os) = s.get("os").filter(|v| !v.is_null()) {
            result.outer_roundness = Some(parse_value(Some(os)));
        }
        if let Some(is) = s.get("is").filter(|v| !v.is_null()) {
            result.inner_roundness = Some(parse_value(Some(is)));
        }
        return Some(result);
    }
    if ty == "repeater" {
        if js_truthy(s.get("c")) {
            result.copies = Some(parse_value(s.get("c")));
        }
        if js_truthy(s.get("o")) {
            result.copies_offset = Some(parse_value(s.get("o")));
        }
        if let Some(m @ JsonValue::Number(_)) = s.get("m") {
            result.composite = Some(js_number(m));
        }
        if js_truthy(s.get("tr")) {
            result.transform = Some(parse_transform(s.get("tr")));
        }
        return Some(result);
    }
    if ty == "merge" {
        if let Some(mm @ JsonValue::Number(_)) = s.get("mm") {
            result.merge_mode = Some(js_number(mm));
        }
        return Some(result);
    }
    if ty == "transform" {
        if js_truthy(s.get("p")) {
            result.position = Some(parse_value(s.get("p")));
        }
        if js_truthy(s.get("a")) {
            result.anchor = Some(parse_value(s.get("a")));
        }
        if js_truthy(s.get("s")) {
            result.scale = Some(parse_value(s.get("s")));
        }
        if js_truthy(s.get("r")) {
            result.rotation = Some(parse_value(s.get("r")));
        }
        if js_truthy(s.get("o")) {
            result.opacity = Some(parse_value(s.get("o")));
        }
        return Some(result);
    }
    Some(result)
}

pub fn layer_type_of(ty: Option<&JsonValue>) -> LayerType {
    let key = match ty {
        Some(v) => js_str(v),
        None => return LayerType::Shape,
    };
    match key.as_str() {
        "0" => LayerType::Precomp,
        "1" => LayerType::Solid,
        "2" => LayerType::Image,
        "3" => LayerType::Null,
        "4" => LayerType::Shape,
        "5" => LayerType::Text,
        _ => LayerType::Shape,
    }
}

fn parse_mask(m: &JsonValue) -> ParsedMask {
    let mode_raw = m.get("mode");
    let mode_key = if js_truthy(mode_raw) {
        js_str(mode_raw.unwrap())
    } else {
        "a".to_string()
    };
    let mode = match mode_key.as_str() {
        "s" => MaskMode::Subtract,
        "i" => MaskMode::Intersect,
        "f" => MaskMode::Difference,
        "n" => MaskMode::None,
        "a" => MaskMode::Add,
        _ => MaskMode::None,
    };
    ParsedMask {
        name: js_opt_str(m.get("nm")),
        inverted: matches!(m.get("inv"), Some(JsonValue::Bool(true))),
        mode,
        path: parse_value(m.get("pt")),
        opacity: parse_value(m.get("o")),
        expand: parse_value(m.get("x")),
    }
}

fn parse_text(t: Option<&JsonValue>) -> Option<ParsedText> {
    let kf = t
        .and_then(|tt| tt.get("d"))
        .and_then(|d| d.get("k"))
        .and_then(|k| k.as_array())
        .and_then(|karr| karr.first());
    let s = kf.and_then(|kk| kk.get("s"));
    if !js_truthy(s) {
        return None;
    }
    let s = s.unwrap();
    let mut text = ParsedText {
        text: match s.get("t") {
            Some(v) => js_str(v),
            None => String::new(),
        },
        ..Default::default()
    };
    if let Some(sz) = s.get("s").filter(|v| !v.is_null()) {
        text.font_size = Some(js_number(sz));
    }
    if js_truthy(s.get("f")) {
        text.font_family = js_opt_str(s.get("f"));
    }
    if js_truthy(s.get("fc")) {
        text.fill_color = super::jsutil::js_f64_vec(s.get("fc"));
    }
    if let Some(j) = s.get("j").filter(|v| !v.is_null()) {
        text.justify = Some(js_number(j));
    }
    if let Some(lh) = s.get("lh").filter(|v| !v.is_null()) {
        text.line_height = Some(js_number(lh));
    }
    if let Some(ls) = s.get("ls").filter(|v| !v.is_null()) {
        text.tracking = Some(js_number(ls));
    }
    if js_truthy(s.get("sc")) {
        text.stroke_color = super::jsutil::js_f64_vec(s.get("sc"));
    }
    if let Some(sw) = s.get("sw").filter(|v| !v.is_null()) {
        text.stroke_width = Some(js_number(sw));
    }
    if let Some(list) = t
        .and_then(|tt| tt.get("d"))
        .and_then(|d| d.get("k"))
        .and_then(|k| k.as_array())
    {
        if list.len() > 1 {
            let mut kfs: Vec<ParsedTextKeyframe> = Vec::new();
            for k in list {
                if !js_truthy(Some(k)) {
                    continue;
                }
                if k.get("t").map_or(true, |v| v.is_null()) {
                    continue;
                }
                if !js_truthy(k.get("s")) {
                    continue;
                }
                let ks = k.get("s").unwrap();
                let mut doc = ParsedTextKeyframe {
                    at: js_number_of(k.get("t")),
                    text: match ks.get("t") {
                        Some(v) => js_str(v),
                        None => String::new(),
                    },
                    ..Default::default()
                };
                if let Some(sz) = ks.get("s").filter(|v| !v.is_null()) {
                    doc.font_size = Some(js_number(sz));
                }
                if js_truthy(ks.get("f")) {
                    doc.font_family = js_opt_str(ks.get("f"));
                }
                if js_truthy(ks.get("fc")) {
                    doc.fill_color = super::jsutil::js_f64_vec(ks.get("fc"));
                }
                if let Some(j) = ks.get("j").filter(|v| !v.is_null()) {
                    doc.justify = Some(js_number(j));
                }
                if let Some(lh) = ks.get("lh").filter(|v| !v.is_null()) {
                    doc.line_height = Some(js_number(lh));
                }
                if let Some(ls) = ks.get("ls").filter(|v| !v.is_null()) {
                    doc.tracking = Some(js_number(ls));
                }
                if js_truthy(ks.get("sc")) {
                    doc.stroke_color = super::jsutil::js_f64_vec(ks.get("sc"));
                }
                if let Some(sw) = ks.get("sw").filter(|v| !v.is_null()) {
                    doc.stroke_width = Some(js_number(sw));
                }
                kfs.push(doc);
            }
            kfs.sort_by(|a, b| a.at.partial_cmp(&b.at).unwrap_or(std::cmp::Ordering::Equal));
            if kfs.len() > 1 {
                text.keyframes = Some(kfs);
            }
        }
    }
    Some(text)
}

pub fn parse_layer(l: &JsonValue) -> Option<ParsedLayer> {
    let parent_raw = l.get("parent");
    if parent_raw.map_or(false, |p| !p.is_null()) {
        if js_strict_eq(parent_raw, l.get("ind")) {
            return None;
        }
    }
    let mut result = ParsedLayer {
        index: js_number_of(l.get("ind")),
        layer_type: layer_type_of(l.get("ty")),
        transform: parse_transform(l.get("ks")),
        ..Default::default()
    };
    if js_truthy(l.get("nm")) {
        result.name = js_opt_str(l.get("nm"));
    }
    if l.get("parent").map_or(false, |p| !p.is_null()) {
        result.parent_index = Some(js_number(parent_raw.unwrap()));
    }
    if js_truthy(l.get("refId")) {
        result.ref_id = js_opt_str(l.get("refId"));
    }
    if let Some(v) = l.get("ip").filter(|v| !v.is_null()) {
        result.in_frame = Some(js_number(v));
    }
    if let Some(v) = l.get("op").filter(|v| !v.is_null()) {
        result.out_frame = Some(js_number(v));
    }
    if let Some(v) = l.get("st").filter(|v| !v.is_null()) {
        result.start_time = Some(js_number(v));
    }
    if let Some(v) = l.get("sr").filter(|v| !v.is_null()) {
        result.stretch = Some(js_number(v));
    }
    if let Some(v) = l.get("ao").filter(|v| !v.is_null()) {
        result.auto_orient = Some(js_number(v));
    }
    if js_truthy(l.get("ddd")) {
        result.is3d = Some(true);
    }
    if let Some(v) = l.get("bm").filter(|v| !v.is_null()) {
        result.blend_mode = Some(js_number(v));
    }
    if js_truthy(l.get("sc")) {
        result.solid_color = js_opt_str(l.get("sc"));
    }
    if let Some(v) = l.get("sw").filter(|v| !v.is_null()) {
        result.solid_width = Some(js_number(v));
    }
    if let Some(v) = l.get("sh").filter(|v| !v.is_null()) {
        result.solid_height = Some(js_number(v));
    }
    if let Some(v) = l.get("w").filter(|v| !v.is_null()) {
        result.layer_width = Some(js_number(v));
    }
    if let Some(v) = l.get("h").filter(|v| !v.is_null()) {
        result.layer_height = Some(js_number(v));
    }
    if let Some(tt) = l.get("tt").filter(|v| !v.is_null()) {
        match js_str(tt).as_str() {
            "1" => result.matte_type = Some(MatteType::Alpha),
            "2" => result.matte_type = Some(MatteType::AlphaInv),
            "3" => result.matte_type = Some(MatteType::Luma),
            "4" => result.matte_type = Some(MatteType::LumaInv),
            _ => result.matte_type = Some(MatteType::None),
        }
    }
    if l.get("td").map_or(false, |v| !v.is_null()) {
        result.matte_target = Some(true);
    }
    if js_truthy(l.get("tm")) {
        result.time_remap = Some(parse_value(l.get("tm")));
    }
    if let Some(JsonValue::Array(masks)) = l.get("masksProperties") {
        result.masks = Some(masks.iter().map(parse_mask).collect());
    }
    if js_truthy(l.get("t")) {
        result.text = parse_text(l.get("t"));
    }
    if let Some(JsonValue::Array(shapes)) = l.get("shapes") {
        result.shapes = Some(shapes.iter().filter_map(parse_shape).collect());
    }
    if js_truthy(l.get("hd")) {
        result.layer_type = LayerType::Null;
        result.hidden = Some(true);
        result.shapes = None;
        result.masks = None;
        result.text = None;
        result.ref_id = None;
        result.matte_type = None;
        result.matte_target = None;
    }
    Some(result)
}

pub fn parse_markers(markers: Option<&JsonValue>) -> Option<Vec<ParsedMarker>> {
    let arr = match markers {
        Some(JsonValue::Array(a)) => a,
        _ => return None,
    };
    Some(
        arr.iter()
            .map(|m| {
                let start_frame = js_strict_number(m.get("tm")).unwrap_or(0.0);
                let dr = js_strict_number(m.get("dr")).unwrap_or(0.0);
                ParsedMarker {
                    name: js_opt_str(m.get("cm")),
                    start_frame,
                    end_frame: start_frame + dr,
                }
            })
            .collect(),
    )
}

fn parse_asset(a: &JsonValue) -> ParsedAsset {
    let layers = if js_truthy(a.get("layers")) {
        if let Some(JsonValue::Array(arr)) = a.get("layers") {
            Some(arr.iter().filter_map(parse_layer).collect())
        } else {
            None
        }
    } else {
        None
    };
    ParsedAsset {
        id: js_opt_str(a.get("id")),
        width: a.get("w").filter(|v| !v.is_null()).map(js_number),
        height: a.get("h").filter(|v| !v.is_null()).map(js_number),
        u: js_opt_str(a.get("u")),
        p: js_opt_str(a.get("p")),
        layers,
    }
}

fn truthy_or(v: Option<&JsonValue>, default: f64) -> f64 {
    if js_truthy(v) {
        js_number(v.unwrap())
    } else {
        default
    }
}

fn parse_animation(data: &JsonValue) -> ParsedAnimation {
    let layers: Vec<ParsedLayer> = match data.get("layers") {
        Some(JsonValue::Array(arr)) => arr.iter().filter_map(parse_layer).collect(),
        _ => Vec::new(),
    };
    let assets: Vec<ParsedAsset> = match data.get("assets") {
        Some(JsonValue::Array(arr)) => arr.iter().map(parse_asset).collect(),
        _ => Vec::new(),
    };
    let in_frame = truthy_or(data.get("ip"), 0.0);
    let out_frame = truthy_or(data.get("op"), 0.0);
    ParsedAnimation {
        width: truthy_or(data.get("w"), 512.0),
        height: truthy_or(data.get("h"), 512.0),
        fps: truthy_or(data.get("fr"), 30.0),
        in_frame,
        out_frame,
        duration: (out_frame - in_frame) / truthy_or(data.get("fr"), 30.0),
        layers,
        assets,
        name: js_opt_str(data.get("nm")),
        version: js_opt_str(data.get("v")),
        tgs: matches!(data.get("tgs"), Some(JsonValue::Number(n)) if n.as_f64() == Some(1.0)),
        is3d: matches!(data.get("ddd"), Some(JsonValue::Number(n)) if n.as_f64() == Some(1.0)),
        markers: parse_markers(data.get("markers")),
    }
}

pub fn parse_tgs(json: &str, options: Option<ParseOptions>) -> Result<ParsedAnimation, ParseError> {
    let data: JsonValue = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return Err(crate::TgsError("Invalid TGS JSON".to_string())),
    };
    let layers_ok = data
        .get("layers")
        .map(|l| l.is_array())
        .unwrap_or(false);
    if !layers_ok {
        return Err(crate::TgsError("TGS has no layers".to_string()));
    }
    let opts_key = options
        .as_ref()
        .and_then(|o| o.key.clone())
        .filter(|k| !k.is_empty());
    if let Some(key) = &opts_key {
        if let Some(cached) = cache_get_value(key) {
            return Ok(cached);
        }
    }
    let animation = parse_animation(&data);
    if let Some(key) = &opts_key {
        cache_put(key, animation.clone());
        return Ok(animation.clone());
    }
    Ok(animation)
}

pub fn layer_info(animation: &ParsedAnimation) -> Vec<LayerInfo> {
    animation
        .layers
        .iter()
        .map(|l| LayerInfo {
            name: l.name.clone(),
            in_frame: l.in_frame.unwrap_or(animation.in_frame),
            out_frame: l.out_frame.unwrap_or(animation.out_frame),
        })
        .collect()
}

pub fn frame_at_pos(animation: &ParsedAnimation, pos: f64) -> f64 {
    let pos = if pos.is_finite() { pos } else { 0.0 };
    let total = animation.out_frame - animation.in_frame;
    let mut frame = animation.in_frame + (pos * total).floor();
    if frame < animation.in_frame {
        frame = animation.in_frame;
    }
    if frame > animation.out_frame {
        frame = animation.out_frame;
    }
    frame
}

const LAYER_TYPE_NAMES: [(&str, &str); 6] = [
    ("0", "precomp"),
    ("1", "solid"),
    ("2", "image"),
    ("3", "null"),
    ("4", "shape"),
    ("5", "text"),
];

fn layer_type_name(ty: Option<&JsonValue>) -> String {
    match ty {
        Some(JsonValue::Number(_)) => {
            let key = js_str(ty.unwrap());
            LAYER_TYPE_NAMES
                .iter()
                .find(|(k, _)| *k == key.as_str())
                .map(|(_, name)| name.to_string())
                .unwrap_or(key)
        }
        Some(other) => js_str(other),
        None => "?".to_string(),
    }
}

fn bump(map: &mut BTreeMap<String, f64>, key: &str, n: f64) {
    *map.entry(key.to_string()).or_insert(0.0) += n;
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TgsFeatureReport {
    pub layers: BTreeMap<String, f64>,
    pub shapes: BTreeMap<String, f64>,
    pub flags: BTreeMap<String, f64>,
}

fn scan_shape_tree(list: Option<&JsonValue>, shapes: &mut BTreeMap<String, f64>) {
    let arr = match list {
        Some(JsonValue::Array(a)) => a,
        _ => return,
    };
    for sh in arr {
        if !js_is_object(sh) {
            continue;
        }
        let ty_key = match sh.get("ty") {
            Some(v) => js_str(v),
            None => "?".to_string(),
        };
        bump(shapes, &ty_key, 1.0);
        if js_truthy(sh.get("hd")) {
            bump(shapes, "hidden", 1.0);
        }
        if sh.get("it").map_or(false, |v| v.is_array()) {
            scan_shape_tree(sh.get("it"), shapes);
        }
    }
}

fn scan_layer(l: Option<&JsonValue>, rep: &mut TgsFeatureReport) {
    let l = match l {
        Some(v) => v,
        None => return,
    };
    bump(&mut rep.layers, &format!("ty:{}", layer_type_name(l.get("ty"))), 1.0);
    if js_truthy(l.get("bm")) {
        bump(&mut rep.flags, "layerBlend", 1.0);
    }
    if l.get("tt").map_or(false, |v| !v.is_null()) {
        bump(&mut rep.flags, "matteTarget", 1.0);
    }
    if l.get("td").map_or(false, |v| !v.is_null()) {
        bump(&mut rep.flags, "matteSource", 1.0);
    }
    if let Some(JsonValue::Array(masks)) = l.get("masksProperties") {
        bump(&mut rep.flags, &format!("masks:{}", masks.len()), 1.0);
    }
    if l.get("tm").map_or(false, |v| !v.is_null()) {
        bump(&mut rep.flags, "timeRemap", 1.0);
    }
    if l.get("parent").map_or(false, |v| !v.is_null()) {
        bump(&mut rep.flags, "parented", 1.0);
    }
    if let Some(JsonValue::Array(ef)) = l.get("ef") {
        if !ef.is_empty() {
            bump(&mut rep.flags, "effects", 1.0);
        }
    }
    let ks_scale = l.get("ks").and_then(|ks| ks.get("s"));
    let mut sv = ks_scale.and_then(|s| s.get("k"));
    if let Some(JsonValue::Array(arr)) = sv {
        if !arr.is_empty() {
            let first = &arr[0];
            if (first.is_object() || first.is_null()) && !first.is_array() {
                sv = first.get("s");
            } else if first.is_array() {
                sv = Some(first);
            }
        }
    }
    if let Some(JsonValue::Array(final_arr)) = sv {
        if let Some(a0) = final_arr.first() {
            if js_number(a0) < 0.0 {
                bump(&mut rep.flags, "negScaleX", 1.0);
            }
        }
        if let Some(a1) = final_arr.get(1) {
            if js_number(a1) < 0.0 {
                bump(&mut rep.flags, "negScaleY", 1.0);
            }
        }
    }
    scan_shape_tree(l.get("shapes"), &mut rep.shapes);
}

pub fn analyze_tgs_features(data: &JsonValue) -> TgsFeatureReport {
    let mut rep = TgsFeatureReport::default();
    let layers_ok = data.get("layers").map_or(false, |l| l.is_array());
    if !layers_ok {
        return rep;
    }
    if let Some(JsonValue::Array(layers)) = data.get("layers") {
        for l in layers {
            scan_layer(Some(l), &mut rep);
        }
    }
    if let Some(JsonValue::Array(assets)) = data.get("assets") {
        for a in assets {
            let ok = js_truthy(Some(a)) && a.get("layers").map_or(false, |v| v.is_array());
            if !ok {
                continue;
            }
            if let Some(JsonValue::Array(asset_layers)) = a.get("layers") {
                bump(&mut rep.flags, "assetPrecompLayers", asset_layers.len() as f64);
                for l in asset_layers {
                    scan_layer(Some(l), &mut rep);
                }
            }
        }
    }
    rep
}

pub fn load_tgs(tgs: &[u8]) -> Result<ParsedAnimation, ParseError> {
    let json = crate::inflate::inflate_tgs(tgs)?;
    parse_tgs(&json, None)
}

#[cfg(test)]
mod cache_tests {
    use super::{cache_get_value, cache_put, configure_model_cache_size, model_cache, ParsedAnimation};
    use std::sync::{Mutex, OnceLock};

    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn new_anim(n: f64) -> ParsedAnimation {
        ParsedAnimation { width: n, ..Default::default() }
    }

    fn serial<T>(f: impl FnOnce() -> T) -> T {
        let lock = TEST_LOCK.get_or_init(|| Mutex::new(()));
        let _guard = lock.lock().unwrap();
        f()
    }

    #[test]
    fn cache_size_zero_disables_caching() {
        serial(|| {
            configure_model_cache_size(0.0);
            cache_put("ut-zero", new_anim(1.0));
            assert!(cache_get_value("ut-zero").is_none());
            configure_model_cache_size(10.0);
        })
    }

    #[test]
    fn cache_evicts_oldest_beyond_size() {
        serial(|| {
            configure_model_cache_size(1.0);
            cache_put("ut-a", new_anim(1.0));
            cache_put("ut-b", new_anim(2.0));
            let guard = model_cache().lock().unwrap();
            assert!(guard.map.contains_key("ut-b"));
            assert!(!guard.map.contains_key("ut-a"));
            drop(guard);
            configure_model_cache_size(10.0);
        })
    }

    #[test]
    fn cache_put_refreshes_recency() {
        serial(|| {
            configure_model_cache_size(2.0);
            cache_put("ut-r1", new_anim(1.0));
            cache_put("ut-r2", new_anim(2.0));
            cache_put("ut-r1", new_anim(3.0));
            cache_put("ut-r3", new_anim(4.0));
            let guard = model_cache().lock().unwrap();
            assert!(guard.map.contains_key("ut-r1"));
            assert!(!guard.map.contains_key("ut-r2"));
            assert_eq!(guard.map.get("ut-r1").unwrap().width, 3.0);
            drop(guard);
            configure_model_cache_size(10.0);
        })
    }

    #[test]
    fn cache_get_value_peek_does_not_touch_recency() {
        serial(|| {
            configure_model_cache_size(2.0);
            cache_put("ut-p1", new_anim(1.0));
            cache_put("ut-p2", new_anim(2.0));
            assert!(cache_get_value("ut-p1").is_some());
            cache_put("ut-p3", new_anim(3.0));
            let guard = model_cache().lock().unwrap();
            assert!(!guard.map.contains_key("ut-p1"));
            assert!(guard.map.contains_key("ut-p2"));
            drop(guard);
            configure_model_cache_size(10.0);
        })
    }
}

pub use crate::keyframes::parse_value;

