import { parseTgs, renderFrame } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';
import * as fs from 'fs';
import * as path from 'path';
import { gunzipSync } from 'zlib';
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
    globalCompositeOperation = 'source-over';
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
    putImageData() { }
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
function serialize(c: MockCanvas): string {
    const ctx = c.ctx;
    return JSON.stringify({
        calls: ctx.calls,
        fills: ctx.fills,
        strokes: ctx.strokes,
        textFills: ctx.textFills,
        textStrokes: ctx.textStrokes,
        gradients: ctx.gradients.map((g) => g.stops),
        lineWidth: ctx.lineWidth,
        globalAlpha: ctx.globalAlpha,
    });
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
describe('real Telegram TGS files', () => {
    const extra = () => {
        const tl2 = '/tmp/opencode/telegram-tt/src/lib/gramjs/client/__data__/TestLottie2.tgs';
        const tl3 = '/tmp/opencode/telegram-tt/src/lib/gramjs/client/__data__/TestLottie3.tgs';
        const out = [];
        if (fs.existsSync(tl2)) out.push(tl2);
        if (fs.existsSync(tl3)) out.push(tl3);
        return out;
    };
    for (const f of ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', ...extra()]) {
        it('probe ' + path.basename(f), async () => {
            const file = f.startsWith('/') ? f : path.join(__dirname, '../../../harness/static/tgs', f + '.tgs');
            const buf = fs.readFileSync(file);
            const json = (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b)
                ? gunzipSync(buf).toString('utf8')
                : new TextDecoder().decode(buf);
            const p = JSON.parse(json);
            let anim: ParsedAnimation;
            try { anim = parseTgs(json); }
            catch (err: any) {
                console.log('[probe-real]', f, 'PARSE FAIL:', err?.message);
                return;
            }
            const span = anim.outFrame - anim.inFrame;
            const reduceFactor = anim.fps % 60 === 0 ? anim.fps / 60 : 1;
            const framesCount = Math.max(1, Math.ceil(span / reduceFactor));
            const animatedProps = countAnimatedProps((anim as any).layers);
            const topLayers = (anim as any).layers.map((l: any) => {
                const shapes = (l.shapes || []).length;
                const animShapes = (l.shapes || []).reduce((n: number, s: any) => n + countAnimatedProps([s]), 0);
                return { ty: l.type, w: l.layerWidth, h: l.layerHeight, parent: l.parentIndex, shapes, animShapes, refId: l.refId };
            });
            let diffs = 0;
            const canvas = new MockCanvas();
            canvas.clientWidth = anim.width;
            canvas.clientHeight = anim.height;
            const prevs: string[] = [];
            for (let i = 0; i < framesCount; i++) {
                const c = new MockCanvas();
                c.clientWidth = anim.width;
                c.clientHeight = anim.height;
                try {
                    renderFrame(c, anim, anim.inFrame + i * reduceFactor, 1);
                } catch (err: any) {
                    console.log('[probe-real]', f, 'RENDER THROW at frame', i, ':', (err as Error).message?.slice(0, 200));
                    return;
                }
                const sig = serialize(c);
                if (prevs.length && sig !== prevs[prevs.length - 1]) diffs++;
                prevs.push(sig);
                if (i > 120) break;
            }
            console.log('[probe-real]', f, 'ip=' + anim.inFrame, 'op=' + anim.outFrame, 'fr=' + anim.fps, 'span=' + span, 'frames=' + framesCount, 'animProps=' + animatedProps, 'diffs=' + diffs, 'root=' + JSON.stringify({ w: anim.width, h: anim.height, tgs: anim.tgs }), 'layers=' + JSON.stringify(topLayers.slice(0, 8)));
            expect(diffs).toBeGreaterThan(0);
        });
    }
});
