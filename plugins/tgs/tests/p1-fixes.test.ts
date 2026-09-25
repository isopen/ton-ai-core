import { parseTgs, setValue, Property, interpolateKeyframes, frameAtPos, configureModelCacheSize } from '@ton-ai/tgs';

function tgs(body: object): string {
    return JSON.stringify({ tgs: 1, v: '5.5.2', fr: 60, ip: 0, op: 180, w: 100, h: 100, nm: 'p1', ...body });
}
function ks(extra: any = {}): any {
    return { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, ...extra };
}
function shapeLayer(ind: number, shapes: any[], extraKs: any = {}, extraLayer: any = {}): any {
    return { ind, ty: 4, ip: 0, op: 180, ks: ks(extraKs), shapes, ...extraLayer };
}
const RECT = { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } };
const FILL_RED = { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } };

class MockGradient {
    stops: Array<[number, string]> = [];
    addColorStop(off: number, color: string) { this.stops.push([off, color]); }
}
class MockCtx {
    fills: string[] = [];
    strokes: string[] = [];
    dashes: number[][] = [];
    dashOffsets: number[] = [];
    path: string[] = [];
    pathsAtFill: string[][] = [];
    fillStyle: any = '';
    strokeStyle: any = '';
    lineWidth = 1;
    lineCap: any = 'butt';
    lineJoin: any = 'miter';
    miterLimit = 10;
    globalAlpha = 1;
    font = '';
    textAlign = 'start';
    textBaseline = 'alphabetic';
    private _gco = 'source-over';
    get globalCompositeOperation() { return this._gco; }
    set globalCompositeOperation(v: string) { this._gco = v; }
    private _off = 0;
    get lineDashOffset() { return this._off; }
    set lineDashOffset(v: number) { this._off = v; this.dashOffsets.push(v); }
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
    setTransform() { }
    clearRect() { }
    fillRect() { }
    save() { }
    restore() { }
    clip() { }
    beginPath() { this.path = []; }
    rect() { }
    moveTo(x: number, y: number) { this.path.push('M' + x + ',' + y); }
    lineTo(x: number, y: number) { this.path.push('L' + x + ',' + y); }
    bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number) { this.path.push('C' + [a, b, c, d, e, f].join(',')); }
    closePath() { this.path.push('Z'); }
    fill() { this.fills.push(String(this.fillStyle)); this.pathsAtFill.push(this.path.slice()); this.path = []; }
    stroke() { this.strokes.push(String(this.strokeStyle)); this.path = []; }
    setLineDash(d: number[]) { this.dashes.push(d.slice()); }
    drawImage() { }
    createLinearGradient() { return new MockGradient(); }
    createRadialGradient() { return new MockGradient(); }
    getImageData() { return { data: [] as number[] }; }
    putImageData() { }
    fillText() { }
    strokeText() { }
}
class MockCanvas {
    width = 0;
    height = 0;
    clientWidth = 100;
    clientHeight = 100;
    ctx = new MockCtx();
    getContext(t: string): any { return t === '2d' ? this.ctx : null; }
}
let renderFrame: any;
function render(body: object, frame = 0, order: any = undefined, hidden: any = undefined): MockCanvas {
    const anim = parseTgs(tgs(body));
    const canvas = new MockCanvas();
    renderFrame(canvas, anim, frame, 1, undefined, undefined, order ?? 'default', hidden);
    return canvas;
}
function maskCovering(mode: string, inv = false): any {
    return {
        inv, mode,
        pt: { a: 0, k: { v: [[-200, -200], [200, -200], [200, 200], [-200, 200]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], c: true } },
        o: { a: 0, k: 100 }, x: { a: 0, k: 0 },
    };
}

describe('p1 fixes', () => {
    beforeEach(() => {
        jest.resetModules();
        (globalThis as any).document = { createElement: () => new MockCanvas() };
        renderFrame = require('../src/renderer.js').renderFrame;
    });
    afterAll(() => { delete (globalThis as any).document; });

    test('cached parse results are isolated from setValue', () => {
        const body = tgs({ layers: [shapeLayer(0, [{ ty: 'fl', nm: 'F', c: { a: 0, k: [0, 0, 1, 1] }, o: { a: 0, k: 100 } }], {}, { nm: 'L' })] });
        const a = parseTgs(body, { key: 'p1-cache' });
        const b = parseTgs(body, { key: 'p1-cache' });
        expect(a === (b as unknown)).toBe(false);
        setValue(a, 'L.F', Property.FillColor, [1, 0, 0, 1]);
        const cb = (b.layers[0].shapes as any[])[0].color;
        expect(interpolateKeyframes(cb, 0)).toEqual([0, 0, 1, 1]);
        const c = parseTgs(body, { key: 'p1-cache' });
        const cc = (c.layers[0].shapes as any[])[0].color;
        expect(interpolateKeyframes(cc, 0)).toEqual([0, 0, 1, 1]);
    });

    test('split y keeps base value on empty keyframes', () => {
        const p = { k: [100, 50], x: { a: 1, k: [{ t: 0, s: [0] }, { t: 60, s: [200] }] }, y: { a: 1, k: [] } };
        const anim = parseTgs(tgs({ layers: [shapeLayer(0, [], { p })] }));
        expect(interpolateKeyframes(anim.layers[0].transform.position, 30)).toEqual([100, 50]);
    });

    test('dash offset follows the o item, pattern keeps d and g', () => {
        const stroke = (d: any[]) => ({ ty: 'st', c: { a: 0, k: [0, 1, 0, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 5 }, d });
        const v = (k: number) => ({ a: 0, k });
        const offResult = render({ layers: [shapeLayer(0, [RECT, stroke([{ n: 'd', v: v(4) }, { n: 'g', v: v(2) }, { n: 'o', v: v(7) }])])] });
        expect(offResult.ctx.dashes[0][0]).toBeCloseTo(4, 4);
        expect(offResult.ctx.dashes[0][1]).toBeCloseTo(2, 4);
        expect(offResult.ctx.dashOffsets[0]).toBeCloseTo(7, 4);
        const noOff = render({ layers: [shapeLayer(0, [RECT, stroke([{ n: 'd', v: v(4) }, { n: 'g', v: v(2) }])])] });
        expect(noOff.ctx.dashes[0][0]).toBeCloseTo(4, 4);
        expect(noOff.ctx.dashes[0][1]).toBeCloseTo(2, 4);
        expect(noOff.ctx.dashOffsets[0]).toBeCloseTo(0, 4);
    });

    test('zero dash paint does not cancel sibling paints', () => {
        const zero = { ty: 'st', c: { a: 0, k: [0, 1, 0, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 5 }, d: [{ n: 'd', v: { a: 0, k: 0 } }, { n: 'g', v: { a: 0, k: 0 } }] };
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED, RECT, zero])] });
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
    });

    test('star rotation changes geometry', () => {
        const star = (rot: number) => ({ ty: 'sr', sy: 1, pt: { a: 0, k: 5 }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: rot }, or: { a: 0, k: 50 }, ir: { a: 0, k: 25 }, os: 0, is: 0 });
        const a = render({ layers: [shapeLayer(0, [star(0), FILL_RED])] });
        const b = render({ layers: [shapeLayer(0, [star(90), FILL_RED])] });
        expect(a.ctx.pathsAtFill[0]).not.toEqual(b.ctx.pathsAtFill[0]);
    });

    test('skew changes geometry', () => {
        const plain = render({ layers: [shapeLayer(0, [RECT, FILL_RED])] });
        const skewed = render({ layers: [shapeLayer(0, [RECT, FILL_RED], { sk: { a: 0, k: 20 }, sa: { a: 0, k: 0 } })] });
        expect(plain.ctx.pathsAtFill[0]).not.toEqual(skewed.ctx.pathsAtFill[0]);
    });

    test('multi contour path emits separate subpaths', () => {
        const contour = (dx: number) => ({ v: [[dx, 0], [dx + 10, 0], [dx + 10, 10], [dx, 10]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], c: true });
        const path = { ty: 'sh', ks: { a: 0, k: [contour(0), contour(50)] } };
        const c = render({ layers: [shapeLayer(0, [path, FILL_RED])] });
        const cmds = c.ctx.pathsAtFill[0];
        expect(cmds[0].startsWith('M')).toBe(true);
        expect(cmds.filter((x) => x.startsWith('M')).length).toBe(2);
    });

    test('static time remap maps seconds to frames', () => {
        const inner = { ind: 9, ty: 4, ip: 120, op: 180, ks: ks(), shapes: [RECT, FILL_RED] };
        const body = { layers: [{ ind: 0, ty: 0, ip: 0, op: 180, st: 0, refId: 'A', tm: { a: 0, k: 2 }, ks: ks() }], assets: [{ id: 'A', layers: [inner] }] };
        const c = render(body, 0);
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
    });

    test('unsorted keyframes interpolate in time order', () => {
        const p = { a: 1, k: [{ t: 60, s: [60, 0] }, { t: 0, s: [0, 0] }] };
        const anim = parseTgs(tgs({ layers: [shapeLayer(0, [], { p })] }));
        expect(interpolateKeyframes(anim.layers[0].transform.position, 30)).toEqual([30, 0]);
    });

    test('frameAtPos guards non finite input', () => {
        const anim = parseTgs(tgs({ layers: [] }));
        expect(frameAtPos(anim, NaN)).toBe(anim.inFrame);
    });

    test('negative cache size disables caching', () => {
        configureModelCacheSize(10);
        const body = tgs({ layers: [] });
        const a = parseTgs(body, { key: 'p1-neg' });
        configureModelCacheSize(-5);
        const b = parseTgs(body, { key: 'p1-neg' });
        expect(a === (b as unknown)).toBe(false);
        configureModelCacheSize(10);
    });

    test('hidden layers stay hidden inside precomps', () => {
        const hide = { ind: 1, ty: 4, nm: 'hide-me', ip: 0, op: 180, ks: ks(), shapes: [RECT, { ty: 'fl', c: { a: 0, k: [0, 1, 0, 1] }, o: { a: 0, k: 100 } }] };
        const keep = { ind: 2, ty: 4, nm: 'keep', ip: 0, op: 180, ks: ks(), shapes: [RECT, FILL_RED] };
        const body = { layers: [{ ind: 0, ty: 0, ip: 0, op: 180, ks: ks(), refId: 'A' }], assets: [{ id: 'A', layers: [hide, keep] }] };
        const c = render(body, 0, undefined, (n?: string) => n === 'hide-me');
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
    });

    test('unpaired matte source is not painted', () => {
        const src = shapeLayer(1, [RECT, FILL_RED], {}, { td: 1 });
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED]), src] });
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
    });

    test('lone inverted subtract mask hides content', () => {
        const layer = shapeLayer(0, [RECT, FILL_RED]);
        (layer as any).masksProperties = [maskCovering('s', true)];
        const c = render({ layers: [layer] });
        expect(c.ctx.fills).toEqual([]);
    });
});
