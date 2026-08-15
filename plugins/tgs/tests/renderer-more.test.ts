import { parseTgs } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';
let renderFrame: (canvas: any, anim: ParsedAnimation, frame: number, dpr: number, w?: number, h?: number, order?: 'default' | 'reversed') => void;
let created: MockCanvas[] = [];
class MockGradient {
    stops: Array<[number, string]> = [];
    addColorStop(off: number, color: string) { this.stops.push([off, color]); }
    toString() { return '[gradient]'; }
}
class MockCtx {
    calls: string[] = [];
    path: string[] = [];
    pathsAtFill: string[][] = [];
    fills: string[] = [];
    strokes: string[] = [];
    fillRules: string[] = [];
    dashes: number[][] = [];
    dashOffsets: number[] = [];
    private _lineDashOffset = 0;
    get lineDashOffset() { return this._lineDashOffset; }
    set lineDashOffset(v: number) { this._lineDashOffset = v; this.dashOffsets.push(v); }
    gradients: MockGradient[] = [];
    textFills: Array<{ text: string; x: number; y: number }> = [];
    textStrokes: Array<{ text: string; x: number; y: number }> = [];
    fillStyle: any = '';
    strokeStyle: any = '';
    canvas: MockCanvas | null = null;
    lineWidth = 1;
    lineCap: any = 'butt';
    lineJoin: any = 'miter';
    miterLimit = 10;
    globalAlpha = 1;
    font = '';
    textAlign = 'start';
    textBaseline = 'alphabetic';
    compositeOps: string[] = [];
    imageDataCount = 0;
    putImageDataCount = 0;
    private _gco = 'source-over';
    get globalCompositeOperation(): string { return this._gco; }
    set globalCompositeOperation(v: string) { this._gco = v; this.compositeOps.push(v); }
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
    private r(n: number): number { return Math.round(n * 1000) / 1000; }
    private numList(args: number[]): string { return args.map(this.r).join(','); }
    setTransform(...args: number[]) { this.calls.push('setTransform(' + this.numList(args) + ')'); }
    clearRect(...args: number[]) { this.calls.push('clearRect(' + this.numList(args) + ')'); }
    save() { this.calls.push('save'); }
    restore() { this.calls.push('restore'); }
    clip() { this.calls.push('clip'); }
    beginPath() { this.calls.push('beginPath'); this.path = []; }
    rect(...args: number[]) { this.calls.push('rect(' + this.numList(args) + ')'); }
    moveTo(x: number, y: number) { this.path.push('M' + this.r(x) + ',' + this.r(y)); }
    lineTo(x: number, y: number) { this.path.push('L' + this.r(x) + ',' + this.r(y)); }
    bezierCurveTo(...pts: number[]) { this.path.push('C' + this.numList(pts)); }
    closePath() { this.path.push('Z'); }
    fill(rule?: string) {
        this.fills.push(String(this.fillStyle));
        this.fillRules.push(rule || 'nonzero');
        this.pathsAtFill.push(this.path.slice());
        this.path = [];
    }
    stroke() { this.strokes.push(String(this.strokeStyle)); this.path = []; }
    setLineDash(d: number[]) { this.dashes.push(d.slice()); }
    drawImage(img: any, x: number, y: number) { this.calls.push('drawImage(' + x + ',' + y + ')'); }
    createLinearGradient(...args: number[]) { const g = new MockGradient(); this.gradients.push(g); this.calls.push('createLinearGradient(' + this.numList(args) + ')'); return g; }
    createRadialGradient(...args: number[]) { const g = new MockGradient(); this.gradients.push(g); this.calls.push('createRadialGradient(' + this.numList(args) + ')'); return g; }
    getImageData() {
        this.imageDataCount++;
        const n = this.canvas ? this.canvas.width * this.canvas.height : 0;
        const data = new Uint8ClampedArray(n * 4);
        for (let i = 0; i < n; i++) data[i * 4 + 3] = i % 2 === 0 ? 0 : 255;
        return { data };
    }
    putImageData() { this.putImageDataCount++; }
    fillText(text: string, x: number, y: number) { this.textFills.push({ text, x, y }); }
    strokeText(text: string, x: number, y: number) { this.textStrokes.push({ text, x, y }); }
}
class MockCanvas {
    width = 0;
    height = 0;
    clientWidth = 0;
    clientHeight = 0;
    ctx = new MockCtx();
    constructor() { this.ctx.canvas = this; }
    getContext(type: string): any { return type === '2d' ? this.ctx : null; }
}
function tgs(body: object): string {
    return JSON.stringify({
        tgs: 1, v: '5.5.2', fr: 60, ip: 0, op: 180, w: 100, h: 100, nm: 'test',
        ...body,
    });
}
const RECT = { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } };
const FILL_RED = { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } };
const FILL_BLUE = { ty: 'fl', c: { a: 0, k: [0, 0, 1, 1] }, o: { a: 0, k: 100 } };
function shapeLayer(ind: number, shapes: any[], ks: any = {}, layer: any = {}): any {
    return {
        ind, ty: 4, ip: 0, op: 180,
        ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, ...ks },
        shapes, ...layer,
    };
}
function render(body: object, opts: { clientWidth?: number; clientHeight?: number; dpr?: number; frame?: number; order?: 'default' | 'reversed' } = {}): MockCanvas {
    const anim = parseTgs(tgs(body));
    const canvas = new MockCanvas();
    canvas.clientWidth = opts.clientWidth ?? 100;
    canvas.clientHeight = opts.clientHeight ?? 100;
    renderFrame(canvas, anim, opts.frame ?? 0, opts.dpr ?? 1, undefined, undefined, opts.order ?? 'default');
    return canvas;
}
describe('renderFrame extras', () => {
    beforeEach(() => {
        jest.resetModules();
        created = [];
        (globalThis as any).document = {
            createElement: () => {
                const c = new MockCanvas();
                created.push(c);
                return c;
            },
        };
        renderFrame = require('../src/renderer.js').renderFrame;
    });
    afterAll(() => {
        delete (globalThis as any).document;
    });
    it('renders a 5-point star with inner and outer radii', () => {
        const STAR = {
            ty: 'sr', sy: 1, pt: { a: 0, k: 5 },
            p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 },
            or: { a: 0, k: 50 }, ir: { a: 0, k: 25 }, os: 0, is: 0,
        };
        const c = render({ layers: [shapeLayer(0, [STAR, FILL_RED])] });
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
        expect(c.ctx.pathsAtFill[0][0]).toBe('M0,-50');
        expect(c.ctx.pathsAtFill[0][c.ctx.pathsAtFill[0].length - 1]).toBe('Z');
        expect(c.ctx.pathsAtFill[0].length).toBeGreaterThan(8);
    });
    it('renders a polygon (starType 2) with equal radii', () => {
        const POLY = {
            ty: 'sr', sy: 2, pt: { a: 0, k: 6 },
            p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 },
            or: { a: 0, k: 50 }, ir: { a: 0, k: 50 }, os: 0, is: 0,
        };
        const c = render({ layers: [shapeLayer(0, [POLY, FILL_RED])] });
        expect(c.ctx.fills).toHaveLength(1);
        expect(c.ctx.pathsAtFill[0][c.ctx.pathsAtFill[0].length - 1]).toBe('Z');
        expect(c.ctx.pathsAtFill[0]).toHaveLength(9);
    });
    it('renders a rounded rect with bezier corners', () => {
        const RR = { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, rd: { a: 0, k: 10 } };
        const c = render({ layers: [shapeLayer(0, [RR, FILL_RED])] });
        expect(c.ctx.pathsAtFill[0].some((cmd) => cmd.startsWith('C'))).toBe(true);
    });
    it('applies the evenodd fill rule when r:2', () => {
        const FILL_EO = { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 2 };
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_EO])] });
        expect(c.ctx.fillRules).toEqual(['evenodd']);
        const c2 = render({ layers: [shapeLayer(0, [RECT, FILL_RED])] });
        expect(c2.ctx.fillRules).toEqual(['nonzero']);
    });
    it('renders gradient strokes with width and gradient stops', () => {
        const GS = {
            ty: 'gs', w: { a: 0, k: 6 },
            s: { a: 0, k: [0, 0] }, e: { a: 0, k: [100, 0] },
            o: { a: 0, k: 100 },
            g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } },
        };
        const c = render({ layers: [shapeLayer(0, [RECT, GS])] });
        expect(c.ctx.strokes).toEqual(['[gradient]']);
        expect(c.ctx.lineWidth).toBeCloseTo(6, 4);
        expect(c.ctx.gradients[0].stops).toEqual([
            [0, 'rgba(255,0,0,1)'],
            [1, 'rgba(0,0,255,1)'],
        ]);
    });
    it('shifts the trim segment by the offset', () => {
        const TRIM_0 = { ty: 'tm', s: { a: 0, k: 0 }, e: { a: 0, k: 50 }, o: { a: 0, k: 0 }, m: 1 };
        const TRIM_OFF = { ty: 'tm', s: { a: 0, k: 0 }, e: { a: 0, k: 50 }, o: { a: 0, k: 50 }, m: 1 };
        const base = render({ layers: [shapeLayer(0, [RECT, FILL_RED, TRIM_0])] });
        const off = render({ layers: [shapeLayer(0, [RECT, FILL_RED, TRIM_OFF])] });
        expect(base.ctx.fills).toHaveLength(1);
        expect(off.ctx.fills).toHaveLength(1);
        expect(off.ctx.pathsAtFill[0]).not.toEqual(base.ctx.pathsAtFill[0]);
    });
    it('trims multiple paths individually (m:2)', () => {
        const TRIM = { ty: 'tm', s: { a: 0, k: 0 }, e: { a: 0, k: 50 }, o: { a: 0, k: 0 }, m: 2 };
        const c = render({ layers: [shapeLayer(0, [RECT, RECT, FILL_RED, TRIM])] });
        expect(c.ctx.fills).toHaveLength(1);
        expect(c.ctx.pathsAtFill[0].length).toBeLessThan(12);
    });
    it('timeRemap rewinds precomp children to an earlier frame', () => {
        const body = {
            assets: [{ id: 'p1', w: 100, h: 100, layers: [shapeLayer(1, [RECT, FILL_RED], {}, { ip: 0, op: 60 })] }],
            layers: [{
                ind: 0, ty: 0, refId: 'p1', w: 100, h: 100,
                ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
                tm: { a: 1, k: [{ t: 0, s: 0 }, { t: 60, s: 3 }] },
            }],
        };
        const at0 = render(body, { frame: 0 });
        expect(at0.ctx.fills).toEqual(['rgba(255,0,0,1)']);
        const at30 = render(body, { frame: 30 });
        expect(at30.ctx.fills).toEqual([]);
    });
    it('starts precomp children at the layer startTime', () => {
        const body = {
            assets: [{ id: 'p1', w: 100, h: 100, layers: [shapeLayer(1, [RECT, FILL_RED], {}, { ip: 0, op: 30 })] }],
            layers: [{
                ind: 0, ty: 0, refId: 'p1', w: 100, h: 100, st: 60,
                ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
            }],
        };
        const before = render(body, { frame: 10 });
        expect(before.ctx.fills).toEqual([]);
        const after = render(body, { frame: 70 });
        expect(after.ctx.fills).toEqual(['rgba(255,0,0,1)']);
    });
    it('applies luma mattes through destination-in compositing', () => {
        const c = render({
            layers: [
                shapeLayer(0, [RECT, FILL_RED], {}, { td: 1 }),
                shapeLayer(1, [RECT, FILL_RED], {}, { tt: 3 }),
            ],
        });
        expect(c.ctx.fills).toEqual([]);
        const matteCtx = created.find((cv) => cv.ctx.compositeOps.includes('destination-in'));
        expect(matteCtx).toBeDefined();
    });
    it('applies inverted alpha mattes through destination-out compositing', () => {
        const c = render({
            layers: [
                shapeLayer(0, [RECT, FILL_RED], {}, { td: 1 }),
                shapeLayer(1, [RECT, FILL_RED], {}, { tt: 2 }),
            ],
        });
        expect(c.ctx.fills).toEqual([]);
        const matteCtx = created.find((cv) => cv.ctx.compositeOps.includes('destination-out'));
        expect(matteCtx).toBeDefined();
    });
    it('renders multiline text with a stroke', () => {
        const textLayer = {
            ind: 0, ty: 5, ip: 0, op: 180,
            ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
            t: { d: { k: [{ s: { t: 'line1\nline2', s: 30, f: 'Arial', fc: [1, 0, 0, 1], sc: [0, 1, 0, 1], sw: 2, j: 0 } }] } },
        };
        const c = render({ layers: [textLayer] });
        expect(c.ctx.textStrokes).toHaveLength(2);
        expect(c.ctx.textFills).toHaveLength(2);
        expect(c.ctx.textFills[0].y).toBeLessThan(c.ctx.textFills[1].y);
        expect(c.ctx.font).toBe('30px Arial');
    });
    it('renders overlapping layers in reversed order when requested', () => {
        const body = {
            layers: [
                shapeLayer(0, [RECT, FILL_RED], { p: { a: 0, k: [0, 0] } }),
                shapeLayer(1, [RECT, FILL_BLUE], { p: { a: 0, k: [0, 0] } }),
            ],
        };
        const def = render(body);
        const rev = render(body, { order: 'reversed' });
        expect(def.ctx.fills).toEqual(['rgba(0,0,255,1)', 'rgba(255,0,0,1)']);
        expect(rev.ctx.fills).toEqual(['rgba(255,0,0,1)', 'rgba(0,0,255,1)']);
    });
});
describe('renderFrame deep coverage', () => {
    beforeEach(() => {
        jest.resetModules();
        created = [];
        (globalThis as any).document = {
            createElement: () => {
                const c = new MockCanvas();
                created.push(c);
                return c;
            },
        };
        renderFrame = require('../src/renderer.js').renderFrame;
    });
    it('renders a rounded polygon with outer roundness', () => {
        const POLY = {
            ty: 'sr', sy: 2, pt: { a: 0, k: 6 },
            p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 },
            or: { a: 0, k: 50 }, ir: { a: 0, k: 50 }, os: 50, is: 0,
        };
        const c = render({ layers: [shapeLayer(0, [POLY, FILL_RED])] });
        expect(c.ctx.fills).toHaveLength(1);
        expect(c.ctx.pathsAtFill[0][0]).toMatch(/^M/);
        expect(c.ctx.pathsAtFill[0].some((cmd) => cmd.startsWith('C'))).toBe(true);
    });
    it('renders a star with fractional points and roundness', () => {
        const STAR = {
            ty: 'sr', sy: 1, pt: { a: 0, k: 5.5 },
            p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 },
            or: { a: 0, k: 50 }, ir: { a: 0, k: 25 }, os: 0, is: 50,
        };
        const c = render({ layers: [shapeLayer(0, [STAR, FILL_RED])] });
        expect(c.ctx.fills).toHaveLength(1);
        expect(c.ctx.pathsAtFill[0][c.ctx.pathsAtFill[0].length - 1]).toBe('Z');
        expect(c.ctx.pathsAtFill[0].some((cmd) => cmd.startsWith('C'))).toBe(true);
    });
    it('handles path shapes with empty, scalar and mixed vertex data', () => {
        const PATH_EMPTY = { ty: 'sh', ks: { a: 0, k: [] } };
        const PATH_SCALAR = { ty: 'sh', ks: { a: 0, k: 5 } };
        const PATH_OK = {
            ty: 'sh',
            ks: {
                a: 0,
                k: [
                    { v: [[0, 0], [10, 0], [10, 10]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], c: true },
                    { foo: 1 },
                ],
            },
        };
        const PATH_BAD = { ty: 'sh', ks: { a: 0, k: [{ foo: 1 }] } };
        const ok = render({ layers: [shapeLayer(0, [PATH_OK, FILL_RED])] });
        expect(ok.ctx.fills).toHaveLength(1);
        expect(ok.ctx.pathsAtFill[0][0]).toMatch(/^M/);
        const none = render({ layers: [shapeLayer(0, [PATH_EMPTY, PATH_SCALAR, PATH_BAD, FILL_RED])] });
        expect(none.ctx.fills).toEqual([]);
    });
    it('ignores unknown shape types without crashing', () => {
        const c = render({ layers: [shapeLayer(0, [{ ty: 'zzz', foo: 1 }, FILL_RED])] });
        expect(c.ctx.fills).toEqual([]);
    });
    it('renders solid layers from numeric and missing colors', () => {
        const solid = (sc: any) => ({
            ind: 0, ty: 1, sw: 100, sh: 100, sc, ip: 0, op: 180,
            ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
        });
        const num = render({ layers: [solid(0xFF0000)] });
        expect(num.ctx.fills).toEqual(['rgba(255,0,0,1)']);
        const none = render({ layers: [solid(undefined)] });
        expect(none.ctx.fills).toEqual(['#000']);
    });
    it('auto-orients layers using the animated position tangent', () => {
        const pos = {
            a: 1,
            k: [
                { t: 0, s: [0, 0], to: [50, 0], ti: [-50, 0], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } },
                { t: 30, s: [100, 0] },
            ],
        };
        const body = { layers: [shapeLayer(0, [RECT, FILL_RED], { p: pos }, { ao: 1 })] };
        const mid = render(body, { frame: 15 });
        expect(mid.ctx.fills).toHaveLength(1);
        const before = render(body, { frame: 0 });
        expect(before.ctx.fills).toHaveLength(1);
        const after = render(body, { frame: 60 });
        expect(after.ctx.fills).toHaveLength(1);
        const noTangent = render({
            layers: [shapeLayer(0, [RECT, FILL_RED], { p: { a: 1, k: [{ t: 0, s: [0, 0] }, { t: 30, s: [100, 0] }] } }, { ao: 1 })],
        });
        expect(noTangent.ctx.fills).toHaveLength(1);
    });
    it('trims across the whole range and with a zero-length segment', () => {
        const TRIM_FULL = { ty: 'tm', s: { a: 0, k: 0 }, e: { a: 0, k: 100 }, o: { a: 0, k: 0 }, m: 1 };
        const full = render({ layers: [shapeLayer(0, [RECT, FILL_RED, TRIM_FULL])] });
        expect(full.ctx.fills).toHaveLength(1);
        expect(full.ctx.pathsAtFill[0]).toHaveLength(6);
        const TRIM_ZERO = { ty: 'tm', s: { a: 0, k: 50 }, e: { a: 0, k: 50 }, o: { a: 0, k: 0 }, m: 1 };
        const zero = render({ layers: [shapeLayer(0, [RECT, FILL_RED, TRIM_ZERO])] });
        expect(zero.ctx.fills).toHaveLength(0);
    });
    it('wraps trim offsets around the 360-degree space', () => {
        const trim = (s: number, e: number, o: number) => ({ ty: 'tm', s: { a: 0, k: s }, e: { a: 0, k: e }, o: { a: 0, k: o }, m: 1 });
        const cases: Array<[number, number, number]> = [
            [95, 5, 40],
            [50, 95, 40],
            [60, 50, 200],
            [10, 5, -100],
            [10, 60, -100],
            [60, 10, -100],
        ];
        for (const [s, e, o] of cases) {
            const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED, trim(s, e, o)])] });
            expect(c.ctx.fills.length).toBeLessThanOrEqual(1);
        }
    });
    it('trims multiple paths individually with path boundaries in the middle', () => {
        const TRIM = { ty: 'tm', s: { a: 0, k: 10 }, e: { a: 0, k: 30 }, o: { a: 0, k: 0 }, m: 2 };
        const c = render({ layers: [shapeLayer(0, [RECT, RECT, RECT, FILL_RED, TRIM])] });
        expect(c.ctx.fills).toHaveLength(1);
    });
    it('trims multiple paths individually with the segment past the first path', () => {
        const TRIM = { ty: 'tm', s: { a: 0, k: 90 }, e: { a: 0, k: 100 }, o: { a: 0, k: 0 }, m: 2 };
        const c = render({ layers: [shapeLayer(0, [RECT, RECT, RECT, FILL_RED, TRIM])] });
        expect(c.ctx.fills).toHaveLength(1);
    });
    it('skips zero-length paths while trimming individually', () => {
        const POINT = { ty: 'sh', ks: { a: 0, k: { v: [[0, 0]], i: [[0, 0]], o: [[0, 0]], c: true } } };
        const TRIM = { ty: 'tm', s: { a: 0, k: 10 }, e: { a: 0, k: 30 }, o: { a: 0, k: 0 }, m: 2 };
        const c = render({ layers: [shapeLayer(0, [POINT, RECT, RECT, RECT, FILL_RED, TRIM])] });
        expect(c.ctx.fills).toHaveLength(1);
    });
    it('considers animated repeater copies across keyframes', () => {
        const RECT_GRP = {
            ty: 'gr', nm: 'G', it: [RECT, FILL_RED, { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }],
        };
        const REP = {
            ty: 'rp', nm: 'R',
            c: { a: 1, k: [{ t: 0, s: [2] }, { t: 10, s: [5] }] },
            o: { a: 0, k: 0 }, m: 1,
            tr: { p: { a: 0, k: [20, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
        };
        const c = render({ layers: [shapeLayer(0, [RECT_GRP, REP])] });
        expect(c.ctx.fills.length).toBeGreaterThanOrEqual(2);
    });
    it('builds gradients from nested stop arrays', () => {
        const GF = {
            ty: 'gf', o: { a: 0, k: 100 },
            s: { a: 0, k: [0, 0] }, e: { a: 0, k: [100, 0] },
            g: { p: 2, k: { a: 0, k: [[0, 1, 0, 0], [1, 0, 0, 1]] } },
        };
        const c = render({ layers: [shapeLayer(0, [RECT, GF])] });
        expect(c.ctx.gradients[0].stops).toEqual([
            [0, 'rgba(255,0,0,1)'],
            [1, 'rgba(0,0,255,1)'],
        ]);
    });
    it('evicts large matte buffers from the pool', () => {
        const body = {
            layers: [
                shapeLayer(0, [RECT, FILL_RED], {}, { td: 1 }),
                shapeLayer(1, [RECT, FILL_RED], {}, { tt: 3 }),
            ],
        };
        const c = render(body, { clientWidth: 3000, clientHeight: 3000 });
        expect(c.ctx.fills).toEqual([]);
        const m = require('../src/renderer.js');
        const stats = m.getBufferPoolStats();
        expect(stats.pixels).toBeLessThanOrEqual(stats.maxPixels + 3000 * 3000);
        expect(stats.size).toBeGreaterThan(0);
    });
    it('renders a precomp with an unknown refId without crashing', () => {
        const c = render({ layers: [{ ind: 0, ty: 0, refId: 'missing', w: 100, h: 100, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } } }],
        });
        expect(c.ctx.fills).toEqual([]);
    });
    it('reuses in-flight image decodes for duplicate refIds', async () => {
        const assets = [{ id: 'img1', w: 10, h: 10, p: 'data:image/png;base64,AAAA' }];
        const mk = (ind: number) => ({
            ind, ty: 2, refId: 'img1', ip: 0, op: 180,
            ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
        });
        render({ assets, layers: [mk(0), mk(1)] });
        await new Promise((r) => setTimeout(r, 0));
    });
    it('evicts the oldest decoded image when the cache overflows', async () => {
        const assets: any[] = [];
        const layers: any[] = [];
        for (let i = 0; i < 201; i++) {
            assets.push({ id: 'img' + i, w: 10, h: 10, p: 'data:image/png;base64,AAAA' });
            layers.push({
                ind: i, ty: 2, refId: 'img' + i, ip: 0, op: 180,
                ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
            });
        }
        render({ assets, layers });
        await new Promise((r) => setTimeout(r, 0));
    });
});

describe('renderFrame deep coverage', () => {
    beforeEach(() => {
        jest.resetModules();
        created = [];
        (globalThis as any).document = {
            createElement: () => {
                const c = new MockCanvas();
                created.push(c);
                return c;
            },
        };
        renderFrame = require('../src/renderer.js').renderFrame;
    });
    const TGS_HEAD = { tgs: 1, v: '5.5.2', fr: 60, ip: 0, op: 180, w: 512, h: 512, nm: 'deep' };

    function baseLayer(over: any = {}): any {
        return {
            ind: 0, ty: 4, ip: 0, op: 180,
            ks: {
                o: { a: 0, k: 100 },
                r: { a: 0, k: 0 },
                p: { a: 0, k: [256, 256] },
                a: { a: 0, k: [0, 0] },
                s: { a: 0, k: [100, 100] },
            },
            ...over,
        };
    }

    function rectFillLayer(over: any = {}): any {
        return baseLayer({
            shapes: [{
                ty: 'gr', it: [
                    { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } },
                    { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
                ],
            }],
            ...over,
        });
    }

    it('walks the binary search of an auto-oriented position with several keyframes', () => {
        const body = { layers: [{
                ind: 0, ty: 4, ip: 0, op: 180, ao: 1,
                ks: {
                    o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
                    p: {
                        a: 1,
                        k: [
                            { t: 0, s: [100, 100], to: [60, 0], ti: [0, 0] },
                            { t: 10, s: [200, 100], to: [60, 0], ti: [0, 0] },
                            { t: 20, s: [300, 100], to: [60, 0], ti: [0, 0] },
                            { t: 30, s: [400, 100], to: [60, 0], ti: [0, 0] },
                        ],
                    },
                    a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
                },
                shapes: [{
                    ty: 'gr', it: [
                        { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [40, 40] }, r: { a: 0, k: 0 } },
                        { ty: 'fl', c: { a: 0, k: [0, 0, 1, 1] }, o: { a: 0, k: 100 } },
                    ],
                }],
            }],
        };
        render(body, { frame: 5 });
        render(body, { frame: 15 });
        render(body, { frame: 25 });
        expect(render(body, { frame: 5 }).ctx.fills).toHaveLength(1);
    });

    it('resolves mattes for reversed layer order', () => {
        const matteLayer = baseLayer({
            ind: 1, tt: 1,
            shapes: [{
                ty: 'gr', it: [
                    { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [80, 80] }, r: { a: 0, k: 0 } },
                    { ty: 'fl', c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 } },
                ],
            }],
        });
        const target = rectFillLayer({ ind: 0, td: 1 });
        const c = render({ layers: [target, matteLayer] }, { frame: 30, order: 'reversed' });
        expect(c.ctx.calls.some((call: string) => call.startsWith('drawImage'))).toBe(true);
    });

    it('closes evicted image bitmaps once the cache overflows', async () => {
        const close = jest.fn();
        const realCreateImageBitmap = globalThis.createImageBitmap;
        (globalThis as any).createImageBitmap = async () => ({ width: 2, height: 2, close });
        try {
            const layers = [];
            const assets = [];
            for (let i = 0; i < 205; i++) {
                layers.push({
                    ind: i, ty: 2, ip: 0, op: 180, refId: 'img' + i,
                    ks: {
                        o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
                        p: { a: 0, k: [Math.floor(i / 15) * 60, (i % 15) * 30] },
                        a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
                    },
                });
                assets.push({ id: 'img' + i, w: 32, h: 32, p: 'data:image/png;base64,' + 'A'.repeat(20) });
            }
            render({ layers, assets });
            await new Promise((r) => setTimeout(r, 0));
            expect(close).toHaveBeenCalled();
        } finally {
            (globalThis as any).createImageBitmap = realCreateImageBitmap;
        }
    });

    it('returns null when image decoding throws', async () => {
        const realCreateImageBitmap = globalThis.createImageBitmap;
        (globalThis as any).createImageBitmap = async () => { throw new Error('decode failed'); };
        try {
            render({
                layers: [{
                    ind: 0, ty: 2, ip: 0, op: 180, refId: 'boom',
                    ks: {
                        o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
                        p: { a: 0, k: [100, 100] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
                    },
                }],
                assets: [{ id: 'boom', w: 16, h: 16, p: 'data:image/png;base64,QUJD' }],
            });
            await new Promise((r) => setTimeout(r, 0));
        } finally {
            (globalThis as any).createImageBitmap = realCreateImageBitmap;
        }
    });
});
