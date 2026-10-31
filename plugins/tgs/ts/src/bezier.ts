export type BezierPoint = [number, number];

export interface CubicBezierSeg {
    p0: BezierPoint;
    p1: BezierPoint;
    p2: BezierPoint;
    p3: BezierPoint;
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
    let x = x2 - x1;
    let y = y2 - y1;
    x = x < 0 ? -x : x;
    y = y < 0 ? -y : y;
    return x > y ? x + 0.375 * y : y + 0.375 * x;
}

export function bezierLength(seg: CubicBezierSeg): number {
    const { p0, p1, p2, p3 } = seg;
    const len =
        dist(p0[0], p0[1], p1[0], p1[1]) +
        dist(p1[0], p1[1], p2[0], p2[1]) +
        dist(p2[0], p2[1], p3[0], p3[1]);
    const chord = dist(p0[0], p0[1], p3[0], p3[1]);
    if (len - chord > 0.01) {
        const [left, right] = bezierSplit(seg, 0.5);
        return bezierLength(left) + bezierLength(right);
    }
    return len;
}

export function bezierPointAt(seg: CubicBezierSeg, t: number): BezierPoint {
    const { p0, p1, p2, p3 } = seg;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    const a = mt2 * mt;
    const b = 3 * mt2 * t;
    const c = 3 * mt * t2;
    const d = t2 * t;
    return [
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ];
}

export function bezierSplit(seg: CubicBezierSeg, t: number): [CubicBezierSeg, CubicBezierSeg] {
    const { p0, p1, p2, p3 } = seg;
    const ab: BezierPoint = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
    const bc: BezierPoint = [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
    const cd: BezierPoint = [p2[0] + (p3[0] - p2[0]) * t, p2[1] + (p3[1] - p2[1]) * t];
    const abc: BezierPoint = [ab[0] + (bc[0] - ab[0]) * t, ab[1] + (bc[1] - ab[1]) * t];
    const bcd: BezierPoint = [bc[0] + (cd[0] - bc[0]) * t, bc[1] + (cd[1] - bc[1]) * t];
    const abcd: BezierPoint = [abc[0] + (bcd[0] - abc[0]) * t, abc[1] + (bcd[1] - abc[1]) * t];
    return [
        { p0, p1: ab, p2: abc, p3: abcd },
        { p0: abcd, p1: bcd, p2: cd, p3 },
    ];
}

const T_AT_LENGTH_ERROR = 0.01;
const T_AT_LENGTH_MAX_ITERATIONS = 1000;

export function bezierTAtLength(seg: CubicBezierSeg, l: number, totalLength: number): number {
    let t = 1;
    if (l > totalLength || Math.abs(l - totalLength) < 1e-6) return t;
    t *= 0.5;
    let lastBigger = 1;
    for (let num = 0; num < T_AT_LENGTH_MAX_ITERATIONS; num++) {
        const [left] = bezierSplit(seg, t);
        const lLen = bezierLength(left);
        if (Math.abs(lLen - l) < T_AT_LENGTH_ERROR) return t;
        if (lLen < l) {
            t += (lastBigger - t) * 0.5;
        } else {
            lastBigger = t;
            t -= t * 0.5;
        }
    }
    return t;
}
