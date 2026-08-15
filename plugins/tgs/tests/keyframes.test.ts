import { lerpValue, parseValue, interpolateKeyframes } from '@ton-ai/tgs';
import type { ParsedProperty } from '@ton-ai/tgs';

describe('lerpValue', () => {
    it('interpolates numbers', () => {
        expect(lerpValue(0, 100, 0.5)).toBe(50);
        expect(lerpValue(10, 20, 0.25)).toBe(12.5);
    });
    it('interpolates numeric arrays element-wise', () => {
        expect(lerpValue([0, 100], [10, 200], 0.5)).toEqual([5, 150]);
    });
    it('truncates to the shorter array', () => {
        expect(lerpValue([0, 100, 300], [10, 200], 0.5)).toEqual([5, 150]);
    });
    it('interpolates path vertex objects', () => {
        const start = { c: true, v: [[0, 0], [10, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] };
        const end = { c: true, v: [[100, 0], [110, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] };
        const mid = lerpValue(start, end, 0.5);
        expect(mid.c).toBe(true);
        expect(mid.v).toEqual([[50, 0], [60, 0]]);
    });
    it('picks the end value for mismatched types at t>=0.5', () => {
        expect(lerpValue('a', 'b', 0.7)).toBe('b');
        expect(lerpValue('a', 'b', 0.3)).toBe('a');
    });
    it('interpolates handles and vertices of vertex objects', () => {
        const start = { c: true, v: [[0, 0], [10, 0]], i: [[0, 0], [0, 0]], o: [[-5, 0], [-5, 0]] };
        const end = { c: true, v: [[100, 0], [110, 0]], i: [[20, 0], [20, 0]], o: [[5, 0], [5, 0]] };
        const mid = lerpValue(start, end, 0.5);
        expect(mid.c).toBe(true);
        expect(mid.v).toEqual([[50, 0], [60, 0]]);
        expect(mid.i).toEqual([[10, 0], [10, 0]]);
        expect(mid.o).toEqual([[0, 0], [0, 0]]);
    });
});

describe('parseValue', () => {
    it('returns a static property for scalars and arrays', () => {
        expect(parseValue(42)).toEqual({ animated: false, value: 42 });
        expect(parseValue([1, 2, 3])).toEqual({ animated: false, value: [1, 2, 3] });
        expect(parseValue(undefined)).toEqual({ animated: false, value: undefined });
    });
    it('returns a static property for non-animated objects', () => {
        const p = parseValue({ a: 0, k: [10, 20] });
        expect(p.animated).toBe(false);
        expect(p.value).toEqual([10, 20]);
    });
    it('marks keyframe arrays as animated with the first value', () => {
        const p = parseValue({ a: 1, k: [{ t: 0, s: [5] }, { t: 10, s: [50] }] });
        expect(p.animated).toBe(true);
        expect(p.value).toEqual([5]);
        expect(p.keyframes).toHaveLength(2);
    });
    it('parses split dimensions into x/y properties', () => {
        const p = parseValue({
            s: true,
            x: { a: 1, k: [{ t: 0, s: [1] }, { t: 10, s: [2] }] },
            y: { a: 0, k: 3 },
        });
        expect(p.animated).toBe(false);
        expect(p.value).toBeUndefined();
        expect(p.x).toBeDefined();
        expect(p.y).toBeDefined();
    });
    it('handles empty keyframe arrays as static', () => {
        const p = parseValue({ a: 1, k: [] });
        expect(p.animated).toBe(false);
        expect(p.value).toEqual([]);
    });
    it('preserves hold flags from raw keyframes', () => {
        const p = parseValue({ a: 1, k: [{ t: 0, s: [1], h: 1 }, { t: 10, s: [2] }] });
        expect((p as ParsedProperty).keyframes![0].hold).toBe(true);
    });
    it('interpolates beyond the last keyframe using its end value', () => {
        const p = parseValue({ a: 1, k: [{ t: 0, s: [1] }, { t: 10, s: [2] }] });
        expect(interpolateKeyframes(p, 50)).toEqual([2]);
        expect(interpolateKeyframes(p, 0)).toEqual([1]);
    });
    it('interpolates beyond the last hold keyframe using its hold value', () => {
        const p = parseValue({ a: 1, k: [{ t: 0, s: [1] }, { t: 10, s: [2], h: 1 }] });
        expect(interpolateKeyframes(p, 50)).toEqual([2]);
    });
    it('interpolates spatial positions through their tangents', () => {
        const p = parseValue({
            a: 1,
            k: [
                { t: 0, s: [0, 0], to: [50, 0], ti: [-50, 0] },
                { t: 10, s: [100, 0] },
            ],
        });
        const v = interpolateKeyframes(p, 5);
        expect(v[0]).toBeGreaterThan(0);
        expect(v[0]).toBeLessThan(100);
    });
});
