use tgs::{easing_value, BezierEasingDef, CubicBezier, CubicBezierEasing};

fn def(x: Option<Vec<f64>>, y: Option<Vec<f64>>) -> BezierEasingDef {
    BezierEasingDef { x, y }
}

fn is_close(a: f64, b: f64, digits: u32) -> bool {
    let eps = 0.5_f64 * 10_f64.powi(-(digits as i32));
    (a - b).abs() < eps
}

#[test]
fn is_identity_when_x1_y1_and_x2_y2() {
    let cb = CubicBezier::new(0.0, 0.0, 1.0, 1.0);
    assert_eq!(cb.value(0.0), 0.0);
    assert!(is_close(cb.value(0.5), 0.5, 6));
    assert_eq!(cb.value(1.0), 1.0);
}

#[test]
fn starts_at_0_and_ends_at_1() {
    let cb = CubicBezier::new(0.33, 0.0, 0.67, 1.0);
    assert!(is_close(cb.value(0.0), 0.0, 6));
    assert!(is_close(cb.value(1.0), 1.0, 6));
}

#[test]
fn is_monotonic_for_a_standard_ease_curve() {
    let cb = CubicBezier::new(0.42, 0.0, 0.58, 1.0);
    let mut prev = cb.value(0.0);
    for i in 1..=20 {
        let v = cb.value(i as f64 / 20.0);
        assert!(v >= prev - 1e-9);
        prev = v;
    }
}

#[test]
fn is_identity_for_the_linear_tangent_pair() {
    let cb = CubicBezier::new(0.25, 0.25, 0.75, 0.75);
    assert!(is_close(cb.value(0.25), 0.25, 6));
    assert!(is_close(cb.value(0.75), 0.75, 6));
}

#[test]
fn returns_0_at_t0_when_the_x_tangents_are_zero() {
    let cb = CubicBezier::new(0.0, 0.4, 0.0, 0.6);
    assert_eq!(cb.value(0.0), 0.0);
}

#[test]
fn subdivides_when_the_initial_slope_is_shallow() {
    let cb = CubicBezier::new(0.0, 0.0, 0.0, 1.0);
    let v = cb.value(0.0002);
    assert!(v > 0.0 && v < 1.0);
    assert!(cb.value(0.5) > 0.5 && cb.value(0.5) < 1.0);
}

#[test]
fn build_easing_returns_none_when_both_tangents_are_missing() {
    assert!(tgs::build_easing(None, None).is_none());
}

#[test]
fn build_easing_fills_missing_components_with_zeros() {
    let o = def(Some(vec![0.3]), Some(vec![0.2]));
    let e = tgs::build_easing(Some(&o), None).unwrap();
    assert_eq!(
        e,
        CubicBezierEasing { x1: 0.3, y1: 0.2, x2: 0.0, y2: 0.0 }
    );
}

#[test]
fn build_easing_reads_out_x_y_from_o_and_in_x_y_from_i() {
    let o = def(Some(vec![0.25]), Some(vec![0.1]));
    let i = def(Some(vec![0.75]), Some(vec![0.9]));
    let e = tgs::build_easing(Some(&o), Some(&i)).unwrap();
    assert_eq!(
        e,
        CubicBezierEasing { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 }
    );
}

#[test]
fn build_easing_returns_none_for_non_finite_values() {
    let o = def(Some(vec![f64::NAN]), Some(vec![0.0]));
    assert!(tgs::build_easing(Some(&o), None).is_none());
}

#[test]
fn easing_value_passes_through_linear_easing_unchanged() {
    let e = CubicBezierEasing { x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 };
    assert_eq!(easing_value(e, 0.0), 0.0);
    assert!(is_close(easing_value(e, 0.3), 0.3, 6));
    assert_eq!(easing_value(e, 1.0), 1.0);
}

#[test]
fn easing_value_applies_ease_out_slower_start_faster_end() {
    let e = CubicBezierEasing { x1: 0.0, y1: 0.0, x2: 0.58, y2: 1.0 };
    let v = easing_value(e, 0.5);
    assert!(v > 0.5 && v < 1.0);
}

#[test]
fn easing_value_caches_interpolators_for_repeated_eases() {
    let e = CubicBezierEasing { x1: 0.42, y1: 0.0, x2: 0.58, y2: 1.0 };
    let a = easing_value(e, 0.2);
    let b = easing_value(e, 0.2);
    assert_eq!(a, b);
}
