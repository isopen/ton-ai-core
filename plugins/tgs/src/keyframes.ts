import type { ParsedKeyframe, ParsedProperty } from './types.js';
import { buildEasing } from './easing.js';
import { bezierLength, bezierPointAt, bezierTAtLength, type CubicBezierSeg } from './bezier.js';
import { getOverride } from './keypath.js';

/**
 * Port of rlottie's parseKeyFrame() + model::KeyFrames::Frame
 * (src/lottie/lottieparser.cpp / lottiemodel.h).
 *
 * rlottie semantics (verified against lottieparser.cpp parseKeyFrame):
 *  - `endFrame` = the start frame of the NEXT parsed keyframe
 *    (`list.back().end_ = keyframe.start_`), even when that keyframe is
 *    discarded;
 *  - noEndValue fixup: when the new keyframe has a start value and no end
 *    value, the previous frame's end value is copied from it
 *    (`if (parsed.value && parsed.noEndValue) list.back().value_.end_ = ...`);
 *  - a keyframe is pushed only when it is a hold keyframe (`h: 1`) or has an
 *    `i` tangent; all other keyframes are DISCARDED ("its the last frame
 *    discard") — real bodymovin exports mark the animation tail this way
 *    (verified: rlottie example/resource/like.json, joypixels files);
 *  - hold keyframes get `e = s` (value_.end_ = value_.start_);
 *  - path values are wrapped in a single-element array inside keyframes
 *    (`"s": [{"v":...,"i":...,"o":...,"c":...}]`, parsePathInfo handles
 *    both forms) — unwrapped here.
 */
function unwrapValue(v: any): any {
    if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'object' && !Array.isArray(v[0])) {
        return v[0];
    }
    return v;
}

export function buildKeyframes(rawK: any, defaultValue: any): ParsedKeyframe[] {
    if (!Array.isArray(rawK)) return [];
    const keyframes: ParsedKeyframe[] = [];

    for (const raw of rawK) {
        if (!raw || typeof raw !== 'object') continue;
        const t = Array.isArray(raw.t) ? raw.t[0] : raw.t;
        if (typeof t !== 'number') continue;

        const prev = keyframes[keyframes.length - 1];
        if (prev) {
            prev.endFrame = t;
            if (raw.s !== undefined && raw.e === undefined) {
                prev.e = unwrapValue(raw.s);
            }
        }

        const hold = raw.h === 1;
        if (!hold && raw.i === undefined) continue;

        const s = unwrapValue(raw.s);
        const kf: ParsedKeyframe = {
            t,
            s,
            endFrame: t,
            hold,
            easing: buildEasing(raw.o, raw.i),
        };
        if (hold) {
            kf.e = s;
        } else if (raw.e !== undefined) {
            kf.e = unwrapValue(raw.e);
        }
        if (Array.isArray(raw.to)) kf.to = raw.to;
        if (Array.isArray(raw.ti)) kf.ti = raw.ti;
        if (raw.h !== undefined) kf.h = raw.h;
        if (raw.n !== undefined) kf.n = raw.n;
        keyframes.push(kf);
    }

    return keyframes;
}

export function parseValue(v: any): ParsedProperty {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return { animated: false, value: v };
    }
    const keyframes = buildKeyframes(v.k, undefined);
    const isAnimated = keyframes.length > 0;
    const prop: ParsedProperty = {
        animated: isAnimated,
        value: isAnimated ? keyframes[0].s : v.k,
    };
    if (isAnimated) prop.keyframes = keyframes;
    if (v.x && typeof v.x === 'object') prop.x = parseValue(v.x);
    if (v.y && typeof v.y === 'object') prop.y = parseValue(v.y);
    return prop;
}

function isNumericArray(v: any): v is number[] {
    return Array.isArray(v) && v.every((x) => typeof x === 'number');
}

function lerpNumber(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * Port of model::Value<T, Position>::at() (lottiemodel.h).
 * Spatial keyframes are interpolated along a cubic bezier
 * (start, start+to, end+ti, end) with arc-length reparameterization
 * ("rove across time"): point at t*bezLen of the bezier.
 */
function lerpPosition(
    start: number[],
    end: number[],
    to: number[],
    ti: number[],
    t: number,
): number[] {
    const seg: CubicBezierSeg = {
        p0: [start[0], start[1]],
        p1: [start[0] + to[0], start[1] + to[1]],
        p2: [end[0] + ti[0], end[1] + ti[1]],
        p3: [end[0], end[1]],
    };
    const len = bezierLength(seg);
    if (len < 1e-6) return [lerpNumber(start[0], end[0], t), lerpNumber(start[1], end[1], t)];
    const tt = bezierTAtLength(seg, t * len, len);
    const pt = bezierPointAt(seg, tt);
    return [pt[0], pt[1]];
}

/**
 * Port of model::Value<T>::at() + PathData::lerp (lottiemodel.h).
 * Handles scalars, numeric arrays, colors and path data {c,i,o,v}.
 */
export function lerpValue(start: any, end: any, t: number): any {
    if (typeof start === 'number' && typeof end === 'number') {
        return lerpNumber(start, end, t);
    }
    if (isNumericArray(start) && isNumericArray(end)) {
        const len = Math.min(start.length, end.length);
        const out = new Array(len);
        for (let i = 0; i < len; i++) out[i] = lerpNumber(start[i], end[i], t);
        return out;
    }
    if (start && end && typeof start === 'object' && typeof end === 'object') {
        if (Array.isArray(start.v) && Array.isArray(end.v)) {
            const out: any = {
                c: end.c !== undefined ? end.c : start.c,
                v: lerpArray(start.v, end.v, t),
                i: lerpArray(start.i, end.i, t),
                o: lerpArray(start.o, end.o, t),
            };
            return out;
        }
    }
    return t >= 0.5 ? end : start;
}

function lerpArray(a: any[], b: any[], t: number): any[] {
    const len = Math.min(a.length, b.length);
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
        out[i] = lerpValue(a[i], b[i], t);
    }
    return out;
}

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function resolveSplitDimensions(prop: ParsedProperty, value: any, frame: number): any {
    if (!isNumericArray(value) || !prop.x) return value;
    const xv = interpolateKeyframes(prop.x, frame);
    const x0 = isNumericArray(xv) ? xv[0] : typeof xv === 'number' ? xv : undefined;
    if (x0 === undefined) return value;
    const out = [x0, ...value];
    if (prop.y) {
        const yv = interpolateKeyframes(prop.y, frame);
        const y0 = isNumericArray(yv) ? yv[0] : typeof yv === 'number' ? yv : undefined;
        if (y0 !== undefined) out[1] = y0;
    }
    return out;
}

/**
 * Port of model::KeyFrames<T>::value(frameNo) (lottiemodel.h).
 * Returns the property value at the given frame, honoring bezier easing,
 * hold keyframes and spatial (to/ti) tangents.
 *
 * Note: for frames at/after the last pushed keyframe, rlottie returns the
 * last keyframe's END value (`frames_.back().value_.end_`), which for a
 * discarded tail keyframe is the fixup'd start value of that tail.
 */
export function interpolateKeyframes(property: ParsedProperty, frame: number): any {
    const override = getOverride(property, frame);
    if (override !== undefined) return override;

    if (!property.animated || !property.keyframes || property.keyframes.length === 0) {
        return property.value;
    }

    const kfs = property.keyframes;
    const first = kfs[0];
    const last = kfs[kfs.length - 1];

    if (frame <= first.t) return first.s;
    const lastEnd = last.endFrame ?? last.t;
    if (frame >= lastEnd) return last.e !== undefined ? last.e : last.s;

    for (let i = 0; i < kfs.length; i++) {
        const kf = kfs[i];
        const next = kfs[i + 1];
        const hold = kf.hold || kf.h === 1;
        const end = kf.endFrame ?? (next ? next.t : kf.t);
        if (frame >= kf.t && frame < end) {
            if (hold) return kf.s;
            const startVal = kf.s;
            // rlottie noEndValue fixup, applied defensively for hand-built
            // keyframes (buildKeyframes already precomputes kf.e):
            // if the next keyframe has a start value and no end value, the
            // segment ends at that start value.
            const endVal = kf.e !== undefined && next?.e !== undefined
                ? kf.e
                : next?.s !== undefined ? next.s : (kf.e ?? kf.s);
            const duration = Math.max(end - kf.t, 1e-6);
            let progress = clamp01((frame - kf.t) / duration);
            // hand-built keyframes (e.g. in tests) may carry raw o/i tangents
            let easing = kf.easing;
            if (!easing && (kf.o || kf.i)) easing = buildEasing(kf.o, kf.i);
            if (easing) progress = easing.value(progress);

            let result: any;
            if (kf.to && kf.ti && isNumericArray(startVal) && isNumericArray(endVal)) {
                result = lerpPosition(startVal, endVal, kf.to, kf.ti, progress);
            } else {
                result = lerpValue(startVal, endVal, progress);
            }
            return resolveSplitDimensions(property, result, frame);
        }
    }

    return last.e !== undefined ? last.e : last.s;
}
