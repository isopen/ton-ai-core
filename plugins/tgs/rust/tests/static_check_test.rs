use serde_json::{json, Value as JsonValue};
use tgs::{
    has_animated_properties, parse_tgs, ParsedAnimation, ParsedAsset, ParsedKeyframe, ParsedLayer, ParsedProperty,
    ParsedTransform,
};

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

fn static_ks() -> JsonValue {
    json!({
        "o": { "a": 0, "k": 100 },
        "r": { "a": 0, "k": 0 },
        "p": { "a": 0, "k": [256, 256, 0] },
        "a": { "a": 0, "k": [0, 0, 0] },
        "s": { "a": 0, "k": [100, 100, 100] }
    })
}

fn animated_ks(prop_name: &str, val: JsonValue, end: JsonValue, frame: f64) -> JsonValue {
    let mut ks = static_ks();
    ks[prop_name] = json!({
        "a": 1,
        "k": [
            { "t": 0, "s": val, "e": end, "i": { "x": [0.2], "y": [0.2] }, "o": { "x": [0.8], "y": [0.8] } },
            { "t": frame, "s": end }
        ]
    });
    ks
}

fn parse_layers(layers: JsonValue) -> ParsedAnimation {
    parse_tgs(&tgs_json(json!({ "layers": layers })), None).unwrap()
}

#[test]
fn is_false_for_a_fully_static_composition() {
    let anim = parse_layers(json!([{
        "ind": 0,
        "ty": 4,
        "ip": 0,
        "op": 180,
        "ks": static_ks(),
        "shapes": [{
            "ty": "gr",
            "it": [
                { "ty": "rc", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }, "r": { "a": 0, "k": 0 } },
                { "ty": "fl", "c": { "a": 0, "k": [1, 0, 0, 1] }, "o": { "a": 0, "k": 100 } },
            ],
        }],
    }]));
    assert!(!has_animated_properties(&anim));
}

#[test]
fn is_false_for_an_empty_composition() {
    let anim = parse_layers(json!([]));
    assert!(!has_animated_properties(&anim));
}

#[test]
fn is_true_when_a_transform_property_has_keyframes() {
    let anim = parse_layers(json!([{
        "ind": 0,
        "ty": 4,
        "ip": 0,
        "op": 180,
        "ks": animated_ks("p", json!([256, 256, 0]), json!([100, 100, 0]), 180.0),
    }]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_when_a_shape_property_is_animated() {
    let anim = parse_layers(json!([{
        "ind": 0,
        "ty": 4,
        "ip": 0,
        "op": 180,
        "ks": static_ks(),
        "shapes": [{
            "ty": "gr",
            "it": [
                { "ty": "rc", "p": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }, "r": { "a": 0, "k": 0 } },
                {
                    "ty": "fl",
                    "c": {
                        "a": 1,
                        "k": [
                            { "t": 0, "s": [1, 0, 0, 1], "e": [0, 1, 0, 1], "i": { "x": [0.2], "y": [0.2] }, "o": { "x": [0.8], "y": [0.8] } },
                            { "t": 180, "s": [0, 1, 0, 1] }
                        ]
                    },
                    "o": { "a": 0, "k": 100 }
                },
            ],
        }],
    }]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_for_an_animated_time_remap() {
    let anim = parse_layers(json!([{
        "ind": 0,
        "ty": 4,
        "ip": 0,
        "op": 180,
        "ks": static_ks(),
        "tm": { "a": 1, "k": [{ "t": 0, "s": 0 }, { "t": 180, "s": 60 }] }
    }]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_for_text_keyframes() {
    let anim = parse_layers(json!([{
        "ind": 0,
        "ty": 5,
        "ip": 0,
        "op": 180,
        "ks": static_ks(),
        "t": { "d": { "k": [{ "t": 0, "s": { "t": "Hello" } }, { "t": 90, "s": { "t": "World" } }] } }
    }]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_for_animation_inside_a_precomposed_asset_layer() {
    let anim = parse_tgs(
        &tgs_json(json!({
            "assets": [{
                "id": "comp1",
                "w": 512,
                "h": 512,
                "layers": [{ "ind": 0, "ty": 4, "ip": 0, "op": 180, "ks": animated_ks("o", json!(100), json!(0), 180.0) }]
            }],
            "layers": [
                { "ind": 0, "ty": 0, "refId": "comp1", "ip": 0, "op": 180, "ks": static_ks() }
            ]
        })),
        None,
    )
    .unwrap();
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_for_a_static_property_with_an_animated_split_dimension() {
    let anim = parse_layers(json!([{
        "ind": 0,
        "ty": 4,
        "ip": 0,
        "op": 180,
        "ks": {
            "o": { "a": 0, "k": 100 },
            "r": { "a": 0, "k": 0 },
            "p": { "a": 0, "y": { "a": 0, "k": 256 }, "x": { "a": 1, "k": [{ "t": 0, "s": 0 }, { "t": 180, "s": 512 }] } },
            "a": { "a": 0, "k": [0, 0, 0] },
            "s": { "a": 0, "k": [100, 100, 100] }
        }
    }]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_for_time_sliced_uniform_layers_with_static_properties() {
    let anim = parse_layers(json!([
        { "ind": 0, "ty": 4, "ip": 0, "op": 90, "ks": static_ks() },
        { "ind": 1, "ty": 4, "ip": 90, "op": 180, "ks": static_ks() }
    ]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_false_for_multiple_full_coverage_static_layers() {
    let anim = parse_layers(json!([
        { "ind": 0, "ty": 4, "ip": 0, "op": 180, "ks": static_ks() },
        { "ind": 1, "ty": 4, "ip": 0, "op": 180, "ks": static_ks() }
    ]));
    assert!(!has_animated_properties(&anim));
}

#[test]
fn is_true_when_precomposed_asset_layers_have_unequal_time_spans() {
    let anim = parse_tgs(&tgs_json(json!({
        "assets": [{
            "id": "comp1",
            "w": 512,
            "h": 512,
            "layers": [
                { "ind": 0, "ty": 4, "ip": 0, "op": 90, "ks": static_ks() },
                { "ind": 1, "ty": 4, "ip": 90, "op": 180, "ks": static_ks() }
            ]
        }],
        "layers": [{ "ind": 0, "ty": 0, "refId": "comp1", "ip": 0, "op": 180, "ks": static_ks() }]
    })), None).unwrap();
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_false_for_asset_layers_with_identical_time_spans() {
    let anim = parse_tgs(&tgs_json(json!({
        "assets": [{
            "id": "comp1",
            "w": 512,
            "h": 512,
            "layers": [
                { "ind": 0, "ty": 4, "ip": 0, "op": 180, "ks": static_ks() },
                { "ind": 1, "ty": 4, "ip": 0, "op": 180, "ks": static_ks() }
            ]
        }],
        "layers": [{ "ind": 0, "ty": 0, "refId": "comp1", "ip": 0, "op": 180, "ks": static_ks() }]
    })), None).unwrap();
    assert!(!has_animated_properties(&anim));
}

#[test]
fn is_true_for_animation_inside_asset_layers_via_a_hand_built_animation() {
    let animated_opacity = ParsedProperty {
        animated: true,
        keyframes: Some(vec![ParsedKeyframe {
            t: 0.0,
            s: json!(100.0),
            e: None,
            end_frame: Some(1.0),
            hold: false,
            o: None,
            i: None,
            easing: None,
            to: None,
            ti: None,
            h: None,
            n: None,
        }]),
        ..ParsedProperty::default()
    };
    let anim = ParsedAnimation {
        layers: Vec::new(),
        assets: vec![ParsedAsset {
            id: Some("a1".to_string()),
            width: None,
            height: None,
            u: None,
            p: None,
            layers: Some(vec![ParsedLayer {
                transform: ParsedTransform {
                    opacity: Some(animated_opacity),
                    ..ParsedTransform::default()
                },
                ..ParsedLayer::default()
            }]),
        }],
        ..ParsedAnimation::default()
    };
    assert!(has_animated_properties(&anim));
}
