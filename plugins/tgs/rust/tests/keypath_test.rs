use serde_json::{json, Value as JsonValue};
use tgs::{
    get_override, interpolate_keyframes, parse_tgs, set_value, ParsedAnimation, ParsedShape, Property,
    PropertyValue,
};

fn tgs_json(layers: JsonValue) -> String {
    json!({
        "tgs": 1,
        "v": "5.5.2",
        "fr": 60,
        "ip": 0,
        "op": 180,
        "w": 512,
        "h": 512,
        "nm": "test",
        "layers": layers,
    })
    .to_string()
}

fn parse(s: &str) -> ParsedAnimation {
    parse_tgs(s, None).unwrap()
}

fn nums(v: &[f64]) -> PropertyValue {
    PropertyValue::Numbers(v.to_vec())
}

fn num(v: f64) -> PropertyValue {
    PropertyValue::Number(v)
}

fn fill_layer_layers() -> JsonValue {
    json!([{
        "ind": 0,
        "ty": 4,
        "nm": "Layer 1",
        "ks": {
            "o": { "a": 0, "k": 100 },
            "r": { "a": 0, "k": 0 },
            "p": { "a": 0, "k": [0, 0] },
            "a": { "a": 0, "k": [0, 0] },
            "s": { "a": 0, "k": [100, 100] }
        },
        "shapes": [{
            "ty": "gr",
            "nm": "Group 1",
            "it": [
                { "ty": "fl", "nm": "Fill 1", "c": { "a": 0, "k": [1, 0, 0] }, "o": { "a": 0, "k": 100 }, "r": 1 },
                { "ty": "st", "nm": "Stroke 1", "c": { "a": 0, "k": [0, 1, 0] }, "o": { "a": 0, "k": 50 }, "w": { "a": 0, "k": 2 } },
                { "ty": "tr", "p": { "a": 0, "k": [0, 0] }, "a": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }, "r": { "a": 0, "k": 0 }, "o": { "a": 0, "k": 100 } },
            ],
        }],
    }])
}

fn anim_with_fill() -> ParsedAnimation {
    let raw = tgs_json(fill_layer_layers());
    parse(&raw)
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

fn transform_child_mut(anim: &mut ParsedAnimation) -> &mut ParsedShape {
    let shape = anim.layers[0].shapes.as_mut().unwrap().get_mut(0).unwrap();
    shape
        .children
        .as_mut()
        .unwrap()
        .iter_mut()
        .find(|c| c.shape_type == "transform")
        .unwrap()
}

fn no_match(err: tgs::TgsError) -> bool {
    err.0.contains("no property matched")
}

#[test]
fn get_override_returns_none_for_properties_without_overrides() {
    let anim = anim_with_fill();
    let fill = nth_child(&anim, 0, 0, 0);
    let color = fill.color.as_ref().unwrap();
    assert!(get_override(color, 0.0).is_none());
}

#[test]
fn get_override_returns_the_static_override_value() {
    let mut anim = anim_with_fill();
    set_value(&mut anim, "Layer 1.Group 1.Fill 1", Property::FillColor, nums(&[0.0, 0.0, 1.0])).unwrap();
    let fill = nth_child(&anim, 0, 0, 0);
    let color = fill.color.as_ref().unwrap();
    assert_eq!(get_override(color, 0.0).unwrap(), json!([0.0, 0.0, 1.0]));
    assert_eq!(get_override(color, 100.0).unwrap(), json!([0.0, 0.0, 1.0]));
}

#[test]
fn interpolate_keyframes_honours_the_override() {
    let mut anim = anim_with_fill();
    set_value(&mut anim, "**", Property::FillColor, nums(&[0.0, 0.0, 1.0])).unwrap();
    let fill = nth_child(&anim, 0, 0, 0);
    let color = fill.color.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(color, 42.0), json!([0.0, 0.0, 1.0]));
}

#[test]
fn overrides_fill_opacity() {
    let mut anim = anim_with_fill();
    set_value(&mut anim, "**.Fill 1", Property::FillOpacity, num(33.0)).unwrap();
    let fill = nth_child(&anim, 0, 0, 0);
    let opacity = fill.opacity.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(opacity, 0.0), json!(33.0));
}

#[test]
fn overrides_stroke_color_opacity_and_width() {
    let mut anim = anim_with_fill();
    set_value(&mut anim, "**.Stroke 1", Property::StrokeColor, nums(&[1.0, 1.0, 1.0])).unwrap();
    set_value(&mut anim, "**.Stroke 1", Property::StrokeOpacity, num(25.0)).unwrap();
    set_value(&mut anim, "**.Stroke 1", Property::StrokeWidth, num(7.0)).unwrap();
    let stroke = nth_child(&anim, 0, 0, 1);
    let color = stroke.color.as_ref().unwrap();
    let opacity = stroke.opacity.as_ref().unwrap();
    let width = stroke.stroke_width.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(color, 0.0), json!([1.0, 1.0, 1.0]));
    assert_eq!(interpolate_keyframes(opacity, 0.0), json!(25.0));
    assert_eq!(interpolate_keyframes(width, 0.0), json!(7.0));
}

#[test]
fn overrides_the_layer_transform_anchor_scale_rotation_and_opacity() {
    let mut anim = anim_with_fill();
    set_value(&mut anim, "**.Transform", Property::TrAnchor, nums(&[1.0, 2.0])).unwrap();
    set_value(&mut anim, "**.Transform", Property::TrScale, nums(&[120.0, 120.0])).unwrap();
    set_value(&mut anim, "**.Transform", Property::TrRotation, num(45.0)).unwrap();
    set_value(&mut anim, "**.Transform", Property::TrOpacity, num(80.0)).unwrap();
    let tr = &anim.layers[0].transform;
    let anchor = tr.anchor.as_ref().unwrap();
    let scale = tr.scale.as_ref().unwrap();
    let rotation = tr.rotation.as_ref().unwrap();
    let opacity = tr.opacity.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(anchor, 0.0), json!([1.0, 2.0]));
    assert_eq!(interpolate_keyframes(scale, 0.0), json!([120.0, 120.0]));
    assert_eq!(interpolate_keyframes(rotation, 0.0), json!(45.0));
    assert_eq!(interpolate_keyframes(opacity, 0.0), json!(80.0));
}

#[test]
fn overrides_trim_end() {
    let raw = tgs_json(json!([{
        "ind": 0,
        "ty": 4,
        "nm": "L",
        "ks": {},
        "shapes": [{
            "ty": "tm",
            "nm": "Trim 1",
            "s": { "a": 0, "k": 0 },
            "e": { "a": 0, "k": 100 },
            "o": { "a": 0, "k": 0 },
            "m": 1,
        }],
    }]));
    let mut anim = parse(&raw);
    set_value(&mut anim, "L.Trim 1", Property::TrimEnd, nums(&[60.0])).unwrap();
    let trim = anim.layers[0].shapes.as_ref().unwrap().get(0).unwrap();
    let end = trim.end.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(end, 0.0), json!([60.0]));
}

#[test]
fn does_not_apply_fill_overrides_to_strokes_and_vice_versa() {
    let mut anim = anim_with_fill();
    let fill_match = set_value(&mut anim, "**.Stroke 1", Property::FillColor, nums(&[0.0, 0.0, 1.0]));
    assert!(fill_match.is_err());
    assert!(no_match(fill_match.unwrap_err()));
    let stroke_match = set_value(&mut anim, "**.Fill 1", Property::StrokeColor, nums(&[0.0, 0.0, 1.0]));
    assert!(stroke_match.is_err());
    assert!(no_match(stroke_match.unwrap_err()));
    let fill = nth_child(&anim, 0, 0, 0);
    let stroke = nth_child(&anim, 0, 0, 1);
    let fill_color = fill.color.as_ref().unwrap();
    let stroke_color = stroke.color.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(fill_color, 0.0), json!([1, 0, 0]));
    assert_eq!(interpolate_keyframes(stroke_color, 0.0), json!([0, 1, 0]));
}

#[test]
fn addresses_layers_without_a_name_by_their_index() {
    let raw = tgs_json(json!([{
        "ind": 3,
        "ty": 4,
        "ks": {
            "o": { "a": 0, "k": 100 },
            "r": { "a": 0, "k": 0 },
            "p": { "a": 0, "k": [0, 0] },
            "a": { "a": 0, "k": [0, 0] },
            "s": { "a": 0, "k": [100, 100] }
        },
        "shapes": [{
            "ty": "gr",
            "it": [
                { "ty": "fl", "c": { "a": 0, "k": [1, 0, 0] }, "o": { "a": 0, "k": 100 }, "r": 1 },
                { "ty": "tr", "p": { "a": 0, "k": [0, 0] }, "a": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }, "r": { "a": 0, "k": 0 }, "o": { "a": 0, "k": 100 } },
            ],
        }],
    }]));
    let mut anim = parse(&raw);
    set_value(&mut anim, "Layer 3.**", Property::FillColor, nums(&[0.0, 0.0, 1.0])).unwrap();
    let fill = nth_child(&anim, 0, 0, 0);
    let color = fill.color.as_ref().unwrap();
    assert_eq!(interpolate_keyframes(color, 0.0), json!([0.0, 0.0, 1.0]));
}

#[test]
fn throws_when_the_transform_lacks_the_requested_property() {
    let raw = tgs_json(json!([{
        "ind": 0,
        "ty": 4,
        "nm": "L",
        "ks": {},
        "shapes": [{
            "ty": "gr",
            "nm": "Group 1",
            "it": [
                { "ty": "fl", "c": { "a": 0, "k": [1, 0, 0] }, "o": { "a": 0, "k": 100 }, "r": 1 },
                { "ty": "tr", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }, "r": { "a": 0, "k": 0 }, "o": { "a": 0, "k": 100 } },
            ],
        }],
    }]));
    {
        let mut anim = parse(&raw);
        transform_child_mut(&mut anim).anchor = None;
        let res = set_value(&mut anim, "L.Group 1.Transform", Property::TrAnchor, nums(&[1.0, 2.0]));
        assert!(res.is_err() && no_match(res.unwrap_err()));
    }
    {
        let mut anim = parse(&raw);
        transform_child_mut(&mut anim).position = None;
        let res = set_value(&mut anim, "L.Group 1.Transform", Property::TrPosition, nums(&[1.0, 2.0]));
        assert!(res.is_err() && no_match(res.unwrap_err()));
    }
    {
        let mut anim = parse(&raw);
        transform_child_mut(&mut anim).scale = None;
        let res = set_value(&mut anim, "L.Group 1.Transform", Property::TrScale, nums(&[1.0, 2.0]));
        assert!(res.is_err() && no_match(res.unwrap_err()));
    }
    {
        let mut anim = parse(&raw);
        transform_child_mut(&mut anim).rotation = None;
        let res = set_value(&mut anim, "L.Group 1.Transform", Property::TrRotation, num(45.0));
        assert!(res.is_err() && no_match(res.unwrap_err()));
    }
    {
        let mut anim = parse(&raw);
        transform_child_mut(&mut anim).opacity = None;
        let res = set_value(&mut anim, "L.Group 1.Transform", Property::TrOpacity, num(80.0));
        assert!(res.is_err() && no_match(res.unwrap_err()));
    }
}

#[test]
fn throws_for_property_kinds_that_do_not_apply_to_the_shape() {
    let raw = tgs_json(json!([{
        "ind": 0,
        "ty": 4,
        "nm": "L",
        "ks": {},
        "shapes": [{
            "ty": "gr",
            "it": [
                { "ty": "rc", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [10, 10] }, "r": { "a": 0, "k": 0 } },
                { "ty": "tr", "p": { "a": 0, "k": [0, 0] }, "a": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }, "r": { "a": 0, "k": 0 }, "o": { "a": 0, "k": 100 } },
            ],
        }],
    }]));
    let mut anim = parse(&raw);
    let res = set_value(&mut anim, "**", Property::FillColor, nums(&[0.0, 0.0, 1.0]));
    assert!(res.is_err() && no_match(res.unwrap_err()));
}
