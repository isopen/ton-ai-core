import {
    bezierLength,
    bezierPointAt,
    bezierSplit,
    bezierTAtLength,
} from '@ton-ai/tgs';
import type { CubicBezierSeg } from '@ton-ai/tgs';

const LINE: CubicBezierSeg = {
    p0: [0, 0],
    p1: [100 / 3, 0],
    p2: [200 / 3, 0],
    p3: [100, 0],
};
const CURVE: CubicBezierSeg = {
    p0: [0, 0],
    p1: [0, 100],
    p2: [100, 100],
    p3: [100, 0],
};

describe('bezierPointAt', () => {
    it('returns the endpoints at t=0 and t=1', () => {
        expect(bezierPointAt(LINE, 0)).toEqual([0, 0]);
        expect(bezierPointAt(LINE, 1)).toEqual([100, 0]);
    });
    it('returns the midpoint of a linear segment at t=0.5', () => {
        const pt = bezierPointAt(LINE, 0.5);
        expect(pt[0]).toBeCloseTo(50, 6);
        expect(pt[1]).toBeCloseTo(0, 6);
    });
    it('stays inside the convex hull for curved segments', () => {
        const pt = bezierPointAt(CURVE, 0.5);
        expect(pt[0]).toBeGreaterThan(0);
        expect(pt[0]).toBeLessThan(100);
        expect(pt[1]).toBeGreaterThan(0);
        expect(pt[1]).toBeLessThan(100);
    });
});

describe('bezierSplit', () => {
    it('preserves endpoints and joins at the split point', () => {
        const [left, right] = bezierSplit(LINE, 0.25);
        expect(left.p0).toEqual([0, 0]);
        expect(left.p3).toEqual(right.p0);
        expect(right.p3).toEqual([100, 0]);
    });
    it('split point matches bezierPointAt', () => {
        const [left] = bezierSplit(CURVE, 0.5);
        expect(left.p3[0]).toBeCloseTo(bezierPointAt(CURVE, 0.5)[0], 6);
        expect(left.p3[1]).toBeCloseTo(bezierPointAt(CURVE, 0.5)[1], 6);
    });
    it('repeating the split at the same t is idempotent for length', () => {
        const [left, right] = bezierSplit(LINE, 0.5);
        expect(bezierLength(left) + bezierLength(right)).toBeCloseTo(bezierLength(LINE), 4);
    });
});

describe('bezierLength', () => {
    it('equals the chord length for a straight segment', () => {
        expect(bezierLength(LINE)).toBeCloseTo(100, 4);
    });
    it('is longer than the chord for a curved segment', () => {
        const len = bezierLength(CURVE);
        expect(len).toBeGreaterThan(Math.hypot(100, 100));
    });
    it('handles zero-length segments', () => {
        const seg: CubicBezierSeg = { p0: [5, 5], p1: [5, 5], p2: [5, 5], p3: [5, 5] };
        expect(bezierLength(seg)).toBe(0);
    });
});

describe('bezierTAtLength', () => {
    it('returns 1 for the full length', () => {
        expect(bezierTAtLength(LINE, 100, bezierLength(LINE))).toBe(1);
    });
    it('returns 1 for lengths beyond the total', () => {
        expect(bezierTAtLength(LINE, 500, bezierLength(LINE))).toBe(1);
    });
    it('maps the half length to t=0.5 for a straight segment', () => {
        const t = bezierTAtLength(LINE, 50, bezierLength(LINE));
        expect(t).toBeCloseTo(0.5, 2);
    });
    it('is monotonic in length', () => {
        const total = bezierLength(CURVE);
        let prev = 0;
        for (let i = 1; i <= 10; i++) {
            const t = bezierTAtLength(CURVE, (total * i) / 10, total);
            expect(t).toBeGreaterThanOrEqual(prev);
            prev = t;
        }
    });
});
