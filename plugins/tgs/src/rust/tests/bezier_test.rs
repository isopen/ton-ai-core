use tgs::{bezier_length, bezier_point_at, bezier_split, bezier_t_at_length, CubicBezierSeg};

fn seg(p0: [f64; 2], p1: [f64; 2], p2: [f64; 2], p3: [f64; 2]) -> CubicBezierSeg {
    CubicBezierSeg { p0, p1, p2, p3 }
}

fn line() -> CubicBezierSeg {
    seg([0.0, 0.0], [100.0 / 3.0, 0.0], [200.0 / 3.0, 0.0], [100.0, 0.0])
}

fn curve() -> CubicBezierSeg {
    seg([0.0, 0.0], [0.0, 100.0], [100.0, 100.0], [100.0, 0.0])
}

#[test]
fn returns_the_endpoints_at_t0_and_t1() {
    assert_eq!(bezier_point_at(&line(), 0.0), [0.0, 0.0]);
    assert_eq!(bezier_point_at(&line(), 1.0), [100.0, 0.0]);
}

#[test]
fn returns_the_midpoint_of_a_linear_segment_at_t05() {
    let pt = bezier_point_at(&line(), 0.5);
    assert!((pt[0] - 50.0).abs() <= 1e-6);
    assert!(pt[1].abs() <= 1e-6);
}

#[test]
fn stays_inside_the_convex_hull_for_curved_segments() {
    let pt = bezier_point_at(&curve(), 0.5);
    assert!(pt[0] > 0.0 && pt[0] < 100.0);
    assert!(pt[1] > 0.0 && pt[1] < 100.0);
}

#[test]
fn split_preserves_endpoints_and_joins_at_the_split_point() {
    let (left, right) = bezier_split(&line(), 0.25);
    assert_eq!(left.p0, [0.0, 0.0]);
    assert_eq!(left.p3, right.p0);
    assert_eq!(right.p3, [100.0, 0.0]);
}

#[test]
fn split_point_matches_bezier_point_at() {
    let (left, _) = bezier_split(&curve(), 0.5);
    let at = bezier_point_at(&curve(), 0.5);
    assert!((left.p3[0] - at[0]).abs() <= 1e-6);
    assert!((left.p3[1] - at[1]).abs() <= 1e-6);
}

#[test]
fn repeating_the_split_at_the_same_t_is_idempotent_for_length() {
    let (left, right) = bezier_split(&line(), 0.5);
    let total = bezier_length(&line());
    assert!((bezier_length(&left) + bezier_length(&right) - total).abs() <= 1e-4);
}

#[test]
fn equals_the_chord_length_for_a_straight_segment() {
    assert!((bezier_length(&line()) - 100.0).abs() <= 1e-4);
}

#[test]
fn is_longer_than_the_chord_for_a_curved_segment() {
    let len = bezier_length(&curve());
    assert!(len > (100.0_f64 * 100.0 + 100.0 * 100.0).sqrt());
}

#[test]
fn handles_zero_length_segments() {
    let zero = seg([5.0, 5.0], [5.0, 5.0], [5.0, 5.0], [5.0, 5.0]);
    assert_eq!(bezier_length(&zero), 0.0);
}

#[test]
fn returns_1_for_the_full_length() {
    assert_eq!(bezier_t_at_length(&line(), 100.0, bezier_length(&line())), 1.0);
}

#[test]
fn returns_1_for_lengths_beyond_the_total() {
    assert_eq!(bezier_t_at_length(&line(), 500.0, bezier_length(&line())), 1.0);
}

#[test]
fn maps_the_half_length_to_t05_for_a_straight_segment() {
    let t = bezier_t_at_length(&line(), 50.0, bezier_length(&line()));
    assert!((t - 0.5).abs() <= 1e-2);
}

#[test]
fn is_monotonic_in_length() {
    let total = bezier_length(&curve());
    let mut prev = 0.0;
    for i in 1..=10 {
        let t = bezier_t_at_length(&curve(), total * i as f64 / 10.0, total);
        assert!(t >= prev);
        prev = t;
    }
}
