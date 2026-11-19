#![recursion_limit = "1024"]
use tgs::json::{jarr, jn, jobj, js, Value as JsonValue};
use tgs::{
    has_animated_properties, is_frame_invariant, parse_tgs, ParsedAnimation, ParsedAsset, ParsedKeyframe, ParsedLayer,
    ParsedProperty, ParsedPropertyData, ParsedTransform,
};

fn tgs_json(body: JsonValue) -> String {
    let mut obj = jobj(vec![("tgs", jn(1.0)), ("v", js("5.5.2")), ("fr", jn(60.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("w", jn(512.0)), ("h", jn(512.0)), ("nm", js("test"))]);
    let map = obj.as_object_mut().unwrap();
    for (k, v) in body.as_object().unwrap() {
        map.insert(k, v.clone());
    }
    tgs::json::to_string(&obj)
}

fn static_ks() -> JsonValue {
    jobj(vec![("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(256.0), jn(256.0), jn(0.0)]))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0), jn(100.0)]))]))])
}

fn animated_ks(prop_name: &str, val: JsonValue, end: JsonValue, frame: f64) -> JsonValue {
    let mut ks = static_ks();
    let kf1 = jobj(vec![("t", jn(0.0)), ("i", jobj(vec![("x", jarr(vec![jn(0.2)])), ("y", jarr(vec![jn(0.2)]))])), ("o", jobj(vec![("x", jarr(vec![jn(0.8)])), ("y", jarr(vec![jn(0.8)]))]))]);
    let kf2 = jobj(vec![("t", jn(frame))]);
    let mut prop = jobj(vec![("a", jn(1.0)), ("k", jarr(vec![kf1, kf2]))]);
    {
        let map = prop.as_object_mut().unwrap();
        let kfs = map.get_mut("k").unwrap().as_array_mut().unwrap();
        if let JsonValue::Object(m) = &mut kfs[0] {
            m.insert("s".to_string(), val);
            m.insert("e".to_string(), end.clone());
        }
        if let JsonValue::Object(m) = &mut kfs[1] {
            m.insert("s".to_string(), end);
        }
    }
    ks.as_object_mut().unwrap().insert(prop_name.to_string(), prop);
    ks
}

fn parse_layers(layers: JsonValue) -> ParsedAnimation {
    parse_tgs(&tgs_json(jobj(vec![("layers", layers)])), None).unwrap()
}

#[test]
fn is_false_for_a_fully_static_composition() {
    let anim = parse_layers(jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks()), ("shapes", jarr(vec![jobj(vec![("ty", js("gr")), ("it", jarr(vec![jobj(vec![("ty", js("rc")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))]))]), jobj(vec![("ty", js("fl")), ("c", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(1.0), jn(0.0), jn(0.0), jn(1.0)]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))]))])]))])]))])]));
    assert!(!has_animated_properties(&anim));
}

#[test]
fn is_false_for_an_empty_composition() {
    let anim = parse_layers(jarr(vec![]));
    assert!(!has_animated_properties(&anim));
}

#[test]
fn is_true_when_a_transform_property_has_keyframes() {
    let anim = parse_layers(jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", animated_ks("p", jarr(vec![jn(256.0), jn(256.0), jn(0.0)]), jarr(vec![jn(100.0), jn(100.0), jn(0.0)]), 180.0))])]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_when_a_shape_property_is_animated() {
    let anim = parse_layers(jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks()), ("shapes", jarr(vec![jobj(vec![("ty", js("gr")), ("it", jarr(vec![jobj(vec![("ty", js("rc")), ("p", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0)]))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))]))]), jobj(vec![("ty", js("fl")), ("c", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(1.0), jn(0.0), jn(0.0), jn(1.0)])), ("e", jarr(vec![jn(0.0), jn(1.0), jn(0.0), jn(1.0)])), ("i", jobj(vec![("x", jarr(vec![jn(0.2)])), ("y", jarr(vec![jn(0.2)]))])), ("o", jobj(vec![("x", jarr(vec![jn(0.8)])), ("y", jarr(vec![jn(0.8)]))]))]), jobj(vec![("t", jn(180.0)), ("s", jarr(vec![jn(0.0), jn(1.0), jn(0.0), jn(1.0)]))])]))])), ("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))]))])]))])]))])]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_for_an_animated_time_remap() {
    let anim = parse_layers(jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks()), ("tm", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jn(0.0))]), jobj(vec![("t", jn(180.0)), ("s", jn(60.0))])]))]))])]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_for_text_keyframes() {
    let anim = parse_layers(jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(5.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks()), ("t", jobj(vec![("d", jobj(vec![("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jobj(vec![("t", js("Hello"))]))]), jobj(vec![("t", jn(90.0)), ("s", jobj(vec![("t", js("World"))]))])]))]))]))])]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_for_animation_inside_a_precomposed_asset_layer() {
    let anim = parse_tgs(
        &tgs_json(jobj(vec![("assets", jarr(vec![jobj(vec![("id", js("comp1")), ("w", jn(512.0)), ("h", jn(512.0)), ("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", animated_ks("o", jn(100.0), jn(0.0), 180.0))])]))])])), ("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(0.0)), ("refId", js("comp1")), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks())])]))])),
        None,
    )
    .unwrap();
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_for_a_static_property_with_an_animated_split_dimension() {
    let anim = parse_layers(jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", jobj(vec![("o", jobj(vec![("a", jn(0.0)), ("k", jn(100.0))])), ("r", jobj(vec![("a", jn(0.0)), ("k", jn(0.0))])), ("p", jobj(vec![("a", jn(0.0)), ("y", jobj(vec![("a", jn(0.0)), ("k", jn(256.0))])), ("x", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jn(0.0))]), jobj(vec![("t", jn(180.0)), ("s", jn(512.0))])]))]))])), ("a", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(0.0), jn(0.0), jn(0.0)]))])), ("s", jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(100.0), jn(100.0), jn(100.0)]))]))]))])]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_true_for_time_sliced_uniform_layers_with_static_properties() {
    let anim = parse_layers(jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(90.0)), ("ks", static_ks())]), jobj(vec![("ind", jn(1.0)), ("ty", jn(4.0)), ("ip", jn(90.0)), ("op", jn(180.0)), ("ks", static_ks())])]));
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_false_for_multiple_full_coverage_static_layers() {
    let anim = parse_layers(jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks())]), jobj(vec![("ind", jn(1.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks())])]));
    assert!(!has_animated_properties(&anim));
}

#[test]
fn is_true_when_precomposed_asset_layers_have_unequal_time_spans() {
    let anim = parse_tgs(
        &tgs_json(jobj(vec![("assets", jarr(vec![jobj(vec![("id", js("comp1")), ("w", jn(512.0)), ("h", jn(512.0)), ("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(90.0)), ("ks", static_ks())]), jobj(vec![("ind", jn(1.0)), ("ty", jn(4.0)), ("ip", jn(90.0)), ("op", jn(180.0)), ("ks", static_ks())])]))])])), ("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(0.0)), ("refId", js("comp1")), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks())])]))])),
        None,
    )
    .unwrap();
    assert!(has_animated_properties(&anim));
}

#[test]
fn is_false_for_asset_layers_with_identical_time_spans() {
    let anim = parse_tgs(
        &tgs_json(jobj(vec![("assets", jarr(vec![jobj(vec![("id", js("comp1")), ("w", jn(512.0)), ("h", jn(512.0)), ("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks())]), jobj(vec![("ind", jn(1.0)), ("ty", jn(4.0)), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks())])]))])])), ("layers", jarr(vec![jobj(vec![("ind", jn(0.0)), ("ty", jn(0.0)), ("refId", js("comp1")), ("ip", jn(0.0)), ("op", jn(180.0)), ("ks", static_ks())])]))])),
        None,
    )
    .unwrap();
    assert!(!has_animated_properties(&anim));
}

#[test]
fn is_true_for_animation_inside_asset_layers_via_a_hand_built_animation() {
    let animated_opacity = ParsedProperty::new(ParsedPropertyData {
        animated: true,
        keyframes: Some(vec![ParsedKeyframe {
            t: 0.0,
            s: jn(100.0),
            e: None,
            end_frame: Some(1.0),
            hold: false,
            o: None,
            i: None,
            easing: None,
            easing_curve: None,
            to: None,
            ti: None,
            h: None,
            n: None,
        }]),
        ..Default::default()
    });
    let anim = ParsedAnimation {
        layers: Vec::new(),
        assets: vec![ParsedAsset {
            id: Some("a1".into()),
            width: None,
            height: None,
            u: None,
            p: None,
            layers: Some(std::sync::Arc::new(vec![ParsedLayer {
                transform: ParsedTransform {
                    opacity: Some(animated_opacity),
                    ..ParsedTransform::default()
                },
                ..ParsedLayer::default()
            }])),
        }],
        ..ParsedAnimation::default()
    };
    assert!(has_animated_properties(&anim));
}

fn asset_anim(children: JsonValue, precomp: JsonValue) -> ParsedAnimation {
    parse_tgs(
        &tgs_json(jobj(vec![
            (
                "assets",
                jarr(vec![jobj(vec![
                    ("id", js("comp1")),
                    ("w", jn(512.0)),
                    ("h", jn(512.0)),
                    ("layers", children),
                ])]),
            ),
            ("layers", jarr(vec![precomp])),
        ])),
        None,
    )
    .unwrap()
}

fn precomp_layer(extra: Vec<(&str, JsonValue)>) -> JsonValue {
    let mut v = jobj(vec![
        ("ind", jn(0.0)),
        ("ty", jn(0.0)),
        ("refId", js("comp1")),
        ("ip", jn(0.0)),
        ("op", jn(180.0)),
        ("ks", static_ks()),
    ]);
    let map = v.as_object_mut().unwrap();
    for (k, val) in extra {
        map.insert(k.to_string(), val);
    }
    v
}

fn shape_layer(ip: f64, op: f64, ks: JsonValue) -> JsonValue {
    jobj(vec![("ind", jn(0.0)), ("ty", jn(4.0)), ("ip", jn(ip)), ("op", jn(op)), ("ks", ks)])
}

#[test]
fn is_frame_invariant_for_static_asset_composition() {
    let anim = asset_anim(
        jarr(vec![shape_layer(0.0, 180.0, static_ks())]),
        precomp_layer(Vec::new()),
    );
    assert!(is_frame_invariant(&anim));
}

#[test]
fn is_not_frame_invariant_when_asset_child_visibility_toggles() {
    let anim = asset_anim(
        jarr(vec![shape_layer(90.0, 180.0, static_ks())]),
        precomp_layer(Vec::new()),
    );
    assert!(!is_frame_invariant(&anim));
}

#[test]
fn is_not_frame_invariant_when_asset_child_is_animated() {
    let anim = asset_anim(
        jarr(vec![shape_layer(
            0.0,
            180.0,
            animated_ks("o", jn(100.0), jn(0.0), 180.0),
        )]),
        precomp_layer(Vec::new()),
    );
    assert!(!is_frame_invariant(&anim));
}

#[test]
fn is_frame_invariant_across_a_stretched_precomp() {
    let anim = asset_anim(
        jarr(vec![shape_layer(0.0, 45.0, static_ks())]),
        precomp_layer(vec![("sr", jn(4.0))]),
    );
    assert!(is_frame_invariant(&anim));
}

#[test]
fn is_not_frame_invariant_when_stretched_precomp_child_ends_early() {
    let anim = asset_anim(
        jarr(vec![shape_layer(0.0, 44.0, static_ks())]),
        precomp_layer(vec![("sr", jn(4.0))]),
    );
    assert!(!is_frame_invariant(&anim));
}
