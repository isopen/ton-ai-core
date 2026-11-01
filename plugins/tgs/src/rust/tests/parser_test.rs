use serde_json::{json, Value as JsonValue};
use tgs::{
    frame_at_pos, has_animated_properties, interpolate_keyframes, layer_info, parse_tgs, set_value, FillRule,
    GradientType, LayerType, MaskMode, MatteType, ParseOptions, ParsedKeyframe, ParsedProperty, ParsedShape,
    Property, PropertyValue, ParsedAnimation, TrimMode,
};
use tgs::jsutil::unwrap_value;

fn tgs_json(body: JsonValue) -> String {
    let mut obj = json!({
        "tgs": 1,
        "v": "5.5.2",
        "fr": 60,
        "ip": 0,
        "op": 180,
        "w": 512,
        "h": 512,
        "nm": "test",
    });
    let map = obj.as_object_mut().unwrap();
    for (k, v) in body.as_object().unwrap() {
        map.insert(k.clone(), v.clone());
    }
    obj.to_string()
}

fn parse(body: JsonValue) -> ParsedAnimation {
    parse_tgs(&tgs_json(body), None).unwrap()
}

fn kf_from(v: &JsonValue) -> ParsedKeyframe {
    let bezier = |key: &str| -> Option<tgs::BezierEasingDef> {
        v.get(key).map(|d| tgs::BezierEasingDef {
            x: d.get("x").map(|a| a.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()),
            y: d.get("y").map(|a| a.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()),
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
        to: v.get("to").map(|t| t.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()),
        ti: v.get("ti").map(|t| t.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()),
        h: v.get("h").filter(|h| !h.is_null()).cloned(),
        n: None,
    }
}

fn manual_prop(keyframes: &[&JsonValue]) -> ParsedProperty {
    let raw_first = unwrap_value(&keyframes[0]["s"]);
    ParsedProperty {
        animated: true,
        value: raw_first.clone(),
        keyframes: Some(keyframes.iter().map(|k| kf_from(k)).collect()),
        ..ParsedProperty::default()
    }
}

fn arr_f64(v: &JsonValue) -> Vec<f64> {
    v.as_array().map(|a| a.iter().filter_map(|x| x.as_f64()).collect()).unwrap_or_default()
}

#[test]
fn parses_the_composition_header() {
    let anim = parse(json!({ "layers": [] }));
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
    let anim = parse(json!({ "layers": [
        { "ind": 0, "ty": 4, "ip": 0, "op": 60, "st": 0, "nm": "ShapeLayer", "ks": {} },
        { "ind": 1, "ty": 3, "ip": 0, "op": 60, "ks": {}, "nm": "NullLayer" }
    ]}));
    assert_eq!(anim.layers.len(), 2);
    assert_eq!(anim.layers[0].layer_type, LayerType::Shape);
    assert_eq!(anim.layers[0].in_frame, Some(0.0));
    assert_eq!(anim.layers[0].out_frame, Some(60.0));
    assert_eq!(anim.layers[0].name.as_deref(), Some("ShapeLayer"));
    assert_eq!(anim.layers[1].layer_type, LayerType::Null);
}

#[test]
fn parses_solid_and_precomp_layers_with_assets() {
    let anim = parse(json!({
        "assets": [{ "id": "pre1", "w": 100, "h": 100, "layers": [{ "ind": 0, "ty": 4, "ks": {} }] }],
        "layers": [
            { "ind": 0, "ty": 1, "sc": "#FF0000", "sw": 512, "sh": 512, "ks": {} },
            { "ind": 1, "ty": 0, "refId": "pre1", "ks": {} }
        ]
    }));
    assert_eq!(anim.layers[0].layer_type, LayerType::Solid);
    assert_eq!(anim.layers[0].solid_color.as_deref(), Some("#FF0000"));
    assert_eq!(anim.layers[0].solid_width, Some(512.0));
    assert_eq!(anim.layers[1].layer_type, LayerType::Precomp);
    assert_eq!(anim.layers[1].ref_id.as_deref(), Some("pre1"));
    assert_eq!(anim.assets[0].layers.as_ref().unwrap().len(), 1);
}

#[test]
fn parses_transform_properties() {
    let anim = parse(json!({
        "layers": [{ "ind": 0, "ty": 4, "ks": {
            "o": { "a": 0, "k": 100 }, "r": { "a": 0, "k": 0 }, "p": { "a": 0, "k": [10, 20] },
            "a": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }
        } }]
    }));
    let tr = &anim.layers[0].transform;
    assert_eq!(tr.opacity.as_ref().unwrap().value, json!(100));
    assert_eq!(tr.position.as_ref().unwrap().value, json!([10, 20]));
    assert_eq!(tr.scale.as_ref().unwrap().value, json!([100, 100]));
    assert!(!tr.opacity.as_ref().unwrap().animated);
}

#[test]
fn parses_shape_groups_rects_ellipses_fills_and_strokes() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "gr",
                "nm": "Group 1",
                "it": [
                    { "ty": "rc", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 50] }, "r": { "a": 0, "k": 5 }, "nm": "Rect 1" },
                    { "ty": "el", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [20, 20] }, "nm": "Ellipse 1" },
                    { "ty": "fl", "c": { "a": 0, "k": [1, 0, 0] }, "o": { "a": 0, "k": 100 }, "r": 1, "nm": "Fill 1" },
                    { "ty": "st", "c": { "a": 0, "k": [0, 1, 0] }, "o": { "a": 0, "k": 50 }, "w": { "a": 0, "k": 4 }, "lc": 2, "lj": 2, "nm": "Stroke 1" },
                    { "ty": "tr", "p": { "a": 0, "k": [10, 10] }, "a": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }, "r": { "a": 0, "k": 0 }, "o": { "a": 0, "k": 100 } },
                ],
            }],
        }]
    }));
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
    assert_eq!(rect.size.as_ref().unwrap().value, json!([100, 50]));
    assert_eq!(rect.radius.as_ref().unwrap().value, json!(5));
    assert_eq!(ellipse.shape_type, "ellipse");
    assert_eq!(fill.shape_type, "fill");
    assert_eq!(fill.color.as_ref().unwrap().value, json!([1, 0, 0]));
    assert_eq!(fill.fill_rule, Some(FillRule::Winding));
    assert_eq!(stroke.shape_type, "stroke");
    assert_eq!(stroke.stroke_width.as_ref().unwrap().value, json!(4));
    assert_eq!(stroke.line_cap, Some(2.0));
    assert_eq!(transform.shape_type, "transform");
    assert_eq!(transform.position.as_ref().unwrap().value, json!([10, 10]));
}

#[test]
fn parses_rect_ellipse_direction_and_rd_attachment() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [
                { "ty": "rc", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 50] }, "d": 3, "rd": { "a": 0, "k": 8 } },
                { "ty": "el", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [20, 20] }, "d": 1 },
                { "ty": "rc", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [30, 30] } },
            ],
        }]
    }));
    let shapes = anim.layers[0].shapes.as_ref().unwrap();
    let rect = &shapes[0];
    let ellipse = &shapes[1];
    let plain = &shapes[2];
    assert_eq!(rect.direction, Some(3.0));
    let rd = rect.rd.as_ref().unwrap();
    assert_eq!(rd.shape_type, "roundedCorner");
    assert_eq!(rd.radius.as_ref().unwrap().value, json!(8));
    assert_eq!(ellipse.direction, Some(1.0));
    assert!(plain.direction.is_none());
    assert!(plain.rd.is_none());
}

#[test]
fn parses_path_vertices_from_ks() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "sh", "nm": "Path 1",
                "ks": { "a": 0, "k": { "c": true, "v": [[0, 0], [10, 0]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]] } }
            }],
        }]
    }));
    let path = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(path.shape_type, "path");
    let vertices = path.vertices.as_ref().unwrap();
    assert_eq!(vertices.value["c"], json!(true));
    assert_eq!(vertices.value["v"].as_array().unwrap().len(), 2);
}

#[test]
fn parses_trim_paths_with_animated_start_end_offset() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "tm", "nm": "Trim 1",
                "s": { "a": 1, "k": [
                    { "t": 0, "s": [0], "i": { "x": [0], "y": [0] }, "o": { "x": [1], "y": [1] } },
                    { "t": 60, "s": [100] }
                ] },
                "e": { "a": 0, "k": 100 },
                "o": { "a": 0, "k": 0 },
                "m": 1
            }],
        }]
    }));
    let trim = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(trim.shape_type, "trim");
    let start = trim.start.as_ref().unwrap();
    assert!(start.animated);
    assert_eq!(start.keyframes.as_ref().unwrap().len(), 2);
    assert_eq!(trim.end.as_ref().unwrap().value, json!(100));
    assert_eq!(trim.trim_mode, Some(TrimMode::Simultaneously));
    assert_eq!(interpolate_keyframes(start, 30.0), json!([50.0]));
    assert_eq!(interpolate_keyframes(start, 60.0), json!([100]));
    assert_eq!(interpolate_keyframes(start, 180.0), json!([100]));
}

#[test]
fn parses_gradient_fill_with_stops_and_radial_type() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "gf", "nm": "Grad 1", "t": 2,
                "s": { "a": 0, "k": [0, 0] },
                "e": { "a": 0, "k": [100, 100] },
                "o": { "a": 0, "k": 100 },
                "g": { "p": 2, "k": [0, 1, 0, 0, 1, 0, 0, 1] }
            }],
        }]
    }));
    let grad = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().gradient.as_ref().unwrap();
    assert_eq!(grad.gradient_type, GradientType::Radial);
    assert_eq!(grad.start_point.value, json!([0, 0]));
    assert_eq!(grad.end_point.value, json!([100, 100]));
    assert_eq!(grad.stops.value, json!([0, 1, 0, 0, 1, 0, 0, 1]));
}

#[test]
fn parses_gradient_stroke_type() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "gs",
                "w": { "a": 0, "k": 3 },
                "s": { "a": 0, "k": [0, 0] },
                "e": { "a": 0, "k": [10, 10] },
                "g": { "p": 2, "k": [0, 0, 0, 0, 1, 0, 0, 1] }
            }],
        }]
    }));
    let shape = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(shape.shape_type, "gradientStroke");
    assert_eq!(shape.stroke_width.as_ref().unwrap().value, json!(3));
    assert!(shape.gradient.is_some());
}

#[test]
fn parses_stroke_dashes() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "st",
                "c": { "a": 0, "k": [0, 0, 0] },
                "o": { "a": 0, "k": 100 },
                "w": { "a": 0, "k": 2 },
                "d": [
                    { "n": "d", "nm": "dash", "v": { "a": 0, "k": 10 } },
                    { "n": "g", "nm": "gap", "v": { "a": 0, "k": 5 } }
                ]
            }],
        }]
    }));
    let dashes = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().dashes.as_ref().unwrap();
    assert_eq!(dashes.len(), 2);
    assert_eq!(dashes[0].name.as_deref(), Some("d"));
    assert_eq!(dashes[0].value.value, json!(10));
    assert_eq!(dashes[1].value.value, json!(5));
}

#[test]
fn parses_star_with_point_count_radii_and_roundness() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "sr",
                "sy": 1,
                "pt": { "a": 0, "k": 5 },
                "p": { "a": 0, "k": [50, 50] },
                "r": { "a": 0, "k": 0 },
                "or": { "a": 0, "k": 40 },
                "ir": { "a": 0, "k": 20 },
                "os": 0.2,
                "is": 0.1
            }],
        }]
    }));
    let star = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(star.shape_type, "star");
    assert_eq!(star.points.as_ref().unwrap().value, json!(5));
    assert_eq!(star.outer_radius.as_ref().unwrap().value, json!(40));
    assert_eq!(star.inner_radius.as_ref().unwrap().value, json!(20));
    assert_eq!(star.outer_roundness.as_ref().unwrap().value, json!(0.2));
    assert_eq!(star.inner_roundness.as_ref().unwrap().value, json!(0.1));
    assert_eq!(star.star_type, Some(1.0));
}

#[test]
fn parses_repeater_with_copies_and_transform() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "rp",
                "c": { "a": 0, "k": 3 },
                "o": { "a": 0, "k": 0 },
                "m": 1,
                "tr": {
                    "p": { "a": 0, "k": [10, 0] },
                    "a": { "a": 0, "k": [0, 0] },
                    "s": { "a": 0, "k": [100, 100] },
                    "r": { "a": 0, "k": 0 },
                    "o": { "a": 0, "k": 100 },
                    "so": { "a": 0, "k": 100 },
                    "eo": { "a": 0, "k": 0 }
                }
            }],
        }]
    }));
    let repeater = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(repeater.shape_type, "repeater");
    assert_eq!(repeater.copies.as_ref().unwrap().value, json!(3));
    let tr = repeater.transform.as_ref().unwrap();
    assert_eq!(tr.position.as_ref().unwrap().value, json!([10, 0]));
    assert_eq!(tr.start_opacity.as_ref().unwrap().value, json!(100));
    assert_eq!(tr.end_opacity.as_ref().unwrap().value, json!(0));
}

#[test]
fn parses_masks_and_matte() {
    let anim = parse(json!({
        "layers": [
            {
                "ind": 0, "ty": 4, "ks": {}, "tt": 1,
                "masksProperties": [{
                    "nm": "Mask 1",
                    "inv": true,
                    "mode": "s",
                    "pt": { "a": 0, "k": { "c": true, "v": [[0, 0], [10, 0], [10, 10]], "i": [[0, 0], [0, 0], [0, 0]], "o": [[0, 0], [0, 0], [0, 0]] } },
                    "o": { "a": 0, "k": 100 },
                    "x": { "a": 0, "k": 0 }
                }]
            },
            { "ind": 1, "ty": 4, "ks": {}, "td": 1 }
        ]
    }));
    let layer = &anim.layers[0];
    assert_eq!(layer.matte_type, Some(MatteType::Alpha));
    let masks = layer.masks.as_ref().unwrap();
    assert_eq!(masks.len(), 1);
    assert_eq!(masks[0].mode, MaskMode::Subtract);
    assert!(masks[0].inverted);
    assert_eq!(masks[0].opacity.value, json!(100));
    assert_eq!(anim.layers[1].matte_target, Some(true));
}

#[test]
fn parses_markers() {
    let anim = parse(json!({ "markers": [{ "cm": "loop", "dr": 30, "tm": 0 }], "layers": [] }));
    let markers = anim.markers.as_ref().unwrap();
    assert_eq!(markers.len(), 1);
    assert_eq!(markers[0].name.as_deref(), Some("loop"));
    assert_eq!(markers[0].start_frame, 0.0);
    assert_eq!(markers[0].end_frame, 30.0);
}

#[test]
fn parses_text_layers() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 5, "ks": {},
            "t": { "d": { "k": [{ "t": 0, "s": { "t": "Hello", "f": "Roboto", "s": 24, "fc": [1, 0, 0] } }] } }
        }]
    }));
    let text = anim.layers[0].text.as_ref().unwrap();
    assert_eq!(text.text, "Hello");
    assert_eq!(text.font_family.as_deref(), Some("Roboto"));
    assert_eq!(text.font_size, Some(24.0));
    assert_eq!(text.fill_color, Some(vec![1.0, 0.0, 0.0]));
}

#[test]
fn keeps_the_previous_end_value_when_the_tail_keyframe_has_no_start_value() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "tm",
                "s": { "a": 1, "k": [
                    { "t": 0, "s": [0], "e": [100], "i": { "x": [0], "y": [0] }, "o": { "x": [1], "y": [1] } },
                    { "t": 60 }
                ] },
                "e": { "a": 0, "k": 100 },
                "o": { "a": 0, "k": 0 },
                "m": 1
            }],
        }]
    }));
    let start = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().start.as_ref().unwrap();
    assert_eq!(start.keyframes.as_ref().unwrap().len(), 1);
    assert_eq!(interpolate_keyframes(start, 30.0), json!([50.0]));
    assert_eq!(interpolate_keyframes(start, 60.0), json!([100]));
    assert_eq!(interpolate_keyframes(start, 120.0), json!([100]));
}

#[test]
fn keeps_intermediate_keyframes_without_tangents_and_interpolates_them_linearly() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "tm",
                "s": { "a": 1, "k": [
                    { "t": 0, "s": [0], "i": { "x": [0], "y": [0] }, "o": { "x": [1], "y": [1] } },
                    { "t": 30, "s": [50] },
                    { "t": 60, "s": [100], "i": { "x": [0], "y": [0] }, "o": { "x": [1], "y": [1] } }
                ] },
                "e": { "a": 0, "k": 100 },
                "o": { "a": 0, "k": 0 },
                "m": 1
            }],
        }]
    }));
    let start = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().start.as_ref().unwrap();
    assert_eq!(start.keyframes.as_ref().unwrap().len(), 3);
    assert_eq!(interpolate_keyframes(start, 30.0), json!([50.0]));
    assert_eq!(interpolate_keyframes(start, 45.0), json!([75.0]));
    assert_eq!(interpolate_keyframes(start, 60.0), json!([100]));
}

#[test]
fn unwraps_array_wrapped_path_keyframe_values() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "sh", "nm": "Path 1",
                "ks": { "a": 1, "k": [
                    {
                        "t": 0,
                        "s": [{ "c": true, "v": [[0, 0], [10, 0]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]] }],
                        "i": { "x": [0], "y": [0] },
                        "o": { "x": [1], "y": [1] }
                    },
                    {
                        "t": 10,
                        "s": [{ "c": true, "v": [[100, 0], [110, 0]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]] }]
                    }
                ] }
            }],
        }]
    }));
    let vertices = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().vertices.as_ref().unwrap();
    let mid = interpolate_keyframes(vertices, 5.0);
    assert_eq!(mid["c"], json!(true));
    assert_eq!(mid["v"], json!([[50.0, 0.0], [60.0, 0.0]]));
}

#[test]
fn maps_trim_m2_to_individually() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{ "ty": "tm", "m": 2, "s": { "a": 0, "k": 0 }, "e": { "a": 0, "k": 100 }, "o": { "a": 0, "k": 0 } }]
        }]
    }));
    let trim = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    assert_eq!(trim.trim_mode, Some(TrimMode::Individually));
}

#[test]
fn parses_gradient_highlight_and_color_points() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "gf",
                "t": 2,
                "h": { "a": 0, "k": 0.5 },
                "a": { "a": 0, "k": 90 },
                "s": { "a": 0, "k": [0, 0] },
                "e": { "a": 0, "k": [100, 100] },
                "o": { "a": 0, "k": 100 },
                "g": { "p": 2, "k": [0, 0, 0, 0, 1, 0, 0, 1] }
            }],
        }]
    }));
    let grad = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().gradient.as_ref().unwrap();
    assert_eq!(grad.highlight_length.as_ref().unwrap().value, json!(0.5));
    assert_eq!(grad.highlight_angle.as_ref().unwrap().value, json!(90));
    assert_eq!(grad.color_points, Some(2.0));
}

#[test]
fn parses_split_dimension_positions() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4,
            "ks": { "p": {
                "s": true,
                "x": { "a": 1, "k": [{ "t": 0, "s": [50] }, { "t": 30, "s": [50] }, { "t": 60, "s": [50] }] },
                "y": { "a": 1, "k": [{ "t": 0, "s": [50] }, { "t": 30, "s": [70] }, { "t": 60, "s": [50] }] }
            } }
        }]
    }));
    let p = anim.layers[0].transform.position.as_ref().unwrap();
    assert!(p.animated == false);
    assert!(p.x.is_some());
    assert!(p.y.is_some());
    assert_eq!(interpolate_keyframes(p, 0.0), json!([50.0, 50.0]));
    assert_eq!(interpolate_keyframes(p, 15.0), json!([50.0, 60.0]));
    assert_eq!(interpolate_keyframes(p, 30.0), json!([50.0, 70.0]));
    let late = interpolate_keyframes(p, 59.0);
    let vals = arr_f64(&late);
    assert_eq!(vals[0], 50.0);
    assert!((vals[1] - 50.66666666666667).abs() < 1e-9);
}

#[test]
fn parses_linear_position_keyframes_without_tangents_as_animated() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4,
            "ks": { "p": { "a": 1, "k": [{ "t": 0, "s": [50, 50] }, { "t": 30, "s": [50, 70] }, { "t": 60, "s": [50, 50] }] } }
        }]
    }));
    let p = anim.layers[0].transform.position.as_ref().unwrap();
    assert!(p.animated);
    assert_eq!(p.keyframes.as_ref().unwrap().len(), 3);
    assert_eq!(interpolate_keyframes(p, 0.0), json!([50, 50]));
    assert_eq!(interpolate_keyframes(p, 15.0), json!([50.0, 60.0]));
    assert_eq!(interpolate_keyframes(p, 30.0), json!([50.0, 70.0]));
    let late = interpolate_keyframes(p, 59.0);
    let vals = arr_f64(&late);
    assert_eq!(vals[0], 50.0);
    assert!((vals[1] - 50.66666666666667).abs() < 1e-9);
}

#[test]
fn parses_mask_mode_f_to_difference() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "masksProperties": [{
                "mode": "f",
                "pt": { "a": 0, "k": { "c": true, "v": [[0, 0], [10, 0]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]] } },
                "o": { "a": 0, "k": 100 }
            }]
        }]
    }));
    assert_eq!(anim.layers[0].masks.as_ref().unwrap()[0].mode, MaskMode::Difference);
}

#[test]
fn drops_hidden_shapes() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [{
                "ty": "gr",
                "it": [
                    { "ty": "fl", "hd": true, "c": { "a": 0, "k": [1, 0, 0] }, "o": { "a": 0, "k": 100 } },
                    { "ty": "el", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [10, 10] } }
                ]
            }]
        }]
    }));
    let children = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap().children.as_ref().unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(children[0].shape_type, "ellipse");
}

#[test]
fn forces_hidden_layers_to_null_and_drops_their_content() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "hd": true, "ks": {},
            "shapes": [{ "ty": "fl", "c": { "a": 0, "k": [1, 0, 0] }, "o": { "a": 0, "k": 100 } }]
        }]
    }));
    assert_eq!(anim.layers.len(), 1);
    assert_eq!(anim.layers[0].layer_type, LayerType::Null);
    assert_eq!(anim.layers[0].hidden, Some(true));
    assert!(anim.layers[0].shapes.is_none());
    assert!(anim.layers[0].transform.opacity.is_some());
}

#[test]
fn keeps_layers_without_a_transform_and_drops_self_parented_layers() {
    let anim = parse(json!({ "layers": [
        { "ind": 0, "ty": 4 },
        { "ind": 1, "ty": 4, "parent": 1, "ks": {} },
        { "ind": 2, "ty": 4, "ks": {} }
    ]}));
    assert_eq!(anim.layers.len(), 2);
    assert_eq!(anim.layers[0].index, 0.0);
    assert!(anim.layers[0].transform.opacity.is_some());
    assert_eq!(anim.layers[1].index, 2.0);
}

#[test]
fn parses_precomp_layer_size() {
    let anim = parse(json!({ "layers": [{ "ind": 0, "ty": 0, "w": 300, "h": 200, "ks": {} }] }));
    assert_eq!(anim.layers[0].layer_width, Some(300.0));
    assert_eq!(anim.layers[0].layer_height, Some(200.0));
}

#[test]
fn layer_info_returns_name_in_out_for_each_layer() {
    let anim = parse(json!({ "layers": [
        { "ind": 0, "ty": 4, "nm": "A", "ip": 0, "op": 60, "ks": {} },
        { "ind": 1, "ty": 4, "nm": "B", "ip": 60, "op": 120, "ks": {} }
    ]}));
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
    let p = ParsedProperty { animated: false, value: json!(42), ..ParsedProperty::default() };
    assert_eq!(interpolate_keyframes(&p, 10.0), json!(42));
}

#[test]
fn interp_interpolates_linearly_without_easing() {
    let k0 = json!({ "t": 0, "s": [0, 0] });
    let k1 = json!({ "t": 10, "s": [100, 200] });
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 0.0), json!([0, 0]));
    assert_eq!(interpolate_keyframes(&p, 5.0), json!([50.0, 100.0]));
    assert_eq!(interpolate_keyframes(&p, 10.0), json!([100, 200]));
}

#[test]
fn interp_clamps_frames_before_first_and_after_last_keyframe() {
    let k0 = json!({ "t": 10, "s": [0] });
    let k1 = json!({ "t": 20, "s": [100] });
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 0.0), json!([0]));
    assert_eq!(interpolate_keyframes(&p, 99.0), json!([100]));
}

#[test]
fn interp_uses_end_value_of_the_last_keyframe_beyond_its_frame() {
    let k0 = json!({ "t": 0, "s": [0], "e": [50] });
    let k1 = json!({ "t": 10, "s": [100], "e": [140] });
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 5.0), json!([25.0]));
    assert_eq!(interpolate_keyframes(&p, 10.0), json!([140]));
    assert_eq!(interpolate_keyframes(&p, 15.0), json!([140]));
}

#[test]
fn interp_fills_missing_end_values_from_the_next_keyframe() {
    let k0 = json!({ "t": 0, "s": [0], "e": [50] });
    let k1 = json!({ "t": 10, "s": [100] });
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 5.0), json!([50.0]));
}

#[test]
fn interp_holds_value_for_hold_keyframes() {
    let k0 = json!({ "t": 0, "s": [10] });
    let k1 = json!({ "t": 10, "s": [20], "h": 1 });
    let k2 = json!({ "t": 20, "s": [30] });
    let p = manual_prop(&[&k0, &k1, &k2]);
    assert_eq!(interpolate_keyframes(&p, 5.0), json!([15.0]));
    assert_eq!(interpolate_keyframes(&p, 10.0), json!([20]));
    assert_eq!(interpolate_keyframes(&p, 15.0), json!([20]));
    assert_eq!(interpolate_keyframes(&p, 19.0), json!([20]));
    assert_eq!(interpolate_keyframes(&p, 20.0), json!([30]));
}

#[test]
fn interp_applies_cubic_bezier_easing_like_rlottie() {
    let k0 = json!({
        "t": 0,
        "s": [0],
        "i": { "x": [0.667], "y": [1] },
        "o": { "x": [0.333], "y": [0] }
    });
    let k1 = json!({ "t": 100, "s": [100] });
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
    let k0 = json!({
        "t": 0,
        "s": [0],
        "o": { "x": [0], "y": [0] },
        "i": { "x": [1], "y": [1] }
    });
    let k1 = json!({ "t": 100, "s": [100] });
    let p = manual_prop(&[&k0, &k1]);
    assert!((arr_f64(&interpolate_keyframes(&p, 25.0))[0] - 25.0).abs() <= 5e-7);
    assert!((arr_f64(&interpolate_keyframes(&p, 50.0))[0] - 50.0).abs() <= 5e-7);
}

#[test]
fn interp_interpolates_scalars() {
    let k0 = json!({ "t": 0, "s": 0 });
    let k1 = json!({ "t": 10, "s": 100 });
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 5.0), json!(50.0));
}

#[test]
fn interp_interpolates_colors() {
    let k0 = json!({ "t": 0, "s": [1, 0, 0] });
    let k1 = json!({ "t": 10, "s": [0, 0, 1] });
    let p = manual_prop(&[&k0, &k1]);
    assert_eq!(interpolate_keyframes(&p, 5.0), json!([0.5, 0.0, 0.5]));
}

#[test]
fn interp_interpolates_path_vertex_data() {
    let k0 = json!({ "t": 0, "s": { "c": true, "v": [[0, 0], [10, 0]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]] } });
    let k1 = json!({ "t": 10, "s": { "c": true, "v": [[100, 0], [110, 0]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]] } });
    let p = manual_prop(&[&k0, &k1]);
    let mid = interpolate_keyframes(&p, 5.0);
    assert_eq!(mid["v"], json!([[50.0, 0.0], [60.0, 0.0]]));
}

#[test]
fn interp_interpolates_along_the_spatial_bezier_with_to_ti_tangents() {
    let k0 = json!({ "t": 0, "s": [0, 0], "to": [100, 80], "ti": [-100, 20] });
    let k1 = json!({ "t": 10, "s": [200, 0] });
    let p = manual_prop(&[&k0, &k1]);
    let mid = interpolate_keyframes(&p, 5.0);
    let vals = arr_f64(&mid);
    assert!(vals[0] > 90.0 && vals[0] <= 100.0);
    assert!(vals[1] > 20.0 && vals[1] < 50.0);
}

#[test]
fn interp_uses_split_dimension_keyframes_for_x() {
    let p = ParsedProperty {
        animated: false,
        value: json!([0, 80]),
        x: Some(Box::new(ParsedProperty {
            animated: true,
            value: json!([0]),
            keyframes: Some(vec![
                kf_from(&json!({ "t": 0, "s": [500] })),
                kf_from(&json!({ "t": 10, "s": [500] })),
            ]),
            ..ParsedProperty::default()
        })),
        ..ParsedProperty::default()
    };
    assert_eq!(interpolate_keyframes(&p, 5.0), json!([500.0, 80.0]));
}

#[test]
fn interp_animated_one_component_main_track_maps_to_axis_0() {
    let p = ParsedProperty {
        animated: true,
        value: json!([0]),
        keyframes: Some(vec![
            kf_from(&json!({ "t": 0, "s": [0] })),
            kf_from(&json!({ "t": 10, "s": [100] })),
        ]),
        x: Some(Box::new(ParsedProperty {
            animated: true,
            value: json!([0]),
            keyframes: Some(vec![
                kf_from(&json!({ "t": 0, "s": [500] })),
                kf_from(&json!({ "t": 10, "s": [500] })),
            ]),
            ..ParsedProperty::default()
        })),
        ..ParsedProperty::default()
    };
    assert_eq!(interpolate_keyframes(&p, 5.0), json!([500.0, 0.0]));
}

#[test]
fn model_cache_returns_equal_models_for_the_same_key() {
    let json = tgs_json(json!({ "layers": [{ "ind": 0, "ty": 4, "ks": {} }] }));
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
    assert_eq!(interpolate_keyframes(color, 0.0), json!([0.0, 0.0, 1.0]));
}

#[test]
fn set_value_overrides_layer_transform_via_star_transform() {
    let mut anim = anim_with_fill();
    set_value(&mut anim, "**.Transform", Property::TrPosition, nums(&[50.0, 60.0])).unwrap();
    let position = anim.layers[0].transform.position.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(position, 0.0), json!([50.0, 60.0]));
}

#[test]
fn set_value_overrides_stroke_width() {
    let mut anim = anim_with_fill();
    set_value(&mut anim, "Layer 1.**.Stroke 1", Property::StrokeWidth, PropertyValue::Number(9.0)).unwrap();
    let stroke = nth_child(&anim, 0, 0, 1);
    let width = stroke.stroke_width.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(width, 0.0), json!(9.0));
}

#[test]
fn set_value_overrides_animated_properties_too() {
    let raw = tgs_json(json!({
        "layers": [{
            "ind": 0, "ty": 4, "nm": "L", "ks": {},
            "shapes": [{
                "ty": "tm", "nm": "Trim 1",
                "s": { "a": 1, "k": [{ "t": 0, "s": [0] }, { "t": 60, "s": [100] }] },
                "e": { "a": 0, "k": 100 },
                "o": { "a": 0, "k": 0 },
                "m": 1
            }]
        }]
    }));
    let mut anim = parse_tgs(&raw, None).unwrap();
    set_value(&mut anim, "L.Trim 1", Property::TrimStart, nums(&[40.0])).unwrap();
    let trim = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    let start = trim.start.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(start, 30.0), json!([40.0]));
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
    let anim = parse(json!({ "layers": [] }));
    assert_eq!(frame_at_pos(&anim, 0.0), 0.0);
    assert_eq!(frame_at_pos(&anim, 1.0), 180.0);
    assert_eq!(frame_at_pos(&anim, 0.5), 90.0);
    assert_eq!(frame_at_pos(&anim, -1.0), 0.0);
    assert_eq!(frame_at_pos(&anim, 5.0), 180.0);
}

#[test]
fn parses_standalone_rounded_corner_shapes() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [
                { "ty": "rd", "r": { "a": 0, "k": 5 } },
                { "ty": "rc", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [50, 50] } }
            ]
        }]
    }));
    let shapes = anim.layers[0].shapes.as_ref().unwrap();
    let corner = &shapes[0];
    assert_eq!(corner.shape_type, "roundedCorner");
    assert_eq!(corner.radius.as_ref().unwrap().value, json!(5));
}

#[test]
fn parses_merge_shapes_with_a_merge_mode() {
    let anim = parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "ks": {},
            "shapes": [
                { "ty": "mm", "mm": 2 },
                { "ty": "rc", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [50, 50] } }
            ]
        }]
    }));
    let shapes = anim.layers[0].shapes.as_ref().unwrap();
    let merge = &shapes[0];
    assert_eq!(merge.shape_type, "merge");
    assert_eq!(merge.merge_mode, Some(2.0));
}

#[test]
fn whole_still_static_composition_checks() {
    let raw = tgs_json(json!({ "layers": [{ "ind": 0, "ty": 4, "ks": {} }] }));
    let opts = ParseOptions { key: Some("probe".to_string()), cache: true };
    let anim = parse_tgs(&raw, Some(opts)).unwrap();
    assert!(!has_animated_properties(&anim));
    assert!(!anim.is3d);
}

fn anim_with_fill() -> ParsedAnimation {
    parse(json!({
        "layers": [{
            "ind": 0, "ty": 4, "nm": "Layer 1",
            "ks": {
                "o": { "a": 0, "k": 100 }, "r": { "a": 0, "k": 0 }, "p": { "a": 0, "k": [0, 0] },
                "a": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }
            },
            "shapes": [{
                "ty": "gr",
                "nm": "Group 1",
                "it": [
                    { "ty": "fl", "nm": "Fill 1", "c": { "a": 0, "k": [1, 0, 0] }, "o": { "a": 0, "k": 100 }, "r": 1 },
                    { "ty": "st", "nm": "Stroke 1", "c": { "a": 0, "k": [0, 1, 0] }, "o": { "a": 0, "k": 100 }, "w": { "a": 0, "k": 2 } },
                    { "ty": "tr", "p": { "a": 0, "k": [0, 0] }, "a": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }, "r": { "a": 0, "k": 0 }, "o": { "a": 0, "k": 100 } }
                ]
            }]
        }]
    }))
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
