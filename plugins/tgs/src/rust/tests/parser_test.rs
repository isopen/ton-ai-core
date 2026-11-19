#![recursion_limit = "1024"]
use tgs::json::{jarr, jn, jobj, js, Value as JsonValue};
use tgs::{
    frame_at_pos, has_animated_properties, interpolate_keyframes, layer_info, parse_tgs, set_value, FillRule,
    GradientType, LayerType, MaskMode, MatteType, ParseOptions, ParsedKeyframe, ParsedProperty, ParsedPropertyData, ParsedShape,
    Property, PropertyValue, ParsedAnimation, TrimMode,
};
use tgs::jsutil::unwrap_value;

fn tgs_json(body: JsonValue) -> String {
    let mut obj = jobj(vec![("tgs", jn(1.0)), ("v", js("5.5.2")), ("fr", jn(60.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("w", jn(512.0)), ("h", jn(512.0)), ("nm", js("test"))]);
    let map = obj.as_object_mut().unwrap();
    for (k, v) in body.as_object().unwrap() {
        map.insert(k, v.clone());
    }
    tgs::json::to_string(&obj)
}

fn parse(body: JsonValue) -> ParsedAnimation {
    parse_tgs(&tgs_json(body), None).unwrap()
}

fn kf_from(v: &JsonValue) -> ParsedKeyframe {
    let bezier = |key: &str| -> Option<tgs::BezierEasingDef> {
        v.get(key).map(|d| tgs::BezierEasingDef {
            x: d.get("x").and_then(|a| a.as_array()).and_then(|a| a.first()).map(|x| x.as_f64().unwrap()),
            y: d.get("y").and_then(|a| a.as_array()).and_then(|a| a.first()).map(|x| x.as_f64().unwrap()),
        })
    };
    ParsedKeyframe {
        t: v["t"].as_f64().unwrap_or(f64::INFINITY),
        s: unwrap_value(&v["s"]),
        e: v.get("e").map(|e| unwrap_value(e)),
        end_frame: v.get("endFrame").and_then(|e| e.as_f64()),
        hold: v.get("h").and_then(|h| h.as_f64()) == Some(1.0),
        o: bezier("o"),
        i: bezier("i"),
        easing: None,
        easing_curve: None,
        to: v.get("to").map(|t| t.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()),
        ti: v.get("ti").map(|t| t.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()),
        h: v.get("h").filter(|h| !h.is_null()).cloned(),
        n: None,
    }
}

fn manual_prop(keyframes: &[&JsonValue]) -> ParsedProperty {
    let raw_first = unwrap_value(&keyframes[0]["s"]);
    ParsedProperty::new(ParsedPropertyData {
        animated: true,
        value: raw_first.clone(),
        keyframes: Some(keyframes.iter().map(|k| kf_from(k)).collect()),
        ..Default::default()
    })
}

fn arr_f64(v: &JsonValue) -> Vec<f64> {
    match v.arr_len() {
        Some(n) => (0..n).filter_map(|i| v.arr_at(i)).collect(),
        None => Vec::new(),
    }
}

#[test]
fn parses_the_composition_header() {
    let anim = parse(jobj(vec![("layers", jarr(vec![]))]));
    assert_eq!(anim.width, 512.0);
    assert_eq!(anim.height, 512.0);
    assert_eq!(anim.fps, 60.0);
    assert_eq!(anim.in_frame, 0.0);
    assert_eq!(anim.out_frame, 180.0);
    assert!((anim.duration - 3.0).abs() < 1e-9);
    assert_eq!(anim.name.as_deref(), Some("test"));
    assert_eq!(anim.version.as_deref(), Some("5.5.2"));
    assert!(anim.tgs);
}

#[test]
fn throws_on_invalid_json() {
    let err = parse_tgs("not json", None).unwrap_err();
    assert_eq!(err.0, "Invalid TGS JSON");
}

#[test]
fn throws_when_no_layers() {
    let err = parse_tgs("{\"w\":512,\"h\":512}", None).unwrap_err();
    assert_eq!(err.0, "TGS has no layers");
}

#[test]
fn parses_layer_types_and_timing() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(60.0)), ("st", jn(0.0)), ("nm", js("ShapeLayer")), ("ks", jobj(vec![]))]), jobj(vec![("ind", jn(1.0)), ("ty", jn(3.0)), ("ip", jn(0.0)), ("op", jn(60.0)), ("ks", jobj(vec![])), ("nm", js("NullLayer"))])]))]));
    assert_eq!(anim.layers.len(), 2);
    assert_eq!(anim.layers[0].layer_type, LayerType::Shape);
    assert_eq!(anim.layers[0].in_frame, Some(0.0));
    assert_eq!(anim.layers[0].out_frame, Some(60.0));
    assert_eq!(anim.layers[0].name.as_deref(), Some("ShapeLayer"));
    assert_eq!(anim.layers[1].layer_type, LayerType::Null);
}

#[test]
fn parses_solid_and_precomp_layers_with_assets() {
    let anim = parse(jobj(vec![("assets", jarr(vec![jobj(vec![("id", js("pre1")), ("w", jn(100.0)), ("h", jn(100.0)), ("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![]))])]))])])), ("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(1.0)), ("sc", js("#FF0000")), ("sw", jn(512.0)), ("sh", jn(512.0)), ("ks", jobj(vec![]))]), jobj(vec![("ind", jn(1.0)), ("ty", jn(0.0)), ("refId", js("pre1")), ("ks", jobj(vec![]))])]))]));
    assert_eq!(anim.layers[0].layer_type, LayerType::Solid);
    assert_eq!(anim.layers[0].solid_color.as_deref(), Some("#FF0000"));
    assert_eq!(anim.layers[0].solid_width, Some(512.0));
    assert_eq!(anim.layers[1].layer_type, LayerType::Precomp);
    assert_eq!(anim.layers[1].ref_id.as_deref(), Some("pre1"));
    assert_eq!(anim.assets[0].layers.as_ref().unwrap().len(), 1);
}

#[test]
fn parses_transform_properties() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(10.0), jn(20.0)]))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0)]))]))]))])]))]));
    let tr = &anim.layers[0].transform;
    assert_eq!(tr.opacity.as_ref().unwrap().value, jn(100.0));
    assert_eq!(tr.position.as_ref().unwrap().value, jarr(vec![jn(10.0), jn(20.0)]));
    assert_eq!(tr.scale.as_ref().unwrap().value, jarr(vec![jn(100.0), jn(100.0)]));
    assert!(!tr.opacity.as_ref().unwrap().animated);
}

#[test]
fn parses_shape_groups_rects_ellipses_fills_and_strokes() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("gr")), ("nm", js("Group 1")), ("it", jarr(vec![jobj(vec![("ty", js("rc")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(50.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(5.0))])), ("nm", js("Rect 1"))]), jobj(vec![("ty", js("el")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(20.0), jn(20.0)]))])), ("nm", js("Ellipse 1"))]), jobj(vec![("ty", js("fl")), ("c", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(1.0), jn(0.0), jn(0.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("r", jn(1.0)), ("nm", js("Fill 1"))]), jobj(vec![("ty", js("st")), ("c", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(1.0), jn(0.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(50.0))])), ("w", jobj(vec![("a", jn(0.0)), ("k", jn(4.0))])), ("lc", jn(2.0)), ("lj", jn(2.0)), ("nm", js("Stroke 1"))]), jobj(vec![("ty", js("tr")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(10.0), jn(10.0)]))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))]))])]))])]))])]))]));
    let group = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(group.shape_type, "group");
    let children = group.children.as_ref().unwrap();
    assert_eq!(children.len(), 5);
    let rect = &children[0];
    let ellipse = &children[1];
    let fill = &children[2];
    let stroke = &children[3];
    let transform = &children[4];
    assert_eq!(rect.shape_type, "rect");
    assert_eq!(rect.size.as_ref().unwrap().value, jarr(vec![jn(100.0), jn(50.0)]));
    assert_eq!(rect.radius.as_ref().unwrap().value, jn(5.0));
    assert_eq!(ellipse.shape_type, "ellipse");
    assert_eq!(fill.shape_type, "fill");
    assert_eq!(fill.color.as_ref().unwrap().value, jarr(vec![jn(1.0), jn(0.0), jn(0.0)]));
    assert_eq!(fill.fill_rule, Some(FillRule::Winding));
    assert_eq!(stroke.shape_type, "stroke");
    assert_eq!(stroke.stroke_width.as_ref().unwrap().value, jn(4.0));
    assert_eq!(stroke.line_cap, Some(2.0));
    assert_eq!(transform.shape_type, "transform");
    assert_eq!(transform.position.as_ref().unwrap().value, jarr(vec![jn(10.0), jn(10.0)]));
}

#[test]
fn parses_rect_ellipse_direction_and_rd_attachment() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("rc")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(50.0)]))])), ("d", jn(3.0)), ("rd", jobj(vec![("a", jn(0.0)), ("k", jn(8.0))]))]), jobj(vec![("ty", js("el")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(20.0), jn(20.0)]))])), ("d", jn(1.0))]), jobj(vec![("ty", js("rc")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(30.0), jn(30.0)]))]))])]))])]))]));
    let shapes = anim.layers[0].shapes.as_ref().unwrap();
    let rect = &shapes[0];
    let ellipse = &shapes[1];
    let plain = &shapes[2];
    assert_eq!(rect.direction, Some(3.0));
    let rd = rect.rd.as_ref().unwrap();
    assert_eq!(rd.shape_type, "roundedCorner");
    assert_eq!(rd.radius.as_ref().unwrap().value, jn(8.0));
    assert_eq!(ellipse.direction, Some(1.0));
    assert!(plain.direction.is_none());
    assert!(plain.rd.is_none());
}

#[test]
fn parses_path_vertices_from_ks() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("sh")), ("nm", js("Path 1")), ("ks", jobj(vec![("a", jn(0.0)), ("k", jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(10.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])]))]))]))])]))])]))]));
    let path = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(path.shape_type, "path");
    let vertices = path.vertices.as_ref().unwrap();
    assert_eq!(vertices.value["c"], JsonValue::Bool(true));
    assert_eq!(vertices.value["v"].as_array().unwrap().len(), 2);
}

#[test]
fn parses_trim_paths_with_animated_start_end_offset() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("tm")), ("nm", js("Trim 1")), ("s", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)])), ("i", jobj(vec![("x", jarr(vec![jn(0.0)])), ("y", jarr(vec![jn(0.0)]))])), ("o", jobj(vec![("x", jarr(vec![jn(1.0)])), ("y", jarr(vec![jn(1.0)]))]))]), jobj(vec![("t", jn(60.0)), ("s", jarr(vec![jn(100.0)]))])]))])), ("e", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("m", jn(1.0))])]))])]))]));
    let trim = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(trim.shape_type, "trim");
    let start = trim.start.as_ref().unwrap();
    assert!(start.animated);
    assert_eq!(start.keyframes.as_ref().unwrap().len(), 2);
    assert_eq!(trim.end.as_ref().unwrap().value, jn(100.0));
    assert_eq!(trim.trim_mode, Some(TrimMode::Simultaneously));
    assert_eq!(interpolate_keyframes(start, 30.0), jarr(vec![jn(50.0)]));
    assert_eq!(interpolate_keyframes(start, 60.0), jarr(vec![jn(100.0)]));
    assert_eq!(interpolate_keyframes(start, 180.0), jarr(vec![jn(100.0)]));
}

#[test]
fn parses_gradient_fill_with_stops_and_radial_type() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("gf")), ("nm", js("Grad 1")), ("t", jn(2.0)), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("e", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("g", jobj(vec![("p", jn(2.0)), ("k", jarr(vec![jn(0.0), jn(1.0), jn(0.0), jn(0.0), jn(1.0), jn(0.0), jn(0.0), jn(1.0)]))]))])]))])]))]));
    let grad = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().gradient.as_ref().unwrap();
    assert_eq!(grad.gradient_type, GradientType::Radial);
    assert_eq!(grad.start_point.value, jarr(vec![jn(0.0), jn(0.0)]));
    assert_eq!(grad.end_point.value, jarr(vec![jn(100.0), jn(100.0)]));
    assert_eq!(grad.stops.value, jarr(vec![jn(0.0), jn(1.0), jn(0.0), jn(0.0), jn(1.0), jn(0.0), jn(0.0), jn(1.0)]));
}

#[test]
fn parses_gradient_stroke_type() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("gs")), ("w", jobj(vec![("a", jn(0.0)), ("k", jn(3.0))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("e", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(10.0), jn(10.0)]))])), ("g", jobj(vec![("p", jn(2.0)), ("k", jarr(vec![jn(0.0), jn(0.0), jn(0.0), jn(0.0), jn(1.0), jn(0.0), jn(0.0), jn(1.0)]))]))])]))])]))]));
    let shape = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(shape.shape_type, "gradientStroke");
    assert_eq!(shape.stroke_width.as_ref().unwrap().value, jn(3.0));
    assert!(shape.gradient.is_some());
}

#[test]
fn parses_stroke_dashes() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("st")), ("c", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0), jn(0.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("w", jobj(vec![("a", jn(0.0)), ("k", jn(2.0))])), ("d", jarr(vec![jobj(vec![("n", js("d")), ("nm", js("dash")), ("v", jobj(vec![("a", jn(0.0)), ("k", jn(10.0))]))]), jobj(vec![("n", js("g")), ("nm", js("gap")), ("v", jobj(vec![("a", jn(0.0)), ("k", jn(5.0))]))])]))])]))])]))]));
    let dashes = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().dashes.as_ref().unwrap();
    assert_eq!(dashes.len(), 2);
    assert_eq!(dashes[0].name.as_deref(), Some("d"));
    assert_eq!(dashes[0].value.value, jn(10.0));
    assert_eq!(dashes[1].value.value, jn(5.0));
}

#[test]
fn parses_star_with_point_count_radii_and_roundness() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("sr")), ("sy", jn(1.0)), ("pt", jobj(vec![("a", jn(0.0)), ("k", jn(5.0))])), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(50.0), jn(50.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("or", jobj(vec![("a", jn(0.0)), ("k", jn(40.0))])), ("ir", jobj(vec![("a", jn(0.0)), ("k", jn(20.0))])), ("os", jn(0.2)), ("is", jn(0.1))])]))])]))]));
    let star = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(star.shape_type, "star");
    assert_eq!(star.points.as_ref().unwrap().value, jn(5.0));
    assert_eq!(star.outer_radius.as_ref().unwrap().value, jn(40.0));
    assert_eq!(star.inner_radius.as_ref().unwrap().value, jn(20.0));
    assert_eq!(star.outer_roundness.as_ref().unwrap().value, jn(0.2));
    assert_eq!(star.inner_roundness.as_ref().unwrap().value, jn(0.1));
    assert_eq!(star.star_type, Some(1.0));
}

#[test]
fn parses_repeater_with_copies_and_transform() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("rp")), ("c", jobj(vec![("a", jn(0.0)), ("k", jn(3.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("m", jn(1.0)), ("tr", jobj(vec![("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(10.0), jn(0.0)]))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("so", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("eo", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))]))]))])]))])]))]));
    let repeater = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(repeater.shape_type, "repeater");
    assert_eq!(repeater.copies.as_ref().unwrap().value, jn(3.0));
    let tr = repeater.transform.as_ref().unwrap();
    assert_eq!(tr.position.as_ref().unwrap().value, jarr(vec![jn(10.0), jn(0.0)]));
    assert_eq!(tr.start_opacity.as_ref().unwrap().value, jn(100.0));
    assert_eq!(tr.end_opacity.as_ref().unwrap().value, jn(0.0));
}

#[test]
fn parses_masks_and_matte() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("tt", jn(1.0)), ("masksProperties", jarr(vec![jobj(vec![("nm", js("Mask 1")), ("inv", JsonValue::Bool(true)), ("mode", js("s")), ("pt", jobj(vec![("a", jn(0.0)), ("k", jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(10.0), jn(0.0)]), jarr(vec![jn(10.0), jn(10.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])]))]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("x", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))]))])]))]), jobj(vec![("ind", jn(1.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("td", jn(1.0))])]))]));
    let layer = &anim.layers[0];
    assert_eq!(layer.matte_type, Some(MatteType::Alpha));
    let masks = layer.masks.as_ref().unwrap();
    assert_eq!(masks.len(), 1);
    assert_eq!(masks[0].mode, MaskMode::Subtract);
    assert!(masks[0].inverted);
    assert_eq!(masks[0].opacity.value, jn(100.0));
    assert_eq!(anim.layers[1].matte_target, Some(true));
}

#[test]
fn parses_markers() {
    let anim = parse(jobj(vec![("markers", jarr(vec![jobj(vec![("cm", js("loop")), ("dr", jn(30.0)), ("tm", jn(0.0))])])), ("layers", jarr(vec![]))]));
    let markers = anim.markers.as_ref().unwrap();
    assert_eq!(markers.len(), 1);
    assert_eq!(markers[0].name.as_deref(), Some("loop"));
    assert_eq!(markers[0].start_frame, 0.0);
    assert_eq!(markers[0].end_frame, 30.0);
}

#[test]
fn parses_text_layers() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(5.0)), ("ks", jobj(vec![])), ("t", jobj(vec![("d", jobj(vec![("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jobj(vec![("t", js("Hello")), ("f", js("Roboto")), ("s", jn(24.0)), ("fc", jarr(vec![jn(1.0), jn(0.0), jn(0.0)]))]))])]))]))]))])]))]));
    let text = anim.layers[0].text.as_ref().unwrap();
    assert_eq!(text.text, "Hello");
    assert_eq!(text.font_family.as_deref(), Some("Roboto"));
    assert_eq!(text.font_size, Some(24.0));
    assert_eq!(text.fill_color, Some(vec![1.0, 0.0, 0.0]));
}

#[test]
fn keeps_the_previous_end_value_when_the_tail_keyframe_has_no_start_value() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("tm")), ("s", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)])), ("e", jarr(vec![jn(100.0)])), ("i", jobj(vec![("x", jarr(vec![jn(0.0)])), ("y", jarr(vec![jn(0.0)]))])), ("o", jobj(vec![("x", jarr(vec![jn(1.0)])), ("y", jarr(vec![jn(1.0)]))]))]), jobj(vec![("t", jn(60.0))])]))])), ("e", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("m", jn(1.0))])]))])]))]));
    let start = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().start.as_ref().unwrap();
    assert_eq!(start.keyframes.as_ref().unwrap().len(), 1);
    assert_eq!(interpolate_keyframes(start, 30.0), jarr(vec![jn(50.0)]));
    assert_eq!(interpolate_keyframes(start, 60.0), jarr(vec![jn(100.0)]));
    assert_eq!(interpolate_keyframes(start, 120.0), jarr(vec![jn(100.0)]));
}

#[test]
fn keeps_intermediate_keyframes_without_tangents_and_interpolates_them_linearly() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("tm")), ("s", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)])), ("i", jobj(vec![("x", jarr(vec![jn(0.0)])), ("y", jarr(vec![jn(0.0)]))])), ("o", jobj(vec![("x", jarr(vec![jn(1.0)])), ("y", jarr(vec![jn(1.0)]))]))]), jobj(vec![("t", jn(30.0)), ("s", jarr(vec![jn(50.0)]))]), jobj(vec![("t", jn(60.0)), ("s", jarr(vec![jn(100.0)])), ("i", jobj(vec![("x", jarr(vec![jn(0.0)])), ("y", jarr(vec![jn(0.0)]))])), ("o", jobj(vec![("x", jarr(vec![jn(1.0)])), ("y", jarr(vec![jn(1.0)]))]))])]))])), ("e", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("m", jn(1.0))])]))])]))]));
    let start = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().start.as_ref().unwrap();
    assert_eq!(start.keyframes.as_ref().unwrap().len(), 3);
    assert_eq!(interpolate_keyframes(start, 30.0), jarr(vec![jn(50.0)]));
    assert_eq!(interpolate_keyframes(start, 45.0), jarr(vec![jn(75.0)]));
    assert_eq!(interpolate_keyframes(start, 60.0), jarr(vec![jn(100.0)]));
}

#[test]
fn unwraps_array_wrapped_path_keyframe_values() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("sh")), ("nm", js("Path 1")), ("ks", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(10.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])]))])])), ("i", jobj(vec![("x", jarr(vec![jn(0.0)])), ("y", jarr(vec![jn(0.0)]))])), ("o", jobj(vec![("x", jarr(vec![jn(1.0)])), ("y", jarr(vec![jn(1.0)]))]))]), jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(100.0), jn(0.0)]), jarr(vec![jn(110.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])]))])]))])]))]))])]))])]))]));
    let vertices = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().vertices.as_ref().unwrap();
    let mid = interpolate_keyframes(vertices, 5.0);
    assert_eq!(mid["c"], JsonValue::Bool(true));
    assert_eq!(mid["v"], jarr(vec![jarr(vec![jn(50.0), jn(0.0)]), jarr(vec![jn(60.0), jn(0.0)])]));
}

#[test]
fn maps_trim_m2_to_individually() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("tm")), ("m", jn(2.0)), ("s", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("e", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))]))])]))])]))]));
    let trim = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(trim.trim_mode, Some(TrimMode::Individually));
}

#[test]
fn parses_gradient_highlight_and_color_points() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("gf")), ("t", jn(2.0)), ("h", jobj(vec![("a", jn(0.0)), ("k", jn(0.5))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jn(90.0))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("e", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("g", jobj(vec![("p", jn(2.0)), ("k", jarr(vec![jn(0.0), jn(0.0), jn(0.0), jn(0.0), jn(1.0), jn(0.0), jn(0.0), jn(1.0)]))]))])]))])]))]));
    let grad = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().gradient.as_ref().unwrap();
    assert_eq!(grad.highlight_length.as_ref().unwrap().value, jn(0.5));
    assert_eq!(grad.highlight_angle.as_ref().unwrap().value, jn(90.0));
    assert_eq!(grad.color_points, Some(2.0));
}

#[test]
fn parses_split_dimension_positions() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![("p", jobj(vec![("s", JsonValue::Bool(true)), ("x", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(50.0)]))]), jobj(vec![("t", jn(30.0)), ("s", jarr(vec![jn(50.0)]))]), jobj(vec![("t", jn(60.0)), ("s", jarr(vec![jn(50.0)]))])]))])), ("y", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(50.0)]))]), jobj(vec![("t", jn(30.0)), ("s", jarr(vec![jn(70.0)]))]), jobj(vec![("t", jn(60.0)), ("s", jarr(vec![jn(50.0)]))])]))]))]))]))])]))]));
    let p = anim.layers[0].transform.position.as_ref().unwrap();
    assert!(p.animated == false);
    assert!(p.x.is_some());
    assert!(p.y.is_some());
    assert_eq!(interpolate_keyframes(p, 0.0), jarr(vec![jn(50.0), jn(50.0)]));
    assert_eq!(interpolate_keyframes(p, 15.0), jarr(vec![jn(50.0), jn(60.0)]));
    assert_eq!(interpolate_keyframes(p, 30.0), jarr(vec![jn(50.0), jn(70.0)]));
    let late = interpolate_keyframes(p, 59.0);
    let vals = arr_f64(&late);
    assert_eq!(vals[0], 50.0);
    assert!((vals[1] - 50.66666666666667).abs() < 1e-9);
}

#[test]
fn parses_linear_position_keyframes_without_tangents_as_animated() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![("p", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(50.0), jn(50.0)]))]), jobj(vec![("t", jn(30.0)), ("s", jarr(vec![jn(50.0), jn(70.0)]))]), jobj(vec![("t", jn(60.0)), ("s", jarr(vec![jn(50.0), jn(50.0)]))])]))]))]))])]))]));
    let p = anim.layers[0].transform.position.as_ref().unwrap();
    assert!(p.animated);
    assert_eq!(p.keyframes.as_ref().unwrap().len(), 3);
    assert_eq!(interpolate_keyframes(p, 0.0), jarr(vec![jn(50.0), jn(50.0)]));
    assert_eq!(interpolate_keyframes(p, 15.0), jarr(vec![jn(50.0), jn(60.0)]));
    assert_eq!(interpolate_keyframes(p, 30.0), jarr(vec![jn(50.0), jn(70.0)]));
    let late = interpolate_keyframes(p, 59.0);
    let vals = arr_f64(&late);
    assert_eq!(vals[0], 50.0);
    assert!((vals[1] - 50.66666666666667).abs() < 1e-9);
}

#[test]
fn parses_mask_mode_f_to_difference() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("masksProperties", jarr(vec![jobj(vec![("mode", js("f")), ("pt", jobj(vec![("a", jn(0.0)), ("k", jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(10.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])]))]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))]))])]))])]))]));
    assert_eq!(anim.layers[0].masks.as_ref().unwrap()[0].mode, MaskMode::Difference);
}

#[test]
fn drops_hidden_shapes() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("gr")), ("it", jarr(vec![jobj(vec![("ty", js("fl")), ("hd", JsonValue::Bool(true)), ("c", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(1.0), jn(0.0), jn(0.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))]))]), jobj(vec![("ty", js("el")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(10.0), jn(10.0)]))]))])]))])]))])]))]));
    let children = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().children.as_ref().unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(children[0].shape_type, "ellipse");
}

#[test]
fn forces_hidden_layers_to_null_and_drops_their_content() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("hd", JsonValue::Bool(true)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("fl")), ("c", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(1.0), jn(0.0), jn(0.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))]))])]))])]))]));
    assert_eq!(anim.layers.len(), 1);
    assert_eq!(anim.layers[0].layer_type, LayerType::Null);
    assert_eq!(anim.layers[0].hidden, Some(true));
    assert!(anim.layers[0].shapes.is_none());
    assert!(anim.layers[0].transform.opacity.is_some());
}

#[test]
fn keeps_layers_without_a_transform_and_drops_self_parented_layers() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0))]), jobj(vec![("ind", jn(1.0)), ("ty", jn(4.0)), ("parent", jn(1.0)), ("ks", jobj(vec![]))]), jobj(vec![("ind", jn(2.0)), ("ty", jn(4.0)), ("ks", jobj(vec![]))])]))]));
    assert_eq!(anim.layers.len(), 2);
    assert_eq!(anim.layers[0].index, Some(0.0));
    assert!(anim.layers[0].transform.opacity.is_some());
    assert_eq!(anim.layers[1].index, Some(2.0));
}

#[test]
fn parses_precomp_layer_size() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(0.0)), ("w", jn(300.0)), ("h", jn(200.0)), ("ks", jobj(vec![]))])]))]));
    assert_eq!(anim.layers[0].layer_width, Some(300.0));
    assert_eq!(anim.layers[0].layer_height, Some(200.0));
}

#[test]
fn layer_info_returns_name_in_out_for_each_layer() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("nm", js("A")), ("ip", jn(0.0)), ("op", jn(60.0)), ("ks", jobj(vec![]))]), jobj(vec![("ind", jn(1.0)), ("ty", jn(4.0)), ("nm", js("B")), ("ip", jn(60.0)), ("op", jn(120.0)), ("ks", jobj(vec![]))])]))]));
    let info = layer_info(&anim);
    assert_eq!(info.len(), 2);
    assert_eq!(info[0].name.as_deref(), Some("A"));
    assert_eq!(info[0].in_frame, 0.0);
    assert_eq!(info[0].out_frame, 60.0);
    assert_eq!(info[1].name.as_deref(), Some("B"));
    assert_eq!(info[1].in_frame, 60.0);
    assert_eq!(info[1].out_frame, 120.0);
}

#[test]
fn interp_returns_the_static_value_for_non_animated_properties() {
    let p = ParsedProperty::new(ParsedPropertyData { animated: false, value: jn(42.0), ..Default::default() });
    assert_eq!(interpolate_keyframes(&p, 10.0), jn(42.0));
}

#[test]
fn interp_interpolates_linearly_without_easing() {
    let k0 = jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0), jn(0.0)]))]);
    let k1 = jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(100.0), jn(200.0)]))]);
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 0.0), jarr(vec![jn(0.0), jn(0.0)]));
    assert_eq!(interpolate_keyframes(&p, 5.0), jarr(vec![jn(50.0), jn(100.0)]));
    assert_eq!(interpolate_keyframes(&p, 10.0), jarr(vec![jn(100.0), jn(200.0)]));
}

#[test]
fn interp_clamps_frames_before_first_and_after_last_keyframe() {
    let k0 = jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(0.0)]))]);
    let k1 = jobj(vec![("t", jn(20.0)), ("s", jarr(vec![jn(100.0)]))]);
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 0.0), jarr(vec![jn(0.0)]));
    assert_eq!(interpolate_keyframes(&p, 99.0), jarr(vec![jn(100.0)]));
}

#[test]
fn interp_uses_end_value_of_the_last_keyframe_beyond_its_frame() {
    let k0 = jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)])), ("e", jarr(vec![jn(50.0)]))]);
    let k1 = jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(100.0)])), ("e", jarr(vec![jn(140.0)]))]);
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 5.0), jarr(vec![jn(25.0)]));
    assert_eq!(interpolate_keyframes(&p, 10.0), jarr(vec![jn(140.0)]));
    assert_eq!(interpolate_keyframes(&p, 15.0), jarr(vec![jn(140.0)]));
}

#[test]
fn interp_fills_missing_end_values_from_the_next_keyframe() {
    let k0 = jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)])), ("e", jarr(vec![jn(50.0)]))]);
    let k1 = jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(100.0)]))]);
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 5.0), jarr(vec![jn(50.0)]));
}

#[test]
fn interp_holds_value_for_hold_keyframes() {
    let k0 = jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(10.0)]))]);
    let k1 = jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(20.0)])), ("h", jn(1.0))]);
    let k2 = jobj(vec![("t", jn(20.0)), ("s", jarr(vec![jn(30.0)]))]);
    let p = manual_prop(&[&k0, &k1, &k2]);
    assert_eq!(interpolate_keyframes(&p, 5.0), jarr(vec![jn(15.0)]));
    assert_eq!(interpolate_keyframes(&p, 10.0), jarr(vec![jn(20.0)]));
    assert_eq!(interpolate_keyframes(&p, 15.0), jarr(vec![jn(20.0)]));
    assert_eq!(interpolate_keyframes(&p, 19.0), jarr(vec![jn(20.0)]));
    assert_eq!(interpolate_keyframes(&p, 20.0), jarr(vec![jn(30.0)]));
}

#[test]
fn interp_applies_cubic_bezier_easing_like_rlottie() {
    let k0 = jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)])), ("i", jobj(vec![("x", jarr(vec![jn(0.667)])), ("y", jarr(vec![jn(1.0)]))])), ("o", jobj(vec![("x", jarr(vec![jn(0.333)])), ("y", jarr(vec![jn(0.0)]))]))]);
    let k1 = jobj(vec![("t", jn(100.0)), ("s", jarr(vec![jn(100.0)]))]);
    let p = manual_prop(&[&k0, &k1]);
    let mid = interpolate_keyframes(&p, 50.0);
    let m = arr_f64(&mid)[0];
    assert!((m - 50.0).abs() < 0.5);
    let q = arr_f64(&interpolate_keyframes(&p, 25.0))[0];
    assert!(q < 25.0 && q > 10.0);
    assert!((q - 15.625).abs() < 0.05);
}

#[test]
fn interp_uses_tangent_values_as_is() {
    let k0 = jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)])), ("o", jobj(vec![("x", jarr(vec![jn(0.0)])), ("y", jarr(vec![jn(0.0)]))])), ("i", jobj(vec![("x", jarr(vec![jn(1.0)])), ("y", jarr(vec![jn(1.0)]))]))]);
    let k1 = jobj(vec![("t", jn(100.0)), ("s", jarr(vec![jn(100.0)]))]);
    let p = manual_prop(&[&k0, &k1]);
    assert!((arr_f64(&interpolate_keyframes(&p, 25.0))[0] - 25.0).abs() <= 5e-7);
    assert!((arr_f64(&interpolate_keyframes(&p, 50.0))[0] - 50.0).abs() <= 5e-7);
}

#[test]
fn interp_interpolates_scalars() {
    let k0 = jobj(vec![("t", jn(0.0)), ("s", jn(0.0))]);
    let k1 = jobj(vec![("t", jn(10.0)), ("s", jn(100.0))]);
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 5.0), jn(50.0));
}

#[test]
fn interp_interpolates_colors() {
    let k0 = jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(1.0), jn(0.0), jn(0.0)]))]);
    let k1 = jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(0.0), jn(0.0), jn(1.0)]))]);
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 5.0), jarr(vec![jn(0.5), jn(0.0), jn(0.5)]));
}

#[test]
fn interp_interpolates_path_vertex_data() {
    let k0 = jobj(vec![("t", jn(0.0)), ("s", jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(10.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])]))]))]);
    let k1 = jobj(vec![("t", jn(10.0)), ("s", jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(100.0), jn(0.0)]), jarr(vec![jn(110.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])]))]))]);
    let p = manual_prop(&[&k0, &k1]);
    let mid = interpolate_keyframes(&p, 5.0);
    assert_eq!(mid["v"], jarr(vec![jarr(vec![jn(50.0), jn(0.0)]), jarr(vec![jn(60.0), jn(0.0)])]));
}

#[test]
fn interp_interpolates_along_the_spatial_bezier_with_to_ti_tangents() {
    let k0 = jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0), jn(0.0)])), ("to", jarr(vec![jn(100.0), jn(80.0)])), ("ti", jarr(vec![jn(-100.0), jn(20.0)]))]);
    let k1 = jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(200.0), jn(0.0)]))]);
    let p = manual_prop(&[&k0, &k1]);
    let mid = interpolate_keyframes(&p, 5.0);
    let vals = arr_f64(&mid);
    assert!(vals[0] > 90.0 && vals[0] <= 100.0);
    assert!(vals[1] > 20.0 && vals[1] < 50.0);
}

#[test]
fn interp_uses_split_dimension_keyframes_for_x() {
    let p = ParsedProperty::new(ParsedPropertyData {
        animated: false,
        value: jarr(vec![jn(0.0), jn(80.0)]),
        x: Some(Box::new(ParsedProperty::new(ParsedPropertyData {
            animated: true,
            value: jarr(vec![jn(0.0)]),
            keyframes: Some(vec![
                kf_from(&jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(500.0)]))])),
                kf_from(&jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(500.0)]))])),
            ]),
            ..Default::default()
        }))),
        ..Default::default()
    });
    assert_eq!(interpolate_keyframes(&p, 5.0), jarr(vec![jn(500.0), jn(80.0)]));
}

#[test]
fn interp_animated_one_component_main_track_maps_to_axis_0() {
    let p = ParsedProperty::new(ParsedPropertyData {
        animated: true,
        value: jarr(vec![jn(0.0)]),
        keyframes: Some(vec![
            kf_from(&jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)]))])),
            kf_from(&jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(100.0)]))])),
        ]),
        x: Some(Box::new(ParsedProperty::new(ParsedPropertyData {
            animated: true,
            value: jarr(vec![jn(0.0)]),
            keyframes: Some(vec![
                kf_from(&jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(500.0)]))])),
                kf_from(&jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(500.0)]))])),
            ]),
            ..Default::default()
        }))),
        ..Default::default()
    });
    assert_eq!(interpolate_keyframes(&p, 5.0), jarr(vec![jn(500.0), jn(0.0)]));
}

#[test]
fn model_cache_returns_equal_models_for_the_same_key() {
    let json = tgs_json(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![]))])]))]));
    let opts = ParseOptions { key: Some("sticker-1".to_string()), cache: true };
    let a = parse_tgs(&json, Some(opts.clone())).unwrap();
    let b = parse_tgs(&json, Some(opts)).unwrap();
    assert_eq!(a, b);
}

#[test]
fn set_value_overrides_a_fill_color_by_exact_keypath() {
    let mut anim = anim_with_fill();
    set_value(&mut anim, "Layer 1.Group 1.Fill 1", Property::FillColor, nums(&[0.0, 0.0, 1.0])).unwrap();
    let fill = nth_child(&anim, 0, 0, 0);
    let color = fill.color.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(color, 0.0), jarr(vec![jn(0.0), jn(0.0), jn(1.0)]));
}

#[test]
fn set_value_overrides_layer_transform_via_star_transform() {
    let mut anim = anim_with_fill();
    set_value(&mut anim, "**.Transform", Property::TrPosition, nums(&[50.0, 60.0])).unwrap();
    let position = anim.layers[0].transform.position.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(position, 0.0), jarr(vec![jn(50.0), jn(60.0)]));
}

#[test]
fn set_value_overrides_stroke_width() {
    let mut anim = anim_with_fill();
    set_value(&mut anim, "Layer 1.**.Stroke 1", Property::StrokeWidth, PropertyValue::Number(9.0)).unwrap();
    let stroke = nth_child(&anim, 0, 0, 1);
    let width = stroke.stroke_width.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(width, 0.0), jn(9.0));
}

#[test]
fn set_value_overrides_animated_properties_too() {
    let raw = tgs_json(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("nm", js("L")), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("tm")), ("nm", js("Trim 1")), ("s", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)]))]), jobj(vec![("t", jn(60.0)), ("s", jarr(vec![jn(100.0)]))])]))])), ("e", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("m", jn(1.0))])]))])]))]));
    let mut anim = parse_tgs(&raw, None).unwrap();
    set_value(&mut anim, "L.Trim 1", Property::TrimStart, nums(&[40.0])).unwrap();
    let trim = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    let start = trim.start.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(start, 30.0), jarr(vec![jn(40.0)]));
}

#[test]
fn set_value_throws_when_keypath_matches_nothing() {
    let mut anim = anim_with_fill();
    let res = set_value(&mut anim, "Nope.Nothing", Property::FillColor, nums(&[0.0, 0.0, 0.0]));
    assert!(res.is_err());
    assert!(res.unwrap_err().0.contains("no property matched"));
}

#[test]
fn match_key_path_matches_exact_paths() {
    use tgs::match_key_path;
    assert!(match_key_path("A.B.C", &["A".into(), "B".into(), "C".into()]));
    assert!(!match_key_path("A.B.C", &["A".into(), "B".into()]));
}

#[test]
fn match_key_path_matches_star_wildcard() {
    use tgs::match_key_path;
    assert!(match_key_path("A.*.C", &["A".into(), "B".into(), "C".into()]));
    assert!(!match_key_path("A.*.C", &["A".into(), "B".into(), "D".into()]));
}

#[test]
fn match_key_path_matches_globstar() {
    use tgs::match_key_path;
    assert!(match_key_path("**.Fill", &["Layer 1".into(), "Group 1".into(), "Fill".into()]));
    assert!(match_key_path("Layer 1.**", &["Layer 1".into(), "Group 1".into(), "Fill".into()]));
    assert!(!match_key_path("Layer 1.**", &["Layer 2".into(), "Group 1".into()]));
    assert!(match_key_path("**", &["anything".into(), "at".into(), "all".into()]));
}

#[test]
fn frame_at_pos_maps_position_to_a_frame() {
    let anim = parse(jobj(vec![("layers", jarr(vec![]))]));
    assert_eq!(frame_at_pos(&anim, 0.0), 0.0);
    assert_eq!(frame_at_pos(&anim, 1.0), 180.0);
    assert_eq!(frame_at_pos(&anim, 0.5), 90.0);
    assert_eq!(frame_at_pos(&anim, -1.0), 0.0);
    assert_eq!(frame_at_pos(&anim, 5.0), 180.0);
}

#[test]
fn parses_standalone_rounded_corner_shapes() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("rd")), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(5.0))]))]), jobj(vec![("ty", js("rc")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(50.0), jn(50.0)]))]))])]))])]))]));
    let shapes = anim.layers[0].shapes.as_ref().unwrap();
    let corner = &shapes[0];
    assert_eq!(corner.shape_type, "roundedCorner");
    assert_eq!(corner.radius.as_ref().unwrap().value, jn(5.0));
}

#[test]
fn parses_merge_shapes_with_a_merge_mode() {
    let anim = parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![])), ("shapes", jarr(vec![jobj(vec![("ty", js("mm")), ("mm", jn(2.0))]), jobj(vec![("ty", js("rc")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(50.0), jn(50.0)]))]))])]))])]))]));
    let shapes = anim.layers[0].shapes.as_ref().unwrap();
    let merge = &shapes[0];
    assert_eq!(merge.shape_type, "merge");
    assert_eq!(merge.merge_mode, Some(2.0));
}

#[test]
fn whole_still_static_composition_checks() {
    let raw = tgs_json(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ks", jobj(vec![]))])]))]));
    let opts = ParseOptions { key: Some("probe".to_string()), cache: true };
    let anim = parse_tgs(&raw, Some(opts)).unwrap();
    assert!(!has_animated_properties(&anim));
    assert!(!anim.is3d);
}

fn anim_with_fill() -> ParsedAnimation {
    parse(jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("nm", js("Layer 1")), ("ks", jobj(vec![("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0)]))]))])), ("shapes", jarr(vec![jobj(vec![("ty", js("gr")), ("nm", js("Group 1")), ("it", jarr(vec![jobj(vec![("ty", js("fl")), ("nm", js("Fill 1")), ("c", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(1.0), jn(0.0), jn(0.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("r", jn(1.0))]), jobj(vec![("ty", js("st")), ("nm", js("Stroke 1")), ("c", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(1.0), jn(0.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("w", jobj(vec![("a", jn(0.0)), ("k", jn(2.0))]))]), jobj(vec![("ty", js("tr")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))]))])]))])]))])]))]))
}

fn nth_child(anim: &ParsedAnimation, layer: usize, shape: usize, child: usize) -> &ParsedShape {
    anim.layers[layer]
        .shapes
        .as_ref()
        .unwrap()
        .get(shape)
        .unwrap()
        .children
        .as_ref()
        .unwrap()
        .get(child)
        .unwrap()
}

fn nums(v: &[f64]) -> PropertyValue {
    PropertyValue::Numbers(v.to_vec())
}

fn rich_body() -> JsonValue {
    jobj(vec![("layers", jarr(vec![jobj(vec![("ind", jn(1.0)), ("ty", jn(4.0)), ("nm", js("L1")), ("ip", jn(0.0)), ("op", jn(100.0)), ("st", jn(0.0)), ("sr", jn(1.0)), ("ks", jobj(vec![("o", jobj(vec![("a", jn(0.0)), ("k", jn(90.0))])), ("r", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)])), ("e", jarr(vec![jn(180.0)])), ("i", jobj(vec![("x", jarr(vec![jn(0.4)])), ("y", jarr(vec![jn(1.0)]))])), ("o", jobj(vec![("x", jarr(vec![jn(0.6)])), ("y", jarr(vec![jn(0.0)]))])), ("to", jarr(vec![jn(1.0), jn(0.0)])), ("ti", jarr(vec![jn(0.0), jn(-1.0)]))]), jobj(vec![("t", jn(50.0)), ("h", jn(1.0))])]))])), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(10.5), jn(-2.25), jn(0.0)]))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(120.0), jn(80.0), jn(100.0)]))]))])), ("shapes", jarr(vec![jobj(vec![("ty", js("gr")), ("nm", js("G")), ("it", jarr(vec![jobj(vec![("ty", js("sh")), ("ks", jobj(vec![("a", jn(0.0)), ("k", jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(0.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)])]))]))]))]), jobj(vec![("ty", js("gf")), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("e", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(10.0), jn(0.0)]))])), ("t", jn(1.0)), ("g", jobj(vec![("p", jn(2.0)), ("k", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(1.0), jn(1.0), jn(1.0), jn(1.0), jn(0.0), jn(0.2), jn(0.0)]))]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(80.0))]))]), jobj(vec![("ty", js("st")), ("c", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(1.0), jn(1.0), jn(1.0), jn(1.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("w", jobj(vec![("a", jn(0.0)), ("k", jn(3.0))])), ("lc", jn(2.0)), ("lj", jn(2.0)), ("ml", jn(4.0)), ("d", jarr(vec![jobj(vec![("n", js("d")), ("nm", js("dash")), ("v", jobj(vec![("a", jn(0.0)), ("k", jn(5.0))]))])]))]), jobj(vec![("ty", js("tr")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(1.0), jn(2.0)]))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(50.0), jn(200.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(15.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(60.0))])), ("sk", jobj(vec![("a", jn(0.0)), ("k", jn(5.0))])), ("sa", jobj(vec![("a", jn(0.0)), ("k", jn(10.0))]))])]))]), jobj(vec![("ty", js("sr")), ("sy", jn(2.0)), ("pt", jobj(vec![("a", jn(0.0)), ("k", jn(5.0))])), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(3.0), jn(4.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("or", jobj(vec![("a", jn(0.0)), ("k", jn(40.0))])), ("ir", jobj(vec![("a", jn(0.0)), ("k", jn(20.0))])), ("os", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("is", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("d", jn(1.0))]), jobj(vec![("ty", js("rc")), ("d", jn(2.0)), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(60.0), jn(20.0)]))])), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(5.0), jn(5.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(8.0))])), ("rd", jobj(vec![("a", jn(0.0)), ("k", jn(8.0))]))]), jobj(vec![("ty", js("rp")), ("c", jobj(vec![("a", jn(0.0)), ("k", jn(3.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("m", jn(1.0)), ("tr", jobj(vec![("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(10.0), jn(0.0)]))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))]))]))]), jobj(vec![("ty", js("tm")), ("s", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0)]))]), jobj(vec![("t", jn(40.0)), ("s", jarr(vec![jn(10.0)]))])]))])), ("e", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("m", jn(2.0))])])), ("masksProperties", jarr(vec![jobj(vec![("nm", js("M1")), ("inv", JsonValue::Bool(true)), ("mode", js("s")), ("pt", jobj(vec![("a", jn(0.0)), ("k", jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(1.0), jn(1.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)])]))]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("x", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))]))])])), ("tm", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("bm", jn(1.0)), ("sc", js("#ff0000")), ("sw", jn(11.0)), ("sh", jn(22.0)), ("w", jn(33.0)), ("h", jn(44.0)), ("ao", jn(1.0)), ("ddd", jn(1.0)), ("tt", jn(2.0)), ("td", jn(1.0))]), jobj(vec![("ind", jn(2.0)), ("ty", jn(0.0)), ("refId", js("a1")), ("nm", js("PRE")), ("ks", jobj(vec![])), ("parent", jn(1.0))])])), ("assets", jarr(vec![jobj(vec![("id", js("a1")), ("w", jn(5.0)), ("h", jn(6.0)), ("u", js("img/")), ("p", js("pic.png")), ("layers", jarr(vec![jobj(vec![("ind", jn(1.0)), ("ty", jn(2.0)), ("ks", jobj(vec![]))])]))]), jobj(vec![("id", js("a2")), ("layers", jarr(vec![]))])])), ("markers", jarr(vec![jobj(vec![("cm", js("m0")), ("tm", jn(5.0)), ("dr", jn(10.0))]), jobj(vec![("cm", js("m1")), ("tm", jn(20.5)), ("dr", jn(0.0))])])), ("chars", jarr(vec![jobj(vec![("ch", js("A")), ("style", js("b")), ("size", jn(10.0)), ("family", js("F"))])]))])
}

#[test]
fn lex_parser_matches_serde_parser() {
    use tgs::bridge::encode_animation;
    let a = parse(rich_body());
    let j = tgs_json(rich_body());
    let b = tgs::parse_tgs_lex(&j, None).unwrap();
    assert_eq!(encode_animation(&a), encode_animation(&b));
}

#[test]
fn lex_parser_matches_serde_parser_on_edge_json() {
    use tgs::bridge::encode_animation;
    let cases = [
        r#"{"tgs":1,"v":"5.6.0","fr":25,"ip":-1.5,"op":1e2,"w":100,"h":100,"layers":[],"markers":null}"#,
        r#"{"tgs":1,"fr":30,"ip":0,"op":10,"w":1,"h":2,"layers":[{"ind":1,"ty":4,"ks":{},"nm":"é\"x\n\t"}],"assets":[]}"#,
        r#"{"tgs":1,"fr":30,"ip":0,"op":10,"w":1,"h":2,"layers":[],"assets":[{"id":"A\u0041", "p":"a.b"}]}"#,
    ];
    for j in cases {
        let a = tgs::parse_tgs(j, None).unwrap();
        let b = tgs::parse_tgs_lex(j, None).unwrap();
        assert_eq!(encode_animation(&a), encode_animation(&b), "case {j}");
    }
    let bad = ["", "not json", "{\"layers\":123}", "{\"tgs\":1,\"fr\":30,\"ip\":0,\"op\":10,\"w\":1,\"h\":2}"];
    for j in bad {
        assert!(tgs::parse_tgs(j, None).is_err());
        assert!(tgs::parse_tgs_lex(j, None).is_err(), "case {j}");
    }
}

#[test]
fn direct_parser_matches_tree_parser_on_structural_edge_json() {
    use tgs::bridge::encode_animation;
    fn anim_with(layers: &str, assets: &str) -> String {
        format!(
            r#"{{"tgs":1,"fr":30,"ip":0,"op":10,"w":100,"h":100,"layers":{layers},"assets":{assets}}}"#
        )
    }
    let cases = vec![
        anim_with("[1,2]", "[]"),
        anim_with("[1,2,3]", "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{}},2,"x",[3]]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{},"shapes":[1,2]}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{},"shapes":[1,2,3]}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{},"shapes":[{"ty":"gr","it":[1,2]}]}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{},"shapes":[{"ty":"gr","it":[1,2,3]}]}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{},"masksProperties":[1,2]}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{},"masksProperties":[1,2,3]}]"#, "[]"),
        anim_with("[]", r#"[{"id":"a","layers":[1,2]},{"id":"b","layers":[1,2,3]}]"#),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":1,"k":[{"t":0},{"t":0,"s":[0]},{"t":10,"s":[1]}]}}}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":1,"k":[{"t":0,"s":[0]},5,{"t":10,"s":[1]}]}}}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":1,"k":[{"t":0,"s":[0]},{"t":10}]}}}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":1,"k":[{"s":[0]},{"t":0,"s":[1]}]}}}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":1,"k":[0,{"t":0,"s":[1]}]}}}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":1,"k":[{"t":0,"s":[0]},{"t":1,"s":[1]},null]}}}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":1,"k":[{"t":10,"s":[1]},{"t":0,"s":[0]}]}}}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":1,"k":[{"a":1},{"b":2}]}}}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":0,"k":[0,1]}}}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":0,"k":[0,1,2]}}}]"#, "[]"),
        anim_with(r#"[{"ind":1,"ty":4,"ks":{"o":{"a":1,"k":[{"t":[3],"s":[0],"e":[1],"to":[1,2],"ti":[3,4],"h":1,"n":"x","o":{"x":[0.1],"y":[0.2]},"i":{"x":[0.3],"y":[0.4]}},{"t":9,"s":[1]}]}}}]"#, "[]"),
    ];
    for j in &cases {
        let a = tgs::parse_tgs(j, None);
        let b = tgs::parse_tgs_lex(j, None);
        assert!(a.is_ok(), "direct parse failed: {j}");
        assert!(b.is_ok(), "tree parse failed: {j}");
        assert_eq!(
            encode_animation(&a.unwrap()),
            encode_animation(&b.unwrap()),
            "case {j}"
        );
    }
}
