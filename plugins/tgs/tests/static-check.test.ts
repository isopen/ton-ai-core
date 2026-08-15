import { parseTgs, hasAnimatedProperties } from '@ton-ai/tgs';

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

const staticKs = {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: { a: 0, k: [256, 256, 0] },
    a: { a: 0, k: [0, 0, 0] },
    s: { a: 0, k: [100, 100, 100] },
};

function animatedKs(propName: string, val: any, end: any, frame: number) {
    return {
        ...staticKs,
        [propName]: {
            a: 1,
            k: [
                { t: 0, s: val, e: end, i: { x: [0.2], y: [0.2] }, o: { x: [0.8], y: [0.8] } },
                { t: frame, s: end },
            ],
        },
    };
}

describe('hasAnimatedProperties', () => {
    it('is false for a fully static composition', () => {
        const anim = parseTgs(tgs({
            layers: [
                {
                    ind: 0, ty: 4, ip: 0, op: 180, ks: staticKs,
                    shapes: [
                        {
                            ty: 'gr', it: [
                                { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } },
                                { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
                            ],
                        },
                    ],
                },
            ],
        }));
        expect(hasAnimatedProperties(anim)).toBe(false);
    });

    it('is false for an empty composition', () => {
        expect(hasAnimatedProperties(parseTgs(tgs({ layers: [] })))).toBe(false);
    });

    it('is true when a transform property has keyframes', () => {
        const anim = parseTgs(tgs({
            layers: [
                { ind: 0, ty: 4, ip: 0, op: 180, ks: animatedKs('p', [256, 256, 0], [100, 100, 0], 180) },
            ],
        }));
        expect(hasAnimatedProperties(anim)).toBe(true);
    });

    it('is true when a shape property is animated', () => {
        const anim = parseTgs(tgs({
            layers: [
                {
                    ind: 0, ty: 4, ip: 0, op: 180, ks: staticKs,
                    shapes: [
                        {
                            ty: 'gr', it: [
                                { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } },
                                {
                                    ty: 'fl',
                                    c: {
                                        a: 1,
                                        k: [
                                            { t: 0, s: [1, 0, 0, 1], e: [0, 1, 0, 1], i: { x: [0.2], y: [0.2] }, o: { x: [0.8], y: [0.8] } },
                                            { t: 180, s: [0, 1, 0, 1] },
                                        ],
                                    },
                                    o: { a: 0, k: 100 },
                                },
                            ],
                        },
                    ],
                },
            ],
        }));
        expect(hasAnimatedProperties(anim)).toBe(true);
    });

    it('is true for an animated timeRemap', () => {
        const anim = parseTgs(tgs({
            layers: [
                { ind: 0, ty: 4, ip: 0, op: 180, ks: staticKs, tm: { a: 1, k: [{ t: 0, s: 0 }, { t: 180, s: 60 }] } },
            ],
        }));
        expect(hasAnimatedProperties(anim)).toBe(true);
    });

    it('is true for text keyframes', () => {
        const anim = parseTgs(tgs({
            layers: [
                {
                    ind: 0, ty: 5, ip: 0, op: 180, ks: staticKs,
                    t: { d: { k: [{ t: 0, s: { t: 'Hello' } }, { t: 90, s: { t: 'World' } }] } },
                },
            ],
        }));
        expect(hasAnimatedProperties(anim)).toBe(true);
    });

    it('is true for animation inside a precomposed asset layer', () => {
        const anim = parseTgs(tgs({
            assets: [
                {
                    id: 'comp1',
                    w: 512, h: 512,
                    layers: [{ ind: 0, ty: 4, ip: 0, op: 180, ks: animatedKs('o', 100, 0, 180) }],
                },
            ],
            layers: [
                { ind: 0, ty: 0, refId: 'comp1', ip: 0, op: 180, ks: staticKs },
            ],
        }));
        expect(hasAnimatedProperties(anim)).toBe(true);
    });

    it('is true for a static property with an animated split dimension', () => {
        const anim = parseTgs(tgs({
            layers: [
                {
                    ind: 0, ty: 4, ip: 0, op: 180,
                    ks: {
                        ...staticKs,
                        p: { a: 0, y: { a: 0, k: 256 }, x: { a: 1, k: [{ t: 0, s: 0 }, { t: 180, s: 512 }] } },
                    },
                },
            ],
        }));
        expect(hasAnimatedProperties(anim)).toBe(true);
    });
});