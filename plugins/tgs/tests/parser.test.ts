import {
    parseTgs,
    interpolateKeyframes,
    configureModelCacheSize,
    layerInfo,
    setValue,
    matchKeyPath,
    Property,
    frameAtPos,
    LayerType,
    MatteType,
    MaskMode,
    GradientType,
} from '@ton-ai/tgs';
import type { ParsedProperty, ParsedShape } from '@ton-ai/tgs';
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
describe('parseTgs', () => {
    it('parses the composition header', () => {
        const anim = parseTgs(tgs({ layers: [] }));
        expect(anim.width).toBe(512);
        expect(anim.height).toBe(512);
        expect(anim.fps).toBe(60);
        expect(anim.inFrame).toBe(0);
        expect(anim.outFrame).toBe(180);
        expect(anim.duration).toBeCloseTo(3);
        expect(anim.name).toBe('test');
        expect(anim.version).toBe('5.5.2');
        expect(anim.tgs).toBe(true);
    });
    it('throws on invalid JSON', () => {
        expect(() => parseTgs('not json')).toThrow('Invalid TGS JSON');
    });
    it('throws when no layers', () => {
        expect(() => parseTgs('{"w":512,"h":512}')).toThrow('TGS has no layers');
    });
    it('parses layer types and timing', () => {
        const anim = parseTgs(tgs({
            layers: [
                { ind: 0, ty: 4, ip: 0, op: 60, st: 0, nm: 'ShapeLayer', ks: {} },
                { ind: 1, ty: 3, ip: 0, op: 60, ks: {}, nm: 'NullLayer' },
            ],
        }));
        expect(anim.layers).toHaveLength(2);
        expect(anim.layers[0].type).toBe(LayerType.Shape);
        expect(anim.layers[0].inFrame).toBe(0);
        expect(anim.layers[0].outFrame).toBe(60);
        expect(anim.layers[0].name).toBe('ShapeLayer');
        expect(anim.layers[1].type).toBe(LayerType.Null);
    });
    it('parses solid and precomp layers with assets', () => {
        const anim = parseTgs(tgs({
            assets: [{ id: 'pre1', w: 100, h: 100, layers: [{ ind: 0, ty: 4, ks: {} }] }],
            layers: [
                { ind: 0, ty: 1, sc: '#FF0000', sw: 512, sh: 512, ks: {} },
                { ind: 1, ty: 0, refId: 'pre1', ks: {} },
            ],
        }));
        expect(anim.layers[0].type).toBe(LayerType.Solid);
        expect(anim.layers[0].solidColor).toBe('#FF0000');
        expect(anim.layers[0].solidWidth).toBe(512);
        expect(anim.layers[1].type).toBe(LayerType.Precomp);
        expect(anim.layers[1].refId).toBe('pre1');
        expect(anim.assets[0].layers).toHaveLength(1);
    });
    it('parses transform properties as ParsedProperty', () => {
        const anim = parseTgs(tgs({
            layers: [{ ind: 0, ty: 4, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [10, 20] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } } }],
        }));
        const tr = anim.layers[0].transform;
        expect(tr.opacity.value).toBe(100);
        expect(tr.position.value).toEqual([10, 20]);
        expect(tr.scale.value).toEqual([100, 100]);
        expect(tr.opacity.animated).toBe(false);
    });
    it('parses shape groups, rects, ellipses, fills and strokes', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'gr',
                    nm: 'Group 1',
                    it: [
                        { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 50] }, r: { a: 0, k: 5 }, nm: 'Rect 1' },
                        { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] }, nm: 'Ellipse 1' },
                        { ty: 'fl', c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 }, r: 1, nm: 'Fill 1' },
                        { ty: 'st', c: { a: 0, k: [0, 1, 0] }, o: { a: 0, k: 50 }, w: { a: 0, k: 4 }, lc: 2, lj: 2, nm: 'Stroke 1' },
                        { ty: 'tr', p: { a: 0, k: [10, 10] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
                    ],
                }],
            }],
        }));
        const group = anim.layers[0].shapes![0];
        expect(group.type).toBe('group');
        expect(group.children).toHaveLength(5);
        const [rect, ellipse, fill, stroke, transform] = group.children!;
        expect(rect.type).toBe('rect');
        expect(rect.size!.value).toEqual([100, 50]);
        expect(rect.radius!.value).toBe(5);
        expect(ellipse.type).toBe('ellipse');
        expect(fill.type).toBe('fill');
        expect(fill.color!.value).toEqual([1, 0, 0]);
        expect(fill.fillRule).toBe('winding');
        expect(stroke.type).toBe('stroke');
        expect(stroke.strokeWidth!.value).toBe(4);
        expect(stroke.lineCap).toBe(2);
        expect(transform.type).toBe('transform');
        expect(transform.position!.value).toEqual([10, 10]);
    });
    it('parses path vertices from ks', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'sh',
                    nm: 'Path 1',
                    ks: { a: 0, k: { c: true, v: [[0, 0], [10, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] } },
                }],
            }],
        }));
        const path = anim.layers[0].shapes![0];
        expect(path.type).toBe('path');
        expect(path.vertices!.value).toMatchObject({ c: true });
        expect(path.vertices!.value.v).toHaveLength(2);
    });
    it('parses trim paths with animated start/end/offset', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'tm',
                    nm: 'Trim 1',
                    s: { a: 1, k: [{ t: 0, s: [0], i: { x: [0], y: [0] }, o: { x: [1], y: [1] } }, { t: 60, s: [100] }] },
                    e: { a: 0, k: 100 },
                    o: { a: 0, k: 0 },
                    m: 1,
                }],
            }],
        }));
        const trim = anim.layers[0].shapes![0];
        expect(trim.type).toBe('trim');
        expect(trim.start!.animated).toBe(true);
        expect(trim.start!.keyframes).toHaveLength(1);
        expect(trim.end!.value).toBe(100);
        expect(trim.trimMode).toBe('simultaneously');
        expect(interpolateKeyframes(trim.start!, 30)).toEqual([50]);
        expect(interpolateKeyframes(trim.start!, 60)).toEqual([100]);
        expect(interpolateKeyframes(trim.start!, 180)).toEqual([100]);
    });
    it('parses gradient fill with stops and radial type', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'gf',
                    nm: 'Grad 1',
                    t: 2,
                    s: { a: 0, k: [0, 0] },
                    e: { a: 0, k: [100, 100] },
                    o: { a: 0, k: 100 },
                    g: { p: 2, k: [0, 1, 0, 0, 1, 0, 0, 1] },
                }],
            }],
        }));
        const grad = anim.layers[0].shapes![0].gradient!;
        expect(grad.type).toBe(GradientType.Radial);
        expect(grad.startPoint.value).toEqual([0, 0]);
        expect(grad.endPoint.value).toEqual([100, 100]);
        expect(grad.stops.value).toEqual([0, 1, 0, 0, 1, 0, 0, 1]);
    });
    it('parses gradient stroke type (gs -> gradientStroke)', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'gs',
                    w: { a: 0, k: 3 },
                    s: { a: 0, k: [0, 0] },
                    e: { a: 0, k: [10, 10] },
                    g: { p: 2, k: [0, 0, 0, 0, 1, 0, 0, 1] },
                }],
            }],
        }));
        const shape = anim.layers[0].shapes![0];
        expect(shape.type).toBe('gradientStroke');
        expect(shape.strokeWidth!.value).toBe(3);
        expect(shape.gradient).toBeDefined();
    });
    it('parses stroke dashes', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'st',
                    c: { a: 0, k: [0, 0, 0] },
                    o: { a: 0, k: 100 },
                    w: { a: 0, k: 2 },
                    d: [
                        { n: 'd', nm: 'dash', v: { a: 0, k: 10 } },
                        { n: 'g', nm: 'gap', v: { a: 0, k: 5 } },
                    ],
                }],
            }],
        }));
        const dashes = anim.layers[0].shapes![0].dashes!;
        expect(dashes).toHaveLength(2);
        expect(dashes[0].name).toBe('d');
        expect(dashes[0].value.value).toBe(10);
        expect(dashes[1].value.value).toBe(5);
    });
    it('parses star with point count, radii and roundness', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'sr',
                    sy: 1,
                    pt: { a: 0, k: 5 },
                    p: { a: 0, k: [50, 50] },
                    r: { a: 0, k: 0 },
                    or: { a: 0, k: 40 },
                    ir: { a: 0, k: 20 },
                    os: 0.2,
                    is: 0.1,
                }],
            }],
        }));
        const star = anim.layers[0].shapes![0];
        expect(star.type).toBe('star');
        expect(star.points!.value).toBe(5);
        expect(star.outerRadius!.value).toBe(40);
        expect(star.innerRadius!.value).toBe(20);
        expect(star.outerRoundness!.value).toBe(0.2);
        expect(star.innerRoundness!.value).toBe(0.1);
        expect(star.starType).toBe(1);
    });
    it('parses repeater with copies and transform', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'rp',
                    c: { a: 0, k: 3 },
                    o: { a: 0, k: 0 },
                    m: 1,
                    tr: {
                        p: { a: 0, k: [10, 0] },
                        a: { a: 0, k: [0, 0] },
                        s: { a: 0, k: [100, 100] },
                        r: { a: 0, k: 0 },
                        o: { a: 0, k: 100 },
                        so: { a: 0, k: 100 },
                        eo: { a: 0, k: 0 },
                    },
                }],
            }],
        }));
        const repeater = anim.layers[0].shapes![0];
        expect(repeater.type).toBe('repeater');
        expect(repeater.copies!.value).toBe(3);
        expect(repeater.transform!.position.value).toEqual([10, 0]);
        expect(repeater.transform!.startOpacity!.value).toBe(100);
        expect(repeater.transform!.endOpacity!.value).toBe(0);
    });
    it('parses masks and matte', () => {
        const anim = parseTgs(tgs({
            layers: [
                {
                    ind: 0,
                    ty: 4,
                    ks: {},
                    tt: 1,
                    masksProperties: [{
                        nm: 'Mask 1',
                        inv: true,
                        mode: 's',
                        pt: { a: 0, k: { c: true, v: [[0, 0], [10, 0], [10, 10]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]] } },
                        o: { a: 0, k: 100 },
                        x: { a: 0, k: 0 },
                    }],
                },
                { ind: 1, ty: 4, ks: {}, td: 1 },
            ],
        }));
        const layer = anim.layers[0];
        expect(layer.matteType).toBe(MatteType.Alpha);
        expect(layer.masks).toHaveLength(1);
        expect(layer.masks![0].mode).toBe(MaskMode.Subtract);
        expect(layer.masks![0].inverted).toBe(true);
        expect(layer.masks![0].opacity.value).toBe(100);
        expect(anim.layers[1].matteTarget).toBe(true);
    });
    it('parses markers', () => {
        const anim = parseTgs(tgs({
            markers: [{ cm: 'loop', dr: 30, tm: 0 }],
            layers: [],
        }));
        expect(anim.markers).toEqual([{ name: 'loop', startFrame: 0, endFrame: 30 }]);
    });
    it('parses text layers', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 5,
                ks: {},
                t: { d: { k: [{ t: 0, s: { t: 'Hello', f: 'Roboto', s: 24, fc: [1, 0, 0] } }] } },
            }],
        }));
        const text = anim.layers[0].text!;
        expect(text.text).toBe('Hello');
        expect(text.fontFamily).toBe('Roboto');
        expect(text.fontSize).toBe(24);
        expect(text.fillColor).toEqual([1, 0, 0]);
    });
    it('keeps the previous end value when the tail keyframe has no start value (v4 exports)', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'tm',
                    s: { a: 1, k: [
                        { t: 0, s: [0], e: [100], i: { x: [0], y: [0] }, o: { x: [1], y: [1] } },
                        { t: 60 },
                    ] },
                    e: { a: 0, k: 100 },
                    o: { a: 0, k: 0 },
                    m: 1,
                }],
            }],
        }));
        const start = anim.layers[0].shapes![0].start!;
        expect(start.keyframes).toHaveLength(1);
        expect(interpolateKeyframes(start, 30)).toEqual([50]);
        expect(interpolateKeyframes(start, 60)).toEqual([100]);
        expect(interpolateKeyframes(start, 120)).toEqual([100]);
    });
    it('discards intermediate keyframes without i/o tangents (rlottie)', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'tm',
                    s: { a: 1, k: [
                        { t: 0, s: [0], i: { x: [0], y: [0] }, o: { x: [1], y: [1] } },
                        { t: 30, s: [50] },
                        { t: 60, s: [100], i: { x: [0], y: [0] }, o: { x: [1], y: [1] } },
                    ] },
                    e: { a: 0, k: 100 },
                    o: { a: 0, k: 0 },
                    m: 1,
                }],
            }],
        }));
        const start = anim.layers[0].shapes![0].start!;
        expect(start.keyframes).toHaveLength(2);
        expect(interpolateKeyframes(start, 30)).toEqual([50]);
        expect(interpolateKeyframes(start, 45)).toEqual([75]);
        expect(interpolateKeyframes(start, 60)).toEqual([100]);
    });
    it('unwraps array-wrapped path keyframe values', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'sh',
                    nm: 'Path 1',
                    ks: { a: 1, k: [
                        {
                            t: 0,
                            s: [{ c: true, v: [[0, 0], [10, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] }],
                            i: { x: [0], y: [0] },
                            o: { x: [1], y: [1] },
                        },
                        {
                            t: 10,
                            s: [{ c: true, v: [[100, 0], [110, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] }],
                        },
                    ] },
                }],
            }],
        }));
        const mid = interpolateKeyframes(anim.layers[0].shapes![0].vertices!, 5);
        expect(mid.c).toBe(true);
        expect(mid.v).toEqual([[50, 0], [60, 0]]);
    });
    it('maps trim m:2 to individually', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{ ty: 'tm', m: 2, s: { a: 0, k: 0 }, e: { a: 0, k: 100 }, o: { a: 0, k: 0 } }],
            }],
        }));
        expect(anim.layers[0].shapes![0].trimMode).toBe('individually');
    });
    it('parses gradient highlight length/angle and colorPoints', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'gf',
                    t: 2,
                    h: { a: 0, k: 0.5 },
                    a: { a: 0, k: 90 },
                    s: { a: 0, k: [0, 0] },
                    e: { a: 0, k: [100, 100] },
                    o: { a: 0, k: 100 },
                    g: { p: 2, k: [0, 0, 0, 0, 1, 0, 0, 1] },
                }],
            }],
        }));
        const grad = anim.layers[0].shapes![0].gradient!;
        expect(grad.highlightLength!.value).toBe(0.5);
        expect(grad.highlightAngle!.value).toBe(90);
        expect(grad.colorPoints).toBe(2);
    });
    it('maps mask mode f to difference', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                masksProperties: [{
                    mode: 'f',
                    pt: { a: 0, k: { c: true, v: [[0, 0], [10, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] } },
                    o: { a: 0, k: 100 },
                }],
            }],
        }));
        expect(anim.layers[0].masks![0].mode).toBe(MaskMode.Difference);
    });
    it('drops hidden shapes (rlottie parseObject)', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                ks: {},
                shapes: [{
                    ty: 'gr',
                    it: [
                        { ty: 'fl', hd: true, c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } },
                        { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] } },
                    ],
                }],
            }],
        }));
        const children = anim.layers[0].shapes![0].children!;
        expect(children).toHaveLength(1);
        expect(children[0].type).toBe('ellipse');
    });
    it('forces hidden layers to null and drops their content', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                hd: true,
                ks: {},
                shapes: [{ ty: 'fl', c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } }],
            }],
        }));
        expect(anim.layers).toHaveLength(1);
        expect(anim.layers[0].type).toBe(LayerType.Null);
        expect(anim.layers[0].hidden).toBe(true);
        expect(anim.layers[0].shapes).toBeUndefined();
        expect(anim.layers[0].transform).toBeDefined();
    });
    it('drops layers without a transform and self-parented layers', () => {
        const anim = parseTgs(tgs({
            layers: [
                { ind: 0, ty: 4 },
                { ind: 1, ty: 4, parent: 1, ks: {} },
                { ind: 2, ty: 4, ks: {} },
            ],
        }));
        expect(anim.layers).toHaveLength(1);
        expect(anim.layers[0].index).toBe(2);
    });
    it('parses precomp layer size (w/h)', () => {
        const anim = parseTgs(tgs({
            layers: [{ ind: 0, ty: 0, w: 300, h: 200, ks: {} }],
        }));
        expect(anim.layers[0].layerWidth).toBe(300);
        expect(anim.layers[0].layerHeight).toBe(200);
    });
    it('layerInfo returns name/in/out for each layer', () => {
        const anim = parseTgs(tgs({
            layers: [
                { ind: 0, ty: 4, nm: 'A', ip: 0, op: 60, ks: {} },
                { ind: 1, ty: 4, nm: 'B', ip: 60, op: 120, ks: {} },
            ],
        }));
        const info = layerInfo(anim);
        expect(info).toEqual([
            { name: 'A', inFrame: 0, outFrame: 60 },
            { name: 'B', inFrame: 60, outFrame: 120 },
        ]);
    });
});
describe('interpolateKeyframes', () => {
    function prop(keyframes: any[]): ParsedProperty {
        return { animated: true, value: keyframes[0].s, keyframes: keyframes as any };
    }
    it('returns the static value for non-animated properties', () => {
        expect(interpolateKeyframes({ animated: false, value: 42 }, 10)).toBe(42);
    });
    it('interpolates linearly without easing', () => {
        const p = prop([
            { t: 0, s: [0, 0] },
            { t: 10, s: [100, 200] },
        ]);
        expect(interpolateKeyframes(p, 0)).toEqual([0, 0]);
        expect(interpolateKeyframes(p, 5)).toEqual([50, 100]);
        expect(interpolateKeyframes(p, 10)).toEqual([100, 200]);
    });
    it('clamps frames before first and after last keyframe', () => {
        const p = prop([
            { t: 10, s: [0] },
            { t: 20, s: [100] },
        ]);
        expect(interpolateKeyframes(p, 0)).toEqual([0]);
        expect(interpolateKeyframes(p, 99)).toEqual([100]);
    });
    it('uses end value of the last keyframe beyond its frame', () => {
        const p = prop([
            { t: 0, s: [0], e: [50] },
            { t: 10, s: [100], e: [140] },
        ]);
        expect(interpolateKeyframes(p, 5)).toEqual([25]);
        expect(interpolateKeyframes(p, 10)).toEqual([140]);
        expect(interpolateKeyframes(p, 15)).toEqual([140]);
    });
    it('fills missing end values from the next keyframe (rlottie noEndValue)', () => {
        const p = prop([
            { t: 0, s: [0], e: [50] },
            { t: 10, s: [100] },
        ]);
        expect(interpolateKeyframes(p, 5)).toEqual([50]);
    });
    it('holds value for hold keyframes', () => {
        const p = prop([
            { t: 0, s: [10] },
            { t: 10, s: [20], h: 1 },
            { t: 20, s: [30] },
        ]);
        expect(interpolateKeyframes(p, 5)).toEqual([15]);
        expect(interpolateKeyframes(p, 10)).toEqual([20]);
        expect(interpolateKeyframes(p, 15)).toEqual([20]);
        expect(interpolateKeyframes(p, 19)).toEqual([20]);
        expect(interpolateKeyframes(p, 20)).toEqual([30]);
    });
    it('applies cubic bezier easing like rlottie VInterpolator', () => {
        const p = prop([
            {
                t: 0,
                s: [0],
                i: { x: [0.667], y: [1] },
                o: { x: [0.333], y: [0] },
            },
            { t: 100, s: [100] },
        ]);
        const mid = interpolateKeyframes(p, 50)[0];
        expect(mid).toBeCloseTo(50, 0);
        const q = interpolateKeyframes(p, 25)[0];
        expect(q).toBeLessThan(25);
        expect(q).toBeGreaterThan(10);
        expect(q).toBeCloseTo(15.625, 1);
    });
    it('uses tangent values as-is (rlottie does not normalize 0-100 tangents)', () => {
        const p = prop([
            {
                t: 0,
                s: [0],
                o: { x: [0], y: [0] },
                i: { x: [1], y: [1] },
            },
            { t: 100, s: [100] },
        ]);
        expect(interpolateKeyframes(p, 25)[0]).toBeCloseTo(25, 6);
        expect(interpolateKeyframes(p, 50)[0]).toBeCloseTo(50, 6);
    });
    it('interpolates scalars', () => {
        const p = prop([
            { t: 0, s: 0 },
            { t: 10, s: 100 },
        ]);
        expect(interpolateKeyframes(p, 5)).toBe(50);
    });
    it('interpolates colors', () => {
        const p = prop([
            { t: 0, s: [1, 0, 0] },
            { t: 10, s: [0, 0, 1] },
        ]);
        expect(interpolateKeyframes(p, 5)).toEqual([0.5, 0, 0.5]);
    });
    it('interpolates path vertex data', () => {
        const p = prop([
            { t: 0, s: { c: true, v: [[0, 0], [10, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] } },
            { t: 10, s: { c: true, v: [[100, 0], [110, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] } },
        ]);
        const mid = interpolateKeyframes(p, 5);
        expect(mid.v).toEqual([[50, 0], [60, 0]]);
    });
    it('interpolates along the spatial bezier with to/ti tangents', () => {
        const p = prop([
            { t: 0, s: [0, 0], to: [100, 80], ti: [-100, 20] },
            { t: 10, s: [200, 0] },
        ]);
        const mid = interpolateKeyframes(p, 5);
        expect(mid[0]).toBeGreaterThan(90);
        expect(mid[0]).toBeLessThanOrEqual(100);
        expect(mid[1]).toBeGreaterThan(20);
        expect(mid[1]).toBeLessThan(50);
    });
    it('uses split dimension keyframes for x', () => {
        const p: any = {
            animated: true,
            value: [0, 0],
            keyframes: [
                { t: 0, s: [0] },
                { t: 10, s: [100] },
            ],
            x: {
                animated: true,
                value: [0],
                keyframes: [
                    { t: 0, s: [500] },
                    { t: 10, s: [500] },
                ],
            },
        };
        expect(interpolateKeyframes(p, 5)).toEqual([500, 50]);
    });
});
describe('model cache', () => {
    afterEach(() => configureModelCacheSize(10));
    it('returns the same model for the same key', () => {
        const json = tgs({ layers: [{ ind: 0, ty: 4, ks: {} }] });
        const a = parseTgs(json, { key: 'sticker-1' });
        const b = parseTgs(json, { key: 'sticker-1' });
        expect(a).toBe(b);
    });
    it('evicts oldest entries beyond the cache size', () => {
        configureModelCacheSize(1);
        const json = tgs({ layers: [] });
        const a = parseTgs(json, { key: 'k1' });
        parseTgs(json, { key: 'k2' });
        const again = parseTgs(json, { key: 'k1' });
        expect(again).not.toBe(a);
    });
    it('cache size 0 disables caching', () => {
        configureModelCacheSize(0);
        const json = tgs({ layers: [] });
        const a = parseTgs(json, { key: 'k' });
        const b = parseTgs(json, { key: 'k' });
        expect(a).not.toBe(b);
    });
});
describe('setValue / keypath', () => {
    function animWithFill() {
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
                        { ty: 'st', nm: 'Stroke 1', c: { a: 0, k: [0, 1, 0] }, o: { a: 0, k: 100 }, w: { a: 0, k: 2 } },
                        { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
                    ],
                }],
            }],
        }));
    }
    it('overrides a fill color by exact keypath', () => {
        const anim = animWithFill();
        setValue(anim, 'Layer 1.Group 1.Fill 1', Property.FillColor, [0, 0, 1]);
        const fill = anim.layers[0].shapes![0].children![0];
        expect(interpolateKeyframes(fill.color!, 0)).toEqual([0, 0, 1]);
    });
    it('overrides with a per-frame function', () => {
        const anim = animWithFill();
        setValue(anim, '**', Property.FillColor, (info) => (info.curFrame < 30 ? [0, 0, 1] : [1, 1, 0]));
        const fill = anim.layers[0].shapes![0].children![0];
        expect(interpolateKeyframes(fill.color!, 0)).toEqual([0, 0, 1]);
        expect(interpolateKeyframes(fill.color!, 60)).toEqual([1, 1, 0]);
    });
    it('overrides layer transform via **.Transform', () => {
        const anim = animWithFill();
        setValue(anim, '**.Transform', Property.TrPosition, [50, 60]);
        expect(interpolateKeyframes(anim.layers[0].transform.position, 0)).toEqual([50, 60]);
    });
    it('overrides stroke width', () => {
        const anim = animWithFill();
        setValue(anim, 'Layer 1.**.Stroke 1', Property.StrokeWidth, 9);
        const stroke = anim.layers[0].shapes![0].children![1];
        expect(interpolateKeyframes(stroke.strokeWidth!, 0)).toBe(9);
    });
    it('overrides animated properties too', () => {
        const anim = parseTgs(tgs({
            layers: [{
                ind: 0,
                ty: 4,
                nm: 'L',
                ks: {},
                shapes: [{
                    ty: 'tm',
                    nm: 'Trim 1',
                    s: { a: 1, k: [{ t: 0, s: [0] }, { t: 60, s: [100] }] },
                    e: { a: 0, k: 100 },
                    o: { a: 0, k: 0 },
                    m: 1,
                }],
            }],
        }));
        setValue(anim, 'L.Trim 1', Property.TrimStart, [40]);
        const trim = anim.layers[0].shapes![0];
        expect(interpolateKeyframes(trim.start!, 30)).toEqual([40]);
    });
    it('throws when keypath matches nothing', () => {
        const anim = animWithFill();
        expect(() => setValue(anim, 'Nope.Nothing', Property.FillColor, [0, 0, 0])).toThrow(/no property matched/);
    });
});
describe('matchKeyPath', () => {
    it('matches exact paths', () => {
        expect(matchKeyPath('A.B.C', ['A', 'B', 'C'])).toBe(true);
        expect(matchKeyPath('A.B.C', ['A', 'B'])).toBe(false);
    });
    it('matches * wildcard', () => {
        expect(matchKeyPath('A.*.C', ['A', 'B', 'C'])).toBe(true);
        expect(matchKeyPath('A.*.C', ['A', 'B', 'D'])).toBe(false);
    });
    it('matches ** globstar', () => {
        expect(matchKeyPath('**.Fill', ['Layer 1', 'Group 1', 'Fill'])).toBe(true);
        expect(matchKeyPath('Layer 1.**', ['Layer 1', 'Group 1', 'Fill'])).toBe(true);
        expect(matchKeyPath('Layer 1.**', ['Layer 2', 'Group 1'])).toBe(false);
        expect(matchKeyPath('**', ['anything', 'at', 'all'])).toBe(true);
    });
});
describe('frameAtPos', () => {
    it('maps position in [0,1] to a frame', () => {
        const anim = parseTgs(tgs({ layers: [] }));
        expect(frameAtPos(anim, 0)).toBe(0);
        expect(frameAtPos(anim, 1)).toBe(180);
        expect(frameAtPos(anim, 0.5)).toBe(90);
        expect(frameAtPos(anim, -1)).toBe(0);
        expect(frameAtPos(anim, 5)).toBe(180);
    });
});
