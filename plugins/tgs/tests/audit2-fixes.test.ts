import { parseTgs, inflateTgs } from '@ton-ai/tgs';
import { gzipSync } from 'zlib';

let renderFrame: any;
let created: MockCanvas[] = [];

class MockCtx {
    kinds: string[] = [];
    fills: string[] = [];
    pathsAtFill: string[][] = [];
    fillStyle: any = '';
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
    set lineDashOffset(v: number) { this._off = v; }
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
    setTransform() { }
    clearRect() { }
    save() { }
    restore() { }
    clip() { }
    beginPath() { this.kinds = []; }
    rect() { }
    moveTo() { this.kinds.push('M'); }
    lineTo() { this.kinds.push('L'); }
    bezierCurveTo() { this.kinds.push('C'); }
    closePath() { this.kinds.push('Z'); }
    fill() {
        this.fills.push(String(this.fillStyle));
        this.pathsAtFill.push(this.kinds.slice());
        this.kinds = [];
    }
    stroke() { }
    setLineDash() { }
    drawImage() { }
    createLinearGradient() { return { addColorStop() { } }; }
    createRadialGradient() { return { addColorStop() { } }; }
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

const RECT = { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } };
const FILL_RED = { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } };

function tgs(body: object): string {
    return JSON.stringify({ tgs: 1, v: '5.5.2', fr: 60, ip: 0, op: 180, w: 100, h: 100, nm: 'a2', ...body });
}

function shapeLayer(ind: number, shapes: any[], extraLayer: any = {}): any {
    return {
        ind, ty: 4, ip: 0, op: 180,
        ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
        shapes, ...extraLayer,
    };
}

function render(body: object, frame = 0, order: any = undefined, hidden: any = undefined): MockCanvas {
    const anim = parseTgs(tgs(body));
    const canvas = new MockCanvas();
    renderFrame(canvas, anim, frame, 1, undefined, undefined, order ?? 'default', hidden);
    return canvas;
}

function trim(s: number, e: number, o: number, m: number): any {
    return { ty: 'tm', s: { a: 0, k: s }, e: { a: 0, k: e }, o: { a: 0, k: o }, m };
}

describe('audit2: trim path modes (m:1 simultaneous vs m:2 individually)', () => {
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
    afterAll(() => { delete (globalThis as any).document; });

    test('simultaneous 0-50% spans the combined length: first path full, second empty', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, RECT, FILL_RED, trim(0, 50, 0, 1)])] });
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
        expect(c.ctx.pathsAtFill[0]).toEqual(['M', 'C', 'C', 'C', 'C', 'Z']);
    });

    test('individually 0-50% trims each path on its own length: two half subpaths', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, RECT, FILL_RED, trim(0, 50, 0, 2)])] });
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
        const path = c.ctx.pathsAtFill[0];
        expect(path.filter((k) => k === 'M')).toHaveLength(2);
        expect(path).toHaveLength(6);
    });

    test('simultaneous 0-25% covers half of the first path only', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, RECT, FILL_RED, trim(0, 25, 0, 1)])] });
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
        const path = c.ctx.pathsAtFill[0];
        expect(path.filter((k) => k === 'M')).toHaveLength(1);
        expect(path).toHaveLength(3);
    });

    test('wrapped simultaneous trim still produces stitched pieces', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, RECT, FILL_RED, trim(95, 40, 30, 1)])] });
        expect(c.ctx.fills).toEqual(['rgba(255,0,0,1)']);
        const path = c.ctx.pathsAtFill[0];
        expect(path.filter((k) => k === 'M').length).toBeGreaterThanOrEqual(2);
    });

    test('zero-length simultaneous trim renders nothing', () => {
        const c = render({ layers: [shapeLayer(0, [RECT, RECT, FILL_RED, trim(50, 50, 0, 1)])] });
        expect(c.ctx.fills).toEqual([]);
    });
});

describe('audit2: hiddenLayers applies to matte consumers', () => {
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
    afterAll(() => { delete (globalThis as any).document; });

    function matteBody(): any {
        return {
            layers: [
                shapeLayer(0, [RECT, FILL_RED], { td: 1, nm: 'src' }),
                shapeLayer(1, [RECT, FILL_RED], { tt: 1, nm: 'consumer' }),
            ],
        };
    }

    test('unhidden pair composites through matte buffers', () => {
        const c = render(matteBody());
        expect(c.ctx.fills).toEqual([]);
        expect(created.some((cv) => cv.ctx.fills.length > 0)).toBe(true);
    });

    test('hidden consumer is not rendered (default order)', () => {
        const c = render(matteBody(), 0, 'default', (n?: string) => n === 'consumer');
        expect(c.ctx.fills).toEqual([]);
        expect(created.some((cv) => cv.ctx.fills.length > 0)).toBe(false);
    });

    test('hidden consumer is not rendered (reversed order)', () => {
        const c = render(matteBody(), 0, 'reversed', (n?: string) => n === 'consumer');
        expect(c.ctx.fills).toEqual([]);
        expect(created.some((cv) => cv.ctx.fills.length > 0)).toBe(false);
    });

    test('hidden source still suppresses the pair (unchanged behavior)', () => {
        const c = render(matteBody(), 0, 'default', (n?: string) => n === 'src');
        expect(c.ctx.fills).toEqual([]);
        expect(created.some((cv) => cv.ctx.fills.length > 0)).toBe(false);
    });
});

describe('audit2: inflateTgs size limit leaves no dangling promise', () => {
    test('oversized payload rejects with the size-limit error', async () => {
        const big = 'a'.repeat(17 * 1024 * 1024);
        const gz = gzipSync(Buffer.from(big));
        await expect(inflateTgs(new Uint8Array(gz))).rejects.toThrow('TGS payload exceeds size limit');
    }, 30000);
});

describe('audit2: marker timing guards', () => {
    test('missing dr keeps endFrame equal to startFrame instead of NaN', () => {
        const anim = parseTgs(tgs({ layers: [], markers: [{ cm: 'm1', tm: 10 } as any] }));
        expect(anim.markers![0]).toEqual({ name: 'm1', startFrame: 10, endFrame: 10 });
    });

    test('non-finite tm falls back to 0', () => {
        const anim = parseTgs(tgs({ layers: [], markers: [{ cm: 'm2', tm: null, dr: 5 } as any] }));
        expect(anim.markers![0]).toEqual({ name: 'm2', startFrame: 0, endFrame: 5 });
    });

    test('well-formed markers keep tm and tm+dr', () => {
        const anim = parseTgs(tgs({ layers: [], markers: [{ cm: 'm3', tm: 20, dr: 10 }] }));
        expect(anim.markers![0]).toEqual({ name: 'm3', startFrame: 20, endFrame: 30 });
    });
});
