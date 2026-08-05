import type { CubicBezierEasing, TgsEasing } from './types.js';

// rlottie vinterpolator.h: enum { kSplineTableSize = 11 }
const SAMPLE_TABLE_SIZE = 11;
const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.02;
const SUBDIVISION_PRECISION = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 10;

const SAMPLE_STEP_SIZE = 1 / (SAMPLE_TABLE_SIZE - 1);

function calcBezier(t: number, a1: number, a2: number): number {
    const a = 1 - 3 * a2 + 3 * a1;
    const b = 3 * a2 - 6 * a1;
    const c = 3 * a1;
    return ((a * t + b) * t + c) * t;
}

function getSlope(t: number, a1: number, a2: number): number {
    const a = 1 - 3 * a2 + 3 * a1;
    const b = 3 * a2 - 6 * a1;
    const c = 3 * a1;
    return (3 * a * t + 2 * b) * t + c;
}

/**
 * Port of rlottie's VInterpolator (src/vector/vinterpolator.cpp).
 * Cubic bezier easing in time domain: P0=(0,0), P1=(x1,y1), P2=(x2,y2), P3=(1,1).
 * `value(t)` returns the eased progress for the given linear progress t.
 */
export class CubicBezier {
    private readonly x1: number;
    private readonly y1: number;
    private readonly x2: number;
    private readonly y2: number;
    private readonly sampleValues: Float64Array | null;

    constructor(x1: number, y1: number, x2: number, y2: number) {
        this.x1 = x1;
        this.y1 = y1;
        this.x2 = x2;
        this.y2 = y2;
        this.sampleValues =
            x1 === y1 && x2 === y2 ? null : this.calcSampleValues();
    }

    value(aX: number): number {
        if (this.sampleValues === null) return aX;
        return calcBezier(this.getTForX(aX), this.y1, this.y2);
    }

    private calcSampleValues(): Float64Array {
        const samples = new Float64Array(SAMPLE_TABLE_SIZE);
        for (let i = 0; i < SAMPLE_TABLE_SIZE; i++) {
            samples[i] = calcBezier(i * SAMPLE_STEP_SIZE, this.x1, this.x2);
        }
        return samples;
    }

    private getTForX(aX: number): number {
        const samples = this.sampleValues!;
        let intervalStart = 0;
        let currentSample = 1;
        const lastSample = SAMPLE_TABLE_SIZE - 1;
        while (currentSample !== lastSample && samples[currentSample] <= aX) {
            intervalStart += SAMPLE_STEP_SIZE;
            currentSample++;
        }
        currentSample--;

        const dist =
            (aX - samples[currentSample]) /
            (samples[currentSample + 1] - samples[currentSample]);
        let guessForT = intervalStart + dist * SAMPLE_STEP_SIZE;

        const initialSlope = getSlope(guessForT, this.x1, this.x2);
        if (initialSlope >= NEWTON_MIN_SLOPE) {
            return this.newtonRaphsonIterate(aX, guessForT);
        }
        if (initialSlope === 0) {
            return guessForT;
        }
        return this.binarySubdivide(aX, intervalStart, intervalStart + SAMPLE_STEP_SIZE);
    }

    private newtonRaphsonIterate(aX: number, guessT: number): number {
        for (let i = 0; i < NEWTON_ITERATIONS; i++) {
            const currentX = calcBezier(guessT, this.x1, this.x2) - aX;
            const currentSlope = getSlope(guessT, this.x1, this.x2);
            if (currentSlope === 0) return guessT;
            guessT -= currentX / currentSlope;
        }
        return guessT;
    }

    private binarySubdivide(aX: number, a: number, b: number): number {
        let currentT: number = a;
        let currentX: number = 0;
        let i = 0;
        do {
            currentT = a + (b - a) / 2;
            currentX = calcBezier(currentT, this.x1, this.x2) - aX;
            if (currentX > 0) {
                b = currentT;
            } else {
                a = currentT;
            }
        } while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
        return currentT;
    }
}

const interpolatorCache = new Map<string, CubicBezier>();

/**
 * rlottie caches VInterpolator instances keyed by tangent values
 * (lottieparser.cpp: mInterpolatorCache). Same here.
 * Tangent components are used as-is (rlottie does not normalize 0-100
 * values; parseInperpolatorPoint leaves missing x/y at 0).
 */
export function buildEasing(o?: TgsEasing, i?: TgsEasing): CubicBezierEasing | undefined {
    if (!o && !i) return undefined;
    const x1 = Number(o?.x?.[0] ?? 0);
    const y1 = Number(o?.y?.[0] ?? 0);
    const x2 = Number(i?.x?.[0] ?? 0);
    const y2 = Number(i?.y?.[0] ?? 0);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return undefined;
    return { x1, y1, x2, y2 };
}

/**
 * Applies cubic bezier easing to linear progress `t`. `easing` is plain
 * data (structured-clone safe); the interpolator is built and cached
 * internally on first use.
 */
export function easingValue(easing: CubicBezierEasing, t: number): number {
    const { x1, y1, x2, y2 } = easing;
    const key = [x1, y1, x2, y2].map((v) => v.toFixed(4)).join('_');
    let interp = interpolatorCache.get(key);
    if (!interp) {
        interp = new CubicBezier(x1, y1, x2, y2);
        interpolatorCache.set(key, interp);
    }
    return interp.value(t);
}
