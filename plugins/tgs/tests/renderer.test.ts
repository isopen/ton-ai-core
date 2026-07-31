import { parseTgs } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';

let renderFrame: (canvas: any, anim: ParsedAnimation, frame: number, dpr: number) => void;
let created: MockCanvas[] = [];

class MockGradient {
    stops: Array<[number, string]> = [];

    addColorStop(off: number, color: string) {
        this.stops.push([off, color]);
    }

    toString() {
        return '[gradient]';
    }
}

class MockCtx {
    calls: string[] = [];
    path: string[] = [];
    pathsAtFill: string[][] = [];
    fills: string[] = [];
    strokes: string[] = [];
    dashes: number[][] = [];
    gradients: MockGradient[] = [];
    fillStyle: any = '';
    strokeStyle: any = '';
    lineWidth = 1;
    lineCap: any = 'butt';
    lineJoin: any = 'miter';
    miterLimit = 10;
    globalAlpha = 1;
    compositeOps: string[] = [];
    private _gco = 'source-over';

    get globalCompositeOperation(): string {
        return this._gco;
    }

    set globalCompositeOperation(v: string) {
        this._gco = v;
        this.compositeOps.push(v);
    }

    private r(n: number): number {
        return Math.round(n * 1000) / 1000;
    }

    private numList(args: number[]): string {
        return args.map(this.r).join(',');
    }

    setTransform(...args: number[]) {
        this.calls.push('setTransform(' + this.numList(args) + ')');
    }

    clearRect(...args: number[]) {
        this.calls.push('clearRect(' + this.numList(args) + ')');
    }

    save() { this.calls.push('save'); }

    restore() { this.calls.push('restore'); }

    clip() { this.calls.push('clip'); }

    beginPath() {
        this.calls.push('beginPath');
        this.path = [];
    }

    rect(...args: number[]) {
        this.calls.push('rect(' + this.numList(args) + ')');
    }

    moveTo(x: number, y: number) {
        this.path.push('M' + this.r(x) + ',' + this.r(y));
    }

    lineTo(x: number, y: number) {
        this.path.push('L' + this.r(x) + ',' + this.r(y));
    }

    bezierCurveTo(...pts: number[]) {
        this.path.push('C' + this.numList(pts));
    }

    closePath() {
        this.path.push('Z');
    }

    fill(rule?: string) {
        this.fills.push(String(this.fillStyle));
        this.pathsAtFill.push(this.path.slice());
        this.path = [];
    }

    stroke() {
        this.strokes.push(String(this.strokeStyle));
        this.path = [];
    }

    setLineDash(d: number[]) {
        this.dashes.push(d.slice());
    }

    drawImage(img: any, x: number, y: number) {
        this.calls.push('drawImage(' + x + ',' + y + ')');
    }

    createLinearGradient(...args: number[]) {
        const g = new MockGradient();
        this.gradients.push(g);
        this.calls.push('createLinearGradient(' + this.numList(args) + ')');
        return g;
    }

    createRadialGradient(...args: number[]) {
        const g = new MockGradient();
        this.gradients.push(g);
        this.calls.push('createRadialGradient(' + this.numList(args) + ')');
        return g;
    }

    getImageData() {
        return { data: [] as number[] };
    }

    putImageData() { /* noop */ }
}

class MockCanvas {
    width = 0;
    height = 0;
    clientWidth = 0;
    clientHeight = 0;
    ctx = new MockCtx();

    getContext(type: string): any {
        return type === '2d' ? this.ctx : null;
    }
}

function tgs(body: object): string {
    return JSON.stringify({
        tgs: 1,
        v: '5.5.2',
        fr: 60,
        ip: 0,
        op: 180,
        w: 100,
        h: 100,
        nm: 'test',
        ...body,
    });
}

const RECT = { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } };
const FILL_RED = { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } };
const FILL_BLUE = { ty: 'fl', c: { a: 0, k: [0, 0, 1, 1] }, o: { a: 0, k: 100 } };
const STROKE_GREEN = {
    ty: 'st',
    c: { a: 0, k: [0, 1, 0, 1] },
    o: { a: 0, k: 100 },
    w: { a: 0, k: 5 },
    lc: 2,
    lj: 2,
    d: [
        { n: 'd', v: { a: 0, k: 4 } },
        { n: 'g', v: { a: 0, k: 2 } },
    ],
};

function shapeLayer(ind: number, shapes: any[], ks: any = {}, layer: any = {}): any {
    return {
        ind,
        ty: 4,
        ip: 0,
        op: 180,
        ks: {
            o: { a: 0, k: 100 },
            r: { a: 0, k: 0 },
            p: { a: 0, k: [0, 0] },
            a: { a: 0, k: [0, 0] },
            s: { a: 0, k: [100, 100] },
            ...ks,
        },
        shapes: shapes,
        ...layer,
    };
}
function render(body: object, opts: { clientWidth?: number; clientHeight?: number; dpr?: number; frame?: number } = {}): MockCanvas {
    const anim = parseTgs(tgs(body));
    const canvas = new MockCanvas();
    canvas.clientWidth = opts.clientWidth ?? 100;
    canvas.clientHeight = opts.clientHeight ?? 100;
    renderFrame(canvas, anim, opts.frame ?? 0, opts.dpr ?? 1);
    return canvas;
}

describe('renderFrame', () => {
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
        const m = require('../src/renderer.js');
        renderFrame = m.renderFrame;
    });

    afterAll(() => {
        delete (globalThis as any).document;
    });

    it('sizes the canvas from client size and dpr', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED])] }, { clientWidth: 200, clientHeight: 200, dpr: 2 });
        expect(c.width).toBe(400);
        expect(c.height).toBe(400);
    });

    it('falls back to the animation size when the canvas has no client size', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED])] }, { clientWidth: 0, clientHeight: 0, dpr: 1 });
        expect(c.width).toBe(100);
        expect(c.height).toBe(100);
    });

    it('resets the transform and clears the canvas before drawing', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED])] });
        expect(c.ctx.calls[0]).toBe('setTransform(1,0,0,1,0,0)');
        expect(c.ctx.calls).toContain('clearRect(0,0,100,100)');
    });

    it('renders a filled rect with the expected path', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED])] });
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
        const path = c.ctx.pathsAtFill[0];
        expect(path[0]).toBe('M50,-50');
        expect(path).toHaveLength(6);
        expect(path[path.length - 1]).toBe('Z');
    });

    it('renders an ellipse as four bezier segments', () => {
        const ELLIPSE = { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 60] } };
        const c = render({ layers: [shapeLayer(0, [ELLIPSE, FILL_RED])] });
        const path = c.ctx.pathsAtFill[0];
        expect(path[0]).toBe('M0,-30');
        expect(path.filter(p => p.startsWith('C'))).toHaveLength(4);
    });

    it('applies the layer position transform to path points', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED], { p: { a: 0, k: [10, 20] } })] });
        expect(c.ctx.pathsAtFill[0][0]).toBe('M60,-30');
    });

    it('applies the layer scale transform to path points', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED], { s: { a: 0, k: [200, 100] } })] });
        expect(c.ctx.pathsAtFill[0][0]).toBe('M100,-50');
    });

    it('applies the layer rotation transform to path points', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED], { r: { a: 0, k: 90 } })] });
        expect(c.ctx.pathsAtFill[0][0]).toBe('M50,50');
    });

    it('applies parent layer transforms', () => {
        const c = render({
            layers: [
                { ind: 0, ty: 3, ks: { p: { a: 0, k: [50, 50] } } },
                shapeLayer(1, [RECT, FILL_RED], {}, { parent: 0 }),
            ],
        });
        expect(c.ctx.pathsAtFill[0][0]).toBe('M100,0');
    });

    it('applies the composition matrix when the canvas is larger than the animation', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED])] }, { clientWidth: 200, clientHeight: 200, dpr: 1 });
        expect(c.ctx.pathsAtFill[0][0]).toBe('M100,-100');
    });

    it('skips layers outside their in/out frame range', () => {
        const layer = shapeLayer(0, [RECT, FILL_RED], {}, { ip: 10, op: 30 });
        const outside = render({ layers: [layer] }, { frame: 5 });
        expect(outside.ctx.fills).toEqual([]);
        const inside = render({ layers: [layer] }, { frame: 20 });
        expect(inside.ctx.fills).toEqual(['rgba(255,0,0,1)']);
    });

    it('skips layers with zero opacity', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED], { o: { a: 0, k: 0 } })] });
        expect(c.ctx.fills).toEqual([]);
    });

    it('renders layers with partial opacity through an offscreen buffer', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED], { o: { a: 0, k: 50 } })] });
        expect(created).toHaveLength(1);
        expect(created[0].ctx.fills).toEqual(['rgba(255,0,0,1)']);
        expect(c.ctx.fills).toEqual([]);
        expect(c.ctx.calls).toContain('drawImage(0,0)');
        expect(c.ctx.globalAlpha).toBe(0.5);
    });

    it('renders solid layers', () => {
        const c = render({ layers: [{ ind: 0, ty: 1, sc: '#FF0000', sw: 100, sh: 100, ks: {} }] });
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
        expect(c.ctx.pathsAtFill[0]).toEqual(['M100,0', 'L100,100', 'L0,100', 'L0,0', 'Z']);
    });

    it('renders strokes with width, caps, joins and dashes', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, STROKE_GREEN])] });
        expect(c.ctx.strokes).toEqual(['rgba(0,255,0,1)']);
        expect(c.ctx.lineWidth).toBeCloseTo(5, 4);
        expect(c.ctx.lineCap).toBe('round');
        expect(c.ctx.lineJoin).toBe('round');
        expect(c.ctx.dashes[0][0]).toBeCloseTo(4, 4);
        expect(c.ctx.dashes[0][1]).toBeCloseTo(2, 4);
    });

    it('draws paints in reverse order (later paints first)', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED, FILL_BLUE])] });
        expect(c.ctx.fills).toEqual(['rgba(0,0,255,1)', 'rgba(255,0,0,1)']);
    });

    it('applies trim path start/end', () => {
        const TRIM = { ty: 'tm', s: { a: 0, k: 0 }, e: { a: 0, k: 50 }, o: { a: 0, k: 0 }, m: 1 };
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED, TRIM])] });
        expect(c.ctx.fills).toHaveLength(1);
        expect(c.ctx.pathsAtFill[0].length).toBeLessThan(6);
    });

    it('drops the path when trim start equals end', () => {
        const TRIM = { ty: 'tm', s: { a: 0, k: 50 }, e: { a: 0, k: 50 }, o: { a: 0, k: 0 }, m: 1 };
        const c = render({ layers: [shapeLayer(0, [RECT, FILL_RED, TRIM])] });
        expect(c.ctx.fills).toEqual([]);
    });

    it('renders linear gradient fills', () => {
        const GF = {
            ty: 'gf',
            g: { p: 4, k: { a: 0, k: [0, 1, 0, 0, 1, 1, 0, 0] } },
            s: { a: 0, k: [0, 0] },
            e: { a: 0, k: [100, 0] },
            o: { a: 0, k: 100 },
            t: 1,
        };
        const c = render({ layers: [shapeLayer(0, [RECT, GF])] });
        expect(c.ctx.fills).toEqual(['[gradient]']);
        expect(c.ctx.gradients[0].stops).toEqual([
            [0, 'rgba(255,0,0,1)'],
            [1, 'rgba(255,0,0,1)'],
        ]);
        expect(c.ctx.calls).toContain('createLinearGradient(0,0,100,0)');
    });

    it('renders radial gradient fills', () => {
        const GF = {
            ty: 'gf',
            g: { p: 4, k: { a: 0, k: [0, 1, 0, 0, 1, 1, 0, 0] } },
            s: { a: 0, k: [0, 0] },
            e: { a: 0, k: [100, 100] },
            o: { a: 0, k: 100 },
            t: 2,
        };
        const c = render({ layers: [shapeLayer(0, [RECT, GF])] });
        expect(c.ctx.calls).toContain('createRadialGradient(0,0,0,100,100,141.421)');
    });

    it('renders precomp children inline when there is a single child', () => {
        const c = render({
            assets: [{ id: 'p1', w: 100, h: 100, layers: [shapeLayer(0, [RECT, FILL_RED])] }],
            layers: [{ ind: 0, ty: 0, refId: 'p1', w: 100, h: 100, ks: {} }],
        });
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
        expect(c.ctx.calls).toContain('clip');
        expect(created).toHaveLength(0);
    });

    it('renders precomps with multiple children and partial opacity through a buffer', () => {
        const c = render({
            assets: [{
                id: 'p1',
                w: 100,
                h: 100,
                layers: [shapeLayer(0, [RECT, FILL_RED]), shapeLayer(1, [RECT, FILL_RED])],
            }],
            layers: [{ ind: 0, ty: 0, refId: 'p1', w: 100, h: 100, ks: { o: { a: 0, k: 50 } } }],
        });
        expect(created).toHaveLength(1);
        expect(created[0].ctx.fills.length).toBeGreaterThan(0);
        expect(c.ctx.fills).toEqual([]);
        expect(c.ctx.calls).toContain('drawImage(0,0)');
        expect(c.ctx.globalAlpha).toBe(0.5);
    });

    it('renders alpha matte pairs into buffers with destination-in compositing', () => {
        const c = render({
            layers: [
                shapeLayer(0, [RECT, FILL_RED], {}, { td: 1 }),
                shapeLayer(1, [RECT, FILL_RED], {}, { tt: 1 }),
            ],
        });
        expect(created.length).toBeGreaterThanOrEqual(2);
        expect(c.ctx.fills).toEqual([]);
        expect(c.ctx.calls).toContain('drawImage(0,0)');
        const matteCtx = created.find(cv => cv.ctx.compositeOps.includes('destination-in'));
        expect(matteCtx).toBeDefined();
    });
});
