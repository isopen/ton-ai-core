import { parseTgs, setValue, getOverride, interpolateKeyframes, Property } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';

function tgs(body: object): string {
    return JSON.stringify({
        tgs: 1,
        v: '5.5.2',
        fr: 60,
        ip: 0,
        op: 180,
        w: 512,
        h: 512,
        nm: 'test',
        ...body,
    });
}

function animWithFill(): ParsedAnimation {
    return parseTgs(tgs({
        layers: [{
            ind: 0,
            ty: 4,
            nm: 'Layer 1',
            ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
            shapes: [{
                ty: 'gr',
                nm: 'Group 1',
                it: [
                    { ty: 'fl', nm: 'Fill 1', c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 }, r: 1 },
                    { ty: 'st', nm: 'Stroke 1', c: { a: 0, k: [0, 1, 0] }, o: { a: 0, k: 50 }, w: { a: 0, k: 2 } },
                    { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
                ],
            }],
        }],
    }));
}

describe('getOverride', () => {
    it('returns undefined for properties without overrides', () => {
        const anim = animWithFill();
        const fill = anim.layers[0].shapes![0].children![0];
        expect(getOverride(fill.color!, 0)).toBeUndefined();
    });
    it('returns the static override value', () => {
        const anim = animWithFill();
        setValue(anim, 'Layer 1.Group 1.Fill 1', Property.FillColor, [0, 0, 1]);
        const fill = anim.layers[0].shapes![0].children![0];
        expect(getOverride(fill.color!, 0)).toEqual([0, 0, 1]);
        expect(getOverride(fill.color!, 100)).toEqual([0, 0, 1]);
    });
    it('evaluates function overrides per frame', () => {
        const anim = animWithFill();
        setValue(anim, 'Layer 1.**', Property.FillColor, (info) => (info.curFrame < 30 ? [0, 0, 1] : [1, 1, 0]));
        const fill = anim.layers[0].shapes![0].children![0];
        expect(getOverride(fill.color!, 10)).toEqual([0, 0, 1]);
        expect(getOverride(fill.color!, 60)).toEqual([1, 1, 0]);
    });
    it('interpolateKeyframes honours the override', () => {
        const anim = animWithFill();
        setValue(anim, '**', Property.FillColor, [0, 0, 1]);
        const fill = anim.layers[0].shapes![0].children![0];
        expect(interpolateKeyframes(fill.color!, 42)).toEqual([0, 0, 1]);
    });
});

describe('setValue property kinds', () => {
    it('overrides fill opacity', () => {
        const anim = animWithFill();
        setValue(anim, '**.Fill 1', Property.FillOpacity, 33);
        const fill = anim.layers[0].shapes![0].children![0];
        expect(interpolateKeyframes(fill.opacity!, 0)).toBe(33);
    });
    it('overrides stroke color, opacity and width', () => {
        const anim = animWithFill();
        setValue(anim, '**.Stroke 1', Property.StrokeColor, [1, 1, 1]);
        setValue(anim, '**.Stroke 1', Property.StrokeOpacity, 25);
        setValue(anim, '**.Stroke 1', Property.StrokeWidth, 7);
        const stroke = anim.layers[0].shapes![0].children![1];
        expect(interpolateKeyframes(stroke.color!, 0)).toEqual([1, 1, 1]);
        expect(interpolateKeyframes(stroke.opacity!, 0)).toBe(25);
        expect(interpolateKeyframes(stroke.strokeWidth!, 0)).toBe(7);
    });
    it('overrides the layer transform anchor, scale, rotation and opacity', () => {
        const anim = animWithFill();
        setValue(anim, '**.Transform', Property.TrAnchor, [1, 2]);
        setValue(anim, '**.Transform', Property.TrScale, [120, 120]);
        setValue(anim, '**.Transform', Property.TrRotation, 45);
        setValue(anim, '**.Transform', Property.TrOpacity, 80);
        const tr = anim.layers[0].transform;
        expect(interpolateKeyframes(tr.anchor!, 0)).toEqual([1, 2]);
        expect(interpolateKeyframes(tr.scale!, 0)).toEqual([120, 120]);
        expect(interpolateKeyframes(tr.rotation!, 0)).toBe(45);
        expect(interpolateKeyframes(tr.opacity!, 0)).toBe(80);
    });
    it('overrides trim end', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0, ty: 4, nm: 'L', ks: {},
                shapes: [{
                    ty: 'tm', nm: 'Trim 1',
                    s: { a: 0, k: 0 }, e: { a: 0, k: 100 }, o: { a: 0, k: 0 }, m: 1,
                }],
            }],
        }));
        setValue(anim, 'L.Trim 1', Property.TrimEnd, [60]);
        const trim = anim.layers[0].shapes![0];
        expect(interpolateKeyframes(trim.end!, 0)).toEqual([60]);
    });
    it('does not apply fill overrides to strokes and vice versa', () => {
        const anim = animWithFill();
        expect(() => setValue(anim, '**.Stroke 1', Property.FillColor, [0, 0, 1])).toThrow(/no property matched/);
        expect(() => setValue(anim, '**.Fill 1', Property.StrokeColor, [0, 0, 1])).toThrow(/no property matched/);
        const fill = anim.layers[0].shapes![0].children![0];
        const stroke = anim.layers[0].shapes![0].children![1];
        expect(interpolateKeyframes(fill.color!, 0)).toEqual([1, 0, 0]);
        expect(interpolateKeyframes(stroke.color!, 0)).toEqual([0, 1, 0]);
    });
    it('addresses layers without a name by their index', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 3,
                ty: 4,
                ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
                shapes: [{
                    ty: 'gr',
                    it: [
                        { ty: 'fl', c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 }, r: 1 },
                        { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
                    ],
                }],
            }],
        }));
        setValue(anim, 'Layer 3.**', Property.FillColor, [0, 0, 1]);
        const fill = anim.layers[0].shapes![0].children![0];
        expect(interpolateKeyframes(fill.color!, 0)).toEqual([0, 0, 1]);
    });
    it('throws when the transform lacks the requested property', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                nm: 'L',
                ks: {},
                shapes: [{
                    ty: 'gr',
                    nm: 'Group 1',
                    it: [
                        { ty: 'fl', c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 }, r: 1 },
                        { ty: 'tr', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
                    ],
                }],
            }],
        }));
        const tr = anim.layers[0].shapes![0].children!.find((c) => c.type === 'transform')!;
        delete (tr as any).anchor;
        expect(() => setValue(anim, 'L.Group 1.Transform', Property.TrAnchor, [1, 2])).toThrow(/no property matched/);
        delete (tr as any).position;
        expect(() => setValue(anim, 'L.Group 1.Transform', Property.TrPosition, [1, 2])).toThrow(/no property matched/);
        delete (tr as any).scale;
        expect(() => setValue(anim, 'L.Group 1.Transform', Property.TrScale, [1, 2])).toThrow(/no property matched/);
        delete (tr as any).rotation;
        expect(() => setValue(anim, 'L.Group 1.Transform', Property.TrRotation, 45)).toThrow(/no property matched/);
        delete (tr as any).opacity;
        expect(() => setValue(anim, 'L.Group 1.Transform', Property.TrOpacity, 80)).toThrow(/no property matched/);
    });
    it('throws for property kinds that do not apply to the shape', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                nm: 'L',
                ks: {},
                shapes: [{
                    ty: 'gr',
                    it: [
                        { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] }, r: { a: 0, k: 0 } },
                        { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
                    ],
                }],
            }],
        }));
        expect(() => setValue(anim, '**', Property.FillColor, [0, 0, 1])).toThrow(/no property matched/);
    });
});
