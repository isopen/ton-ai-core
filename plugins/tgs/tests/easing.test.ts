import { CubicBezier, buildEasing } from '@ton-ai/tgs';
let easingValue: (easing: { x1: number; y1: number; x2: number; y2: number }, t: number) => number;
beforeEach(() => {
    jest.resetModules();
    const m = require('../src/easing.js');
    easingValue = m.easingValue;
});

describe('CubicBezier', () => {
    it('is identity when x1=y1 and x2=y2', () => {
        const cb = new CubicBezier(0, 0, 1, 1);
        expect(cb.value(0)).toBe(0);
        expect(cb.value(0.5)).toBeCloseTo(0.5, 6);
        expect(cb.value(1)).toBe(1);
    });
    it('starts at 0 and ends at 1', () => {
        const cb = new CubicBezier(0.33, 0, 0.67, 1);
        expect(cb.value(0)).toBeCloseTo(0, 6);
        expect(cb.value(1)).toBeCloseTo(1, 6);
    });
    it('is monotonic for a standard ease curve', () => {
        const cb = new CubicBezier(0.42, 0, 0.58, 1);
        let prev = cb.value(0);
        for (let i = 1; i <= 20; i++) {
            const v = cb.value(i / 20);
            expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = v;
        }
    });
    it('is identity for the linear tangent pair', () => {
        const cb = new CubicBezier(0.25, 0.25, 0.75, 0.75);
        expect(cb.value(0.25)).toBeCloseTo(0.25, 6);
        expect(cb.value(0.75)).toBeCloseTo(0.75, 6);
    });
    it('returns 0 at t=0 when the x tangents are zero', () => {
        const cb = new CubicBezier(0, 0.4, 0, 0.6);
        expect(cb.value(0)).toBe(0);
    });
    it('subdivides when the initial slope is shallow', () => {
        const cb = new CubicBezier(0, 0, 0, 1);
        const v = cb.value(0.0002);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
        expect(cb.value(0.5)).toBeGreaterThan(0.5);
        expect(cb.value(0.5)).toBeLessThan(1);
    });
});

describe('buildEasing', () => {
    it('returns undefined when both tangents are missing', () => {
        expect(buildEasing(undefined, undefined)).toBeUndefined();
    });
    it('fills missing components with zeros', () => {
        const e = buildEasing({ x: [0.3], y: [0.2] }, undefined);
        expect(e).toEqual({ x1: 0.3, y1: 0.2, x2: 0, y2: 0 });
    });
    it('reads out-x/y from o and in-x/y from i', () => {
        const e = buildEasing(
            { x: [0.25], y: [0.1] },
            { x: [0.75], y: [0.9] },
        );
        expect(e).toEqual({ x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 });
    });
    it('returns undefined for non-finite values', () => {
        expect(buildEasing({ x: [NaN], y: [0] }, undefined)).toBeUndefined();
    });
});

describe('easingValue', () => {
    it('passes through linear easing unchanged', () => {
        const e = { x1: 0, y1: 0, x2: 1, y2: 1 };
        expect(easingValue(e, 0)).toBe(0);
        expect(easingValue(e, 0.3)).toBeCloseTo(0.3, 6);
        expect(easingValue(e, 1)).toBe(1);
    });
    it('applies ease-out: slower start, faster end', () => {
        const e = { x1: 0, y1: 0, x2: 0.58, y2: 1 };
        const v = easingValue(e, 0.5);
        expect(v).toBeGreaterThan(0.5);
        expect(v).toBeLessThan(1);
    });
    it('caches interpolators for repeated eases', () => {
        const e = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
        const a = easingValue(e, 0.2);
        const b = easingValue(e, 0.2);
        expect(a).toBe(b);
    });
});
