use serde_json::{json, Value as JsonValue};
use tgs::{interpolate_keyframes, lerp_value, parse_value};

fn parse_static(v: JsonValue) -> tgs::ParsedProperty {
    parse_value(Option::Some(&v))
}

#[test]
fn lerp_interpolates_numbers() {
    assert_eq!(lerp_value(&json!(0), &json!(100), 0.5), json!(50.0));
    assert_eq!(lerp_value(&json!(10), &json!(20), 0.25), json!(12.5));
}

#[test]
fn lerp_interpolates_numeric_arrays_element_wise() {
    assert_eq!(
        lerp_value(&json!([0, 100]), &json!([10, 200]), 0.5),
        json!([5.0, 150.0])
    );
}

#[test]
fn lerp_truncates_to_the_shorter_array() {
    assert_eq!(
        lerp_value(&json!([0, 100, 300]), &json!([10, 200]), 0.5),
        json!([5.0, 150.0])
    );
}

#[test]
fn lerp_interpolates_path_vertex_objects() {
    let start = json!({
        "c": true,
        "v": [[0, 0], [10, 0]],
        "i": [[0, 0], [0, 0]],
        "o": [[0, 0], [0, 0]]
    });
    let end = json!({
        "c": true,
        "v": [[100, 0], [110, 0]],
        "i": [[0, 0], [0, 0]],
        "o": [[0, 0], [0, 0]]
    });
    let mid = lerp_value(&start, &end, 0.5);
    assert_eq!(mid["c"], json!(true));
    assert_eq!(mid["v"], json!([[50.0, 0.0], [60.0, 0.0]]));
}

#[test]
fn lerp_picks_the_end_value_for_mismatched_types() {
    assert_eq!(lerp_value(&json!("a"), &json!("b"), 0.7), json!("b"));
    assert_eq!(lerp_value(&json!("a"), &json!("b"), 0.3), json!("a"));
}

#[test]
fn lerp_interpolates_handles_and_vertices_of_vertex_objects() {
    let start = json!({
        "c": true,
        "v": [[0, 0], [10, 0]],
        "i": [[0, 0], [0, 0]],
        "o": [[-5, 0], [-5, 0]]
    });
    let end = json!({
        "c": true,
        "v": [[100, 0], [110, 0]],
        "i": [[20, 0], [20, 0]],
        "o": [[5, 0], [5, 0]]
    });
    let mid = lerp_value(&start, &end, 0.5);
    assert_eq!(mid["c"], json!(true));
    assert_eq!(mid["v"], json!([[50.0, 0.0], [60.0, 0.0]]));
    assert_eq!(mid["i"], json!([[10.0, 0.0], [10.0, 0.0]]));
    assert_eq!(mid["o"], json!([[0.0, 0.0], [0.0, 0.0]]));
}

#[test]
fn parse_returns_a_static_property_for_scalars_and_undefined() {
    let p = parse_static(json!(42));
    assert!(!p.animated);
    assert_eq!(p.value, json!(42));

    let arr = parse_static(json!([1, 2, 3]));
    assert!(!arr.animated);
    assert_eq!(arr.value, json!([1, 2, 3]));

    let none = parse_value(None);
    assert!(!none.animated);
    assert!(none.value.is_null());
    assert!(none.keyframes.is_none());
}

#[test]
fn parse_returns_a_static_property_for_non_animated_objects() {
    let p = parse_static(json!({ "a": 0, "k": [10, 20] }));
    assert!(!p.animated);
    assert_eq!(p.value, json!([10, 20]));
}

#[test]
fn parse_marks_keyframe_arrays_as_animated_with_the_first_value() {
    let p = parse_static(json!({
        "a": 1,
        "k": [{ "t": 0, "s": [5] }, { "t": 10, "s": [50] }]
    }));
    assert!(p.animated);
    assert_eq!(p.value, json!([5]));
    let kfs = p.keyframes.as_ref().unwrap();
    assert_eq!(kfs.len(), 2);
}

#[test]
fn parse_parses_split_dimensions_into_x_y_properties() {
    let p = parse_static(json!({
        "s": true,
        "x": { "a": 1, "k": [{ "t": 0, "s": [1] }, { "t": 10, "s": [2] }] },
        "y": { "a": 0, "k": 3 }
    }));
    assert!(!p.animated);
    assert!(p.value.is_null());
    assert!(p.x.is_some());
    assert!(p.y.is_some());
}

#[test]
fn parse_handles_empty_keyframe_arrays_as_static() {
    let p = parse_static(json!({ "a": 1, "k": [] }));
    assert!(!p.animated);
    assert_eq!(p.value, json!([]));
}

#[test]
fn parse_preserves_hold_flags_from_raw_keyframes() {
    let p = parse_static(json!({
        "a": 1,
        "k": [{ "t": 0, "s": [1], "h": 1 }, { "t": 10, "s": [2] }]
    }));
    assert!(p.keyframes.as_ref().unwrap()[0].hold);
}

#[test]
fn interpolate_beyond_the_last_keyframe_uses_its_end_value() {
    let p = parse_static(json!({
        "a": 1,
        "k": [{ "t": 0, "s": [1] }, { "t": 10, "s": [2] }]
    }));
    assert_eq!(interpolate_keyframes(&p, 50.0), json!([2]));
    assert_eq!(interpolate_keyframes(&p, 0.0), json!([1]));
}

#[test]
fn interpolate_beyond_the_last_hold_keyframe_uses_its_hold_value() {
    let p = parse_static(json!({
        "a": 1,
        "k": [{ "t": 0, "s": [1] }, { "t": 10, "s": [2], "h": 1 }]
    }));
    assert_eq!(interpolate_keyframes(&p, 50.0), json!([2]));
}

#[test]
fn interpolate_spatial_positions_through_their_tangents() {
    let p = parse_static(json!({
        "a": 1,
        "k": [
            { "t": 0, "s": [0, 0], "to": [50, 0], "ti": [-50, 0] },
            { "t": 10, "s": [100, 0] }
        ]
    }));
    let v = interpolate_keyframes(&p, 5.0);
    let x = v.as_array().and_then(|a| a[0].as_f64()).unwrap();
    assert!(x > 0.0 && x < 100.0);
}
