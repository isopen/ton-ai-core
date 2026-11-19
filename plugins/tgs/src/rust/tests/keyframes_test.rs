#![recursion_limit = "1024"]
use tgs::json::{jarr, jn, jobj, js, Value as JsonValue};
use tgs::{interpolate_keyframes, lerp_value, parse_value};

fn parse_static(v: JsonValue) -> tgs::ParsedProperty {
    parse_value(Option::Some(&v))
}

#[test]
fn lerp_interpolates_numbers() {
    assert_eq!(lerp_value(&jn(0.0), &jn(100.0), 0.5), jn(50.0));
    assert_eq!(lerp_value(&jn(10.0), &jn(20.0), 0.25), jn(12.5));
}

#[test]
fn lerp_interpolates_numeric_arrays_element_wise() {
    assert_eq!(
        lerp_value(&jarr(vec![jn(0.0), jn(100.0)]), &jarr(vec![jn(10.0), jn(200.0)]), 0.5),
        jarr(vec![jn(5.0), jn(150.0)])
    );
}

#[test]
fn lerp_truncates_to_the_shorter_array() {
    assert_eq!(
        lerp_value(&jarr(vec![jn(0.0), jn(100.0), jn(300.0)]), &jarr(vec![jn(10.0), jn(200.0)]), 0.5),
        jarr(vec![jn(5.0), jn(150.0)])
    );
}

#[test]
fn lerp_interpolates_path_vertex_objects() {
    let start = jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(10.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])]))]);
    let end = jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(100.0), jn(0.0)]), jarr(vec![jn(110.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])]))]);
    let mid = lerp_value(&start, &end, 0.5);
    assert_eq!(mid.get("c").unwrap(), &JsonValue::Bool(true));
    assert_eq!(mid.get("v").unwrap(), &jarr(vec![jarr(vec![jn(50.0), jn(0.0)]), jarr(vec![jn(60.0), jn(0.0)])]));
}

#[test]
fn lerp_picks_the_end_value_for_mismatched_types() {
    assert_eq!(lerp_value(&js("a"), &js("b"), 0.7), js("b"));
    assert_eq!(lerp_value(&js("a"), &js("b"), 0.3), js("a"));
}

#[test]
fn lerp_interpolates_handles_and_vertices_of_vertex_objects() {
    let start = jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(10.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(-5.0), jn(0.0)]), jarr(vec![jn(-5.0), jn(0.0)])]))]);
    let end = jobj(vec![("c", JsonValue::Bool(true)), ("v", jarr(vec![jarr(vec![jn(100.0), jn(0.0)]), jarr(vec![jn(110.0), jn(0.0)])])), ("i", jarr(vec![jarr(vec![jn(20.0), jn(0.0)]), jarr(vec![jn(20.0), jn(0.0)])])), ("o", jarr(vec![jarr(vec![jn(5.0), jn(0.0)]), jarr(vec![jn(5.0), jn(0.0)])]))]);
    let mid = lerp_value(&start, &end, 0.5);
    assert_eq!(mid.get("c").unwrap(), &JsonValue::Bool(true));
    assert_eq!(mid.get("v").unwrap(), &jarr(vec![jarr(vec![jn(50.0), jn(0.0)]), jarr(vec![jn(60.0), jn(0.0)])]));
    assert_eq!(mid.get("i").unwrap(), &jarr(vec![jarr(vec![jn(10.0), jn(0.0)]), jarr(vec![jn(10.0), jn(0.0)])]));
    assert_eq!(mid.get("o").unwrap(), &jarr(vec![jarr(vec![jn(0.0), jn(0.0)]), jarr(vec![jn(0.0), jn(0.0)])]));
}

#[test]
fn parse_returns_a_static_property_for_scalars_and_undefined() {
    let p = parse_static(jn(42.0));
    assert!(!p.animated);
    assert_eq!(p.value, jn(42.0));

    let arr = parse_static(jarr(vec![jn(1.0), jn(2.0), jn(3.0)]));
    assert!(!arr.animated);
    assert_eq!(arr.value, jarr(vec![jn(1.0), jn(2.0), jn(3.0)]));

    let none = parse_value(None);
    assert!(!none.animated);
    assert!(none.value.is_null());
    assert!(none.keyframes.is_none());
}

#[test]
fn parse_returns_a_static_property_for_non_animated_objects() {
    let p = parse_static(jobj(vec![("a", jn(0.0)), ("k", jarr(vec![jn(10.0), jn(20.0)]))]));
    assert!(!p.animated);
    assert_eq!(p.value, jarr(vec![jn(10.0), jn(20.0)]));
}

#[test]
fn parse_marks_keyframe_arrays_as_animated_with_the_first_value() {
    let p = parse_static(jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(5.0)]))]), jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(50.0)]))])]))]));
    assert!(p.animated);
    assert_eq!(p.value, jarr(vec![jn(5.0)]));
    let kfs = p.keyframes.as_ref().unwrap();
    assert_eq!(kfs.len(), 2);
}

#[test]
fn parse_parses_split_dimensions_into_x_y_properties() {
    let p = parse_static(jobj(vec![("s", JsonValue::Bool(true)), ("x", jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(1.0)]))]), jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(2.0)]))])]))])), ("y", jobj(vec![("a", jn(0.0)), ("k", jn(3.0))]))]));
    assert!(!p.animated);
    assert!(p.value.is_null());
    assert!(p.x.is_some());
    assert!(p.y.is_some());
}

#[test]
fn parse_handles_empty_keyframe_arrays_as_static() {
    let p = parse_static(jobj(vec![("a", jn(1.0)), ("k", jarr(vec![]))]));
    assert!(!p.animated);
    assert_eq!(p.value, jarr(vec![]));
}

#[test]
fn parse_preserves_hold_flags_from_raw_keyframes() {
    let p = parse_static(jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(1.0)])), ("h", jn(1.0))]), jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(2.0)]))])]))]));
    assert!(p.keyframes.as_ref().unwrap()[0].hold);
}

#[test]
fn interpolate_beyond_the_last_keyframe_uses_its_end_value() {
    let p = parse_static(jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(1.0)]))]), jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(2.0)]))])]))]));
    assert_eq!(interpolate_keyframes(&p, 50.0), jarr(vec![jn(2.0)]));
    assert_eq!(interpolate_keyframes(&p, 0.0), jarr(vec![jn(1.0)]));
}

#[test]
fn interpolate_beyond_the_last_hold_keyframe_uses_its_hold_value() {
    let p = parse_static(jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(1.0)]))]), jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(2.0)])), ("h", jn(1.0))])]))]));
    assert_eq!(interpolate_keyframes(&p, 50.0), jarr(vec![jn(2.0)]));
}

#[test]
fn interpolate_spatial_positions_through_their_tangents() {
    let p = parse_static(jobj(vec![("a", jn(1.0)), ("k", jarr(vec![jobj(vec![("t", jn(0.0)), ("s", jarr(vec![jn(0.0), jn(0.0)])), ("to", jarr(vec![jn(50.0), jn(0.0)])), ("ti", jarr(vec![jn(-50.0), jn(0.0)]))]), jobj(vec![("t", jn(10.0)), ("s", jarr(vec![jn(100.0), jn(0.0)]))])]))]));
    let v = interpolate_keyframes(&p, 5.0);
    let x = v.arr_at(0).unwrap();
    assert!(x > 0.0 && x < 100.0);
}
