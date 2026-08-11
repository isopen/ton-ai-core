import { parseTgs } from '@ton-ai/tgs';
import type { ParsedAnimation, ParsedProperty } from '@ton-ai/tgs';
import * as fs from 'fs';
import * as path from 'path';
let renderFrame: (canvas: any, anim: ParsedAnimation, frame: number, dpr: number, w?: number, h?: number) => void;
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
    gradients: MockGradient[] = [];
    textFills: Array<{ text: string; x: number; y: number }> = [];
    textStrokes: Array<{ text: string; x: number; y: number }> = [];
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
    compositeOps: string[] = [];
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
    fill(rule?: string) { this.fills.push(String(this.fillStyle)); this.pathsAtFill.push(this.path.slice()); this.path = []; }
    stroke() { this.strokes.push(String(this.strokeStyle)); this.path = []; }
    setLineDash(d: number[]) { this.calls.push('setLineDash(' + d.join(',') + ')'); }
    drawImage(img: any, x: number, y: number) { this.calls.push('drawImage(' + x + ',' + y + ')'); }
    createLinearGradient(...args: number[]) { const g = new MockGradient(); this.gradients.push(g); this.calls.push('createLinearGradient(' + this.numList(args) + ')'); return g; }
    createRadialGradient(...args: number[]) { const g = new MockGradient(); this.gradients.push(g); this.calls.push('createRadialGradient(' + this.numList(args) + ')'); return g; }
    getImageData() { return { data: [] as number[] }; }
    putImageData() { /* noop */ }
    fillText(text: string, x: number, y: number) { this.textFills.push({ text, x, y }); }
    strokeText(text: string, x: number, y: number) { this.textStrokes.push({ text, x, y }); }
}
class MockCanvas {
    width = 0;
    height = 0;
    clientWidth = 0;
    clientHeight = 0;
    ctx = new MockCtx();
    getContext(type: string): any { return type === '2d' ? this.ctx : null; }
}
beforeAll(() => {
    (global as any).OffscreenCanvas = class {
        width: number;
        height: number;
        ctx: MockCtx;
        constructor(w: number, h: number) { this.width = w; this.height = h; this.ctx = new MockCtx(); }
        getContext(type: string): any { return type === '2d' ? this.ctx : null; }
    };
});
function serialize(c: MockCanvas): string {
    const ctx = c.ctx;
    return JSON.stringify({
        calls: ctx.calls,
        fills: ctx.fills,
        pathsAtFill: ctx.pathsAtFill,
        strokes: ctx.strokes,
        textFills: ctx.textFills,
        textStrokes: ctx.textStrokes,
        gradients: ctx.gradients.map((g) => g.stops),
        compositeOps: ctx.compositeOps,
        lineWidth: ctx.lineWidth,
        globalAlpha: ctx.globalAlpha,
        font: ctx.font,
        textAlign: ctx.textAlign,
    });
}
function countAnimatedProps(layers: any[]): number {
    let n = 0;
    const walk = (v: any) => {
        if (!v || typeof v !== 'object') return;
        if (Array.isArray(v)) { for (const x of v) walk(x); return; }
        if (v.animated === true) n++;
        for (const k of Object.keys(v)) walk(v[k]);
    };
    walk(layers);
    return n;
}
const FIXTURES = [
    path.join(__dirname, 'fixtures', 'emoji_wink.json'),
    path.join(__dirname, 'fixtures', 'emoji_shock.json'),
];
describe('real emoji fixtures animate', () => {
    beforeEach(() => {
        jest.resetModules();
        const mod = require('@ton-ai/tgs');
        renderFrame = mod.renderFrame;
    });
    for (const f of FIXTURES) {
        it('paints changing frames: ' + path.basename(f), () => {
            const json = fs.readFileSync(f, 'utf8');
            const anim = parseTgs(json);
            const span = anim.outFrame - anim.inFrame;
            const canvas = new MockCanvas();
            canvas.clientWidth = anim.width;
            canvas.clientHeight = anim.height;
            const samples: Array<{ frame: number; sig: string }> = [];
            const frames = [anim.inFrame, anim.inFrame + span / 4, anim.inFrame + span / 2, anim.inFrame + (3 * span) / 4, Math.max(anim.inFrame, anim.outFrame - 1)];
            for (const fr of frames) {
                const c = new MockCanvas();
                c.clientWidth = anim.width;
                c.clientHeight = anim.height;
                renderFrame(c, anim, fr, 1);
                samples.push({ frame: fr, sig: serialize(c) });
            }
            const animatedProps = countAnimatedProps((anim as any).layers);
            const diffCount = samples.slice(1).filter((s, i) => s.sig !== samples[i].sig).length;
            console.log('[probe]', path.basename(f), 'span=', span, 'fps=', anim.fps, 'animatedProps=', animatedProps, 'differingAdjacentSamples=', diffCount);
            expect(diffCount).toBeGreaterThan(0);
        });
    }
});
