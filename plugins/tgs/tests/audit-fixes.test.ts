import { parseTgs, interpolateKeyframes, CubicBezier } from '@ton-ai/tgs';
import type { ParsedAnimation, ParsedProperty } from '@ton-ai/tgs';

function tgs(body: object): string {
    return JSON.stringify({
        tgs: 1, v: '5.5.2', fr: 60, ip: 0, op: 180, w: 100, h: 100, nm: 'test',
        ...body,
    });
}

describe('T1: split-dimension position keeps base components', () => {
    const body = JSON.stringify({
        tgs: 1, fr: 60, ip: 0, op: 60, w: 100, h: 100,
        layers: [{
            ind: 0, ty: 4, ip: 0, op: 60,
            ks: {
                o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
                p: {
                    k: [100, 50], s: true,
                    x: { a: 1, k: [{ t: 0, s: [0] }, { t: 60, s: [200] }] },
                },
            },
            shapes: [],
        }],
    });
    const anim: ParsedAnimation = parseTgs(body);
    const pos: ParsedProperty = anim.layers[0].transform.position;

    test('y from the static base survives when only x is animated', () => {
        expect(interpolateKeyframes(pos, 30)).toEqual([100, 50]);
        expect(interpolateKeyframes(pos, 0)).toEqual([0, 50]);
        expect(interpolateKeyframes(pos, 60)).toEqual([200, 50]);
    });

    test('z component is preserved', () => {
        const body3d = JSON.stringify({
            tgs: 1, fr: 60, ip: 0, op: 60, w: 100, h: 100,
            layers: [{
                ind: 0, ty: 4, ip: 0, op: 60,
                ks: {
                    o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
                    p: {
                        k: [100, 50, 7], s: true,
                        x: { a: 1, k: [{ t: 0, s: [0] }, { t: 60, s: [200] }] },
                    },
                },
                shapes: [],
            }],
        });
        const p3 = parseTgs(body3d).layers[0].transform.position;
        expect(interpolateKeyframes(p3, 30)).toEqual([100, 50, 7]);
    });

    test('both x and y animated still override both axes', () => {
        const body2 = JSON.stringify({
            tgs: 1, fr: 60, ip: 0, op: 60, w: 100, h: 100,
            layers: [{
                ind: 0, ty: 4, ip: 0, op: 60,
                ks: {
                    o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
                    p: {
                        k: [100, 50], s: true,
                        x: { a: 1, k: [{ t: 0, s: [10] }, { t: 60, s: [20] }] },
                        y: { a: 1, k: [{ t: 0, s: [30] }, { t: 60, s: [40] }] },
                    },
                },
                shapes: [],
            }],
        });
        const p2 = parseTgs(body2).layers[0].transform.position;
        expect(interpolateKeyframes(p2, 30)).toEqual([15, 35]);
    });
});

describe('T3: easing control xs are clamped to [0,1]', () => {
    test('wild xs produce bounded output on the whole domain', () => {
        // x1=5 / x2=-3 previously extrapolated values outside [0,1].
        const cb = new CubicBezier(5, 0.1, -3, 0.9);
        for (let i = 0; i <= 10; i++) {
            const v = cb.value(i / 10);
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(-1e-9);
            expect(v).toBeLessThanOrEqual(1 + 1e-9);
        }
    });

    test('endpoints stay exact after clamping', () => {
        const cb = new CubicBezier(0.42, 0, 0.58, 1);
        expect(cb.value(0)).toBe(0);
        expect(cb.value(1)).toBe(1);
    });
});

describe('T2: wrapped individually-trim renders instead of freezing', () => {
    class MiniCtx {
        path: string[] = [];
        pathsAtFill: string[][] = [];
        fills: string[] = [];
        fillStyle: any = '';
        lineWidth = 1;
        globalAlpha = 1;
        lineCap: any = 'butt';
        lineJoin: any = 'miter';
        miterLimit = 10;
        private r(n: number) { return Math.round(n * 1000) / 1000; }
        setTransform(...a: number[]) { void a; }
        clearRect(...a: number[]) { void a; }
        save() {} restore() {}
        clip() {}
        rect(...a: number[]) { void a; }
        beginPath() { this.path = []; }
        moveTo(x: number, y: number) { this.path.push('M' + this.r(x) + ',' + this.r(y)); }
        lineTo(x: number, y: number) { this.path.push('L' + this.r(x) + ',' + this.r(y)); }
        bezierCurveTo(...pts: number[]) { this.path.push('C' + pts.map(this.r).join(',')); }
        closePath() { this.path.push('Z'); }
        fill(rule?: string) {
            void rule;
            this.fills.push(String(this.fillStyle));
            this.pathsAtFill.push(this.path.slice());
        }
        stroke() {}
    }
    const canvas: any = {
        width: 0, height: 0, clientWidth: 100, clientHeight: 100,
        getContext: () => new MiniCtx(),
    };

    function buildLayer(trimShape: any): any {
        return JSON.stringify({
            tgs: 1, fr: 60, ip: 0, op: 180, w: 100, h: 100,
            layers: [{
                ind: 0, ty: 4, ip: 0, op: 180,
                ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
                shapes: [
                    { ty: 'rc', p: { a: 0, k: [50, 50] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } },
                    trimShape,
                    { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
                ],
            }],
        });
    }

    const FULL_RECT_CMDS = 6; // M + 4 C (incl. closing edge) + Z

    function renderTrim(trimShape: any, frame: number): MiniCtx {
        const anim = parseTgs(buildLayer(trimShape));
        const ctx = new MiniCtx();
        const mod = require('../src/renderer.js');
        canvas.getContext = () => ctx as any;
        mod.renderFrame(canvas as any, anim as any, frame, 1, undefined, undefined, 'default');
        return ctx;
    }

    test('full range keeps a single closed contour', () => {
        const trim = { ty: 'tm', s: { a: 0, k: 0 }, e: { a: 0, k: 100 }, o: { a: 0, k: 0 }, m: 2 };
        const ctx = renderTrim(trim, 0);
        expect(ctx.fills.length).toBe(1);
        expect(ctx.pathsAtFill[0].length).toBe(FULL_RECT_CMDS);
        expect(ctx.pathsAtFill[0].filter((c) => c.startsWith('M')).length).toBe(1);
    });

    test('wrapped range (start>end via offset) produces stitched pieces', () => {
        // start 95%, end 40%, offset 30° -> normalized [.4833, .0333] descending
        const trim = { ty: 'tm', s: { a: 0, k: 95 }, e: { a: 0, k: 40 }, o: { a: 0, k: 30 }, m: 2 };
        const ctx = renderTrim(trim, 10);
        expect(ctx.fills.length).toBe(1);
        const path = ctx.pathsAtFill[0];
        // Seam split: at least two sub-path starts instead of the single
        // closed rectangle contour.
        const ms = path.filter((c) => c.startsWith('M')).length;
        expect(ms).toBeGreaterThanOrEqual(2);
    });
});
