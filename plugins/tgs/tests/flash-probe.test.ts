import { parseTgs, renderFrame } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';

class MockGradient {
    stops: Array<[number, string]> = [];
    addColorStop(off: number, color: string) {
        this.stops.push([off, color]);
    }
    toString() { return '[gradient]'; }
}
const allCtxs: MockCtx[] = [];
class MockCtx {
    id: number;
    static next = 1;
    calls: string[] = [];
    pathsAtFill: string[][] = [];
    curPath: string[] = [];
    fills: string[] = [];
    gradients: MockGradient[] = [];
    compositeOps: string[] = [];
    drawImages: string[] = [];
    fillStyle: any = '';
    strokeStyle: any = '';
    lineWidth = 1;
    globalAlpha = 1;
    font = '';
    textAlign = 'start';
    textBaseline = 'alphabetic';
    private _gco = 'source-over';
    constructor() {
        this.id = MockCtx.next++;
        allCtxs.push(this);
    }
    get globalCompositeOperation(): string { return this._gco; }
    set globalCompositeOperation(v: string) {
        if (this._gco !== v) this.compositeOps.push(v);
        this._gco = v;
    }
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
    setTransform(...args: number[]) { this.calls.push('setTransform(' + args.join(',') + ')'); }
    clearRect(...args: number[]) { this.calls.push('clearRect(' + args.join(',') + ')'); }
    save() { /* noop */ }
    restore() { /* noop */ }
    clip() { this.calls.push('clip:' + this.calls[this.calls.length - 1]); }
    beginPath() { this.curPath = []; }
    rect(...args: number[]) { this.calls.push('rect(' + args.join(',') + ')'); this.curPath.push('R' + args.join(',')); }
    moveTo(x: number, y: number) { this.curPath.push('M' + x.toFixed(1) + ',' + y.toFixed(1)); }
    lineTo(x: number, y: number) { this.curPath.push('L' + x.toFixed(1) + ',' + y.toFixed(1)); }
    bezierCurveTo(...pts: number[]) { this.curPath.push('C' + pts.map((n) => n.toFixed(1)).join(',')); }
    closePath() { this.curPath.push('Z'); }
    fill() {
        this.fills.push(String(this.fillStyle));
        this.pathsAtFill.push(this.curPath.slice());
        this.curPath = [];
    }
    stroke() { /* noop */ }
    setLineDash() { /* noop */ }
    drawImage(img: any, x: number, y: number) {
        this.drawImages.push('ctx#' + this.id + ' alpha=' + this.globalAlpha.toFixed(3) + ' @' + x + ',' + y + ' gco=' + this._gco + ' src=' + (img.width + 'x' + img.height));
    }
    createLinearGradient(...args: number[]) {
        const g = new MockGradient();
        this.gradients.push(g);
        this.calls.push('createLinearGradient(' + args.join(',') + ')');
        return g;
    }
    createRadialGradient(...args: number[]) {
        const g = new MockGradient();
        this.gradients.push(g);
        this.calls.push('createRadialGradient(' + args.map((n) => Math.round(n * 10) / 10).join(',') + ')');
        return g;
    }
    getImageData() { return { data: [] as number[] }; }
    putImageData() { /* noop */ }
    fillText() { /* noop */ }
    strokeText() { /* noop */ }
}
class MockCanvas {
    width = 0;
    height = 0;
    clientWidth = 256;
    clientHeight = 256;
    ctx = new MockCtx();
    getContext(type: string): any { return type === '2d' ? this.ctx : null; }
}

let poolCreated = 0;
(globalThis as any).OffscreenCanvas = class {
    width: number;
    height: number;
    ctx: MockCtx;
    constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
        poolCreated++;
        this.ctx = new MockCtx();
    }
    getContext(type: string): any { return type === '2d' ? this.ctx : null; }
};

function pathExtent(cmds: string[]): [number, number] {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const c of cmds) {
        const m = c.match(/^([MLC])((?:-?\d+\.?\d*,){1,6})/);
        if (!m) continue;
        const nums = m[2].split(',').map(Number);
        if (m[1] === 'M' || m[1] === 'L') {
            minX = Math.min(minX, nums[0]);
            maxX = Math.max(maxX, nums[0]);
        } else {
            for (let i = 0; i < nums.length; i += 2) {
                minX = Math.min(minX, nums[i]);
                maxX = Math.max(maxX, nums[i]);
            }
        }
    }
    return [minX, maxX];
}

describe('flash probe', () => {
    beforeEach(() => { allCtxs.length = 0; });

    it('flash overflowing precomp asset bounds (opacity<1)', () => {
        const anim: ParsedAnimation = parseTgs(JSON.stringify({
            tgs: 1, v: '5.5.2', fr: 60, ip: 0, op: 60, w: 256, h: 256, nm: 'st',
            layers: [
                { ddd: 0, ind: 1, ty: 4, nm: 'content', sr: 1,
                    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [64, 128, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
                    shapes: [{ ty: 'gr', it: [
                        { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [80, 80] } },
                        { ty: 'fl', c: { a: 0, k: [0, 0.5, 1, 1] }, o: { a: 0, k: 100 } },
                        { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
                    ] }],
                    ip: 0, op: 60, st: 0, bm: 0,
                },
                { ddd: 0, ind: 2, ty: 0, nm: 'burst-holder', refId: 'burst', sr: 1,
                    ks: { o: { a: 0, k: 60 }, r: { a: 0, k: 0 }, p: { a: 0, k: [192, 128, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [200, 200, 100] } },
                    ip: 0, op: 60, st: 0, bm: 2,
                },
            ],
            assets: [{
                id: 'burst', fr: 60, layers: [{
                    ddd: 0, ind: 1, ty: 4, nm: 'flash', sr: 1,
                    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
                    shapes: [{ ty: 'gr', it: [
                        { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [240, 240] } },
                        { ty: 'gf', o: { a: 0, k: 100 }, t: 2,
                            s: { a: 0, k: [0, 0] }, e: { a: 0, k: [120, 0] },
                            g: { p: 2, k: { a: 0, k: [
                                0, 1, 1, 1, 0.9,
                                1, 1, 0.4, 0.6, 0,
                            ] } } },
                        { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
                    ] }],
                    ip: 0, op: 60, st: 0, bm: 0,
                }],
            }],
        }));
        renderFrame(new MockCanvas() as any, anim, 10, 1);

        let found = false;
        for (const c of allCtxs) {
            c.pathsAtFill.forEach((p, i) => {
                if (!String(c.fills[i]).includes('gradient')) return;
                const [minX, maxX] = pathExtent(p);

                console.log('ctx#' + c.id, 'gradient fill extent x=[' + minX.toFixed(1) + '..' + maxX.toFixed(1) + ']');
                found = true;
            });
        }
        expect(found).toBe(true);
    });
});
