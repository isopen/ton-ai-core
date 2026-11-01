pub type BezierPoint = [f64; 2];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CubicBezierSeg {
    pub p0: BezierPoint,
    pub p1: BezierPoint,
    pub p2: BezierPoint,
    pub p3: BezierPoint,
}

fn dist(x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    let mut x = x2 - x1;
    let mut y = y2 - y1;
    x = if x < 0.0 { -x } else { x };
    y = if y < 0.0 { -y } else { y };
    if x > y {
        x + 0.375 * y
    } else {
        y + 0.375 * x
    }
}

pub fn bezier_length(seg: &CubicBezierSeg) -> f64 {
    let len = dist(seg.p0[0], seg.p0[1], seg.p1[0], seg.p1[1])
        + dist(seg.p1[0], seg.p1[1], seg.p2[0], seg.p2[1])
        + dist(seg.p2[0], seg.p2[1], seg.p3[0], seg.p3[1]);
    let chord = dist(seg.p0[0], seg.p0[1], seg.p3[0], seg.p3[1]);
    if len - chord > 0.01 {
        let (left, _right) = bezier_split(seg, 0.5);
        return bezier_length(&left) + bezier_length(&_right);
    }
    len
}

pub fn bezier_point_at(seg: &CubicBezierSeg, t: f64) -> BezierPoint {
    let mt = 1.0 - t;
    let mt2 = mt * mt;
    let t2 = t * t;
    let a = mt2 * mt;
    let b = 3.0 * mt2 * t;
    let c = 3.0 * mt * t2;
    let d = t2 * t;
    [
        a * seg.p0[0] + b * seg.p1[0] + c * seg.p2[0] + d * seg.p3[0],
        a * seg.p0[1] + b * seg.p1[1] + c * seg.p2[1] + d * seg.p3[1],
    ]
}

pub fn bezier_split(seg: &CubicBezierSeg, t: f64) -> (CubicBezierSeg, CubicBezierSeg) {
    let ab = [
        seg.p0[0] + (seg.p1[0] - seg.p0[0]) * t,
        seg.p0[1] + (seg.p1[1] - seg.p0[1]) * t,
    ];
    let bc = [
        seg.p1[0] + (seg.p2[0] - seg.p1[0]) * t,
        seg.p1[1] + (seg.p2[1] - seg.p1[1]) * t,
    ];
    let cd = [
        seg.p2[0] + (seg.p3[0] - seg.p2[0]) * t,
        seg.p2[1] + (seg.p3[1] - seg.p2[1]) * t,
    ];
    let abc = [
        ab[0] + (bc[0] - ab[0]) * t,
        ab[1] + (bc[1] - ab[1]) * t,
    ];
    let bcd = [
        bc[0] + (cd[0] - bc[0]) * t,
        bc[1] + (cd[1] - bc[1]) * t,
    ];
    let abcd = [
        abc[0] + (bcd[0] - abc[0]) * t,
        abc[1] + (bcd[1] - abc[1]) * t,
    ];
    (
        CubicBezierSeg { p0: seg.p0, p1: ab, p2: abc, p3: abcd },
        CubicBezierSeg { p0: abcd, p1: bcd, p2: cd, p3: seg.p3 },
    )
}

const T_AT_LENGTH_ERROR: f64 = 0.01;
const T_AT_LENGTH_MAX_ITERATIONS: usize = 1000;

pub fn bezier_t_at_length(seg: &CubicBezierSeg, l: f64, total_length: f64) -> f64 {
    let mut t = 1.0f64;
    if l > total_length || (l - total_length).abs() < 1e-6 {
        return t;
    }
    t *= 0.5;
    let mut last_bigger = 1.0f64;
    for _num in 0..T_AT_LENGTH_MAX_ITERATIONS {
        let (left, _) = bezier_split(seg, t);
        let l_len = bezier_length(&left);
        if (l_len - l).abs() < T_AT_LENGTH_ERROR {
            return t;
        }
        if l_len < l {
            t += (last_bigger - t) * 0.5;
        } else {
            last_bigger = t;
            t -= t * 0.5;
        }
    }
    t
}
