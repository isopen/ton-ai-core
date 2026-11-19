// Quality-coverage fixtures for the animation quality test suites.
//
// Generates two Lottie (Bodymovin) animations used by the Rust and jest
// quality tests:
//
//   emoji_features.json — an animated emoji-style composition exercising the
//     full renderer surface at once: radial/linear gradients (4- and
//     5-channel stops), gradient strokes, dashed strokes with animated dash
//     offset, trim paths (simultaneously + individually, wrapped ranges),
//     repeaters with animated copies, layer masks (add/subtract/intersect,
//     animated opacity), alpha mattes, parenting, nested precomps, time
//     remap, time-sliced flipbook layers, blend modes, hold keyframes,
//     spatial bezier keyframes, star/polygon/ellipse/rect/path shapes,
//     even-odd fills.
//
//   static_badge.json — a completely static (frame-invariant) animation that
//     drives the static-bitmap fast path in RenderInstance.
//
// Output: src/rust/tests/fixtures/ and src/ts/tests/fixtures/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIRS = [
    join(HERE, '..', 'src', 'rust', 'tests', 'fixtures'),
    join(HERE, '..', 'src', 'ts', 'tests', 'fixtures'),
];

const P = (k) => ({ a: 0, k });
const A = (kfs) => ({ a: 1, k: kfs });
const kf = (t, s, e, o = [0.35, 0], i = [0.55, 1]) => ({ t, s, e, o: { x: [o[0]], y: [o[1]] }, i: { x: [i[0]], y: [i[1]] } });
const hold = (t, s) => ({ t, s, h: 1 });
const easeKf = (t, s, e, ox, oy, ix, iy) => ({ t, s, e, o: { x: [ox], y: [oy] }, i: { x: [ix], y: [iy] } });

const ks = (o) => ({ o: o?.o ?? P(100), r: o?.r ?? P(0), p: o?.p ?? P([0, 0, 0]), a: o?.a ?? P([0, 0, 0]), s: o?.s ?? P([100, 100, 100]) });

const shapeLayer = (ind, nm, shapes, tr, extra = {}) => ({
    ddd: 0, ind, ty: 4, nm, mn: nm, hd: false,
    ks: tr, ip: 0, op: 60, st: 0, bm: 0, sr: 1,
    shapes,
    ...extra,
});

const precompLayer = (ind, nm, refId, tr, extra = {}) => ({
    ddd: 0, ind, ty: 0, nm, mn: nm, refId,
    ks: tr, ip: 0, op: 60, st: 0, bm: 0, sr: 1,
    w: 100, h: 100,
    ...extra,
});

const nullLayer = (ind, nm, tr, extra = {}) => ({
    ddd: 0, ind, ty: 3, nm, mn: nm, ks: tr, ip: 0, op: 60, st: 0, bm: 0, sr: 1,
    ao: 0, ...extra,
});

const group = (it) => ({ ty: 'gr', it, nm: 'gr', np: it.length });
const xform = (p, a, s, r, o) => ({ ty: 'tr', p: p ?? P([0, 0]), a: a ?? P([0, 0]), s: s ?? P([100, 100]), r: r ?? P(0), o: o ?? P(100), nm: 'tr' });
const ellipse = (p, s) => ({ ty: 'el', p: P(p), s: P(s), d: 1, nm: 'el' });
const rect = (p, s, r) => ({ ty: 'rc', p: P(p), s, r: r ?? P(0), nm: 'rc' });
const star = (sy, pt, p, r, ir, is, orv, os) => ({
    ty: 'sr', sy, pt: P(pt), p: P(p), r, ir: P(ir), is: P(is), or: P(orv), os: P(os), nm: 'sr',
});
const bezierPath = (i, o, v, c) => ({ a: 0, k: { i, o, v, c } });
const fill = (c, o) => ({ ty: 'fl', c, o: o ?? P(100), r: 1, nm: 'fl' });
const stroke = (c, o, w, lc = 2, lj = 2) => ({ ty: 'st', c, o, w, lc, lj, ml: 4, nm: 'st' });
const gradFill = (t, p, stops, s, e, h = 0, a = 0) => ({ ty: 'gf', g: { p, k: stops }, t, s: P(s), e: P(e), h: P(h), a: P(a), nm: 'gf' });
const gradStroke = (t, p, stops, s, e, w, lc = 2, lj = 2, h = 0, a = 0) => ({
    ty: 'gs', g: { p, k: stops }, t, s: P(s), e: P(e), h: P(h), a: P(a), w, lc, lj, ml: 4, nm: 'gs',
});
const trim = (s, e, o, m) => ({ ty: 'tm', s, e, o, m, nm: 'tm' });
const repeater = (c, o, tr) => ({ ty: 'rp', c, o, m: 1, tr, nm: 'rp' });
const dashed = (d, g, offset) => ({ d: [{ n: 'd', nm: 'dash', v: d }, { n: 'g', nm: 'gap', v: g }, { n: 'o', nm: 'offset', v: offset }] });
const mask = (mode, inv, pt, o) => ({ mode, inv, pt: { a: 0, k: pt }, o, x: P(0) });

// ---------------------------------------------------------------------------
// emoji_features.json
// ---------------------------------------------------------------------------

const FACE = [
    // head: radial gradient fill with animated stops, pulsing scale, masked
    shapeLayer(31, 'head', [
        group([
            ellipse([50, 50], [60, 60]),
            gradFill(2, 2,
                A([
                    kf(0, [0, 1, 0.82, 0.25, 1, 1, 0.55, 0.15], [0, 1, 0.7, 0.2, 1, 1, 0.75, 0.2]),
                    kf(30, [0, 1, 0.7, 0.2, 1, 1, 0.75, 0.2], [0, 1, 0.9, 0.3, 1, 1, 0.6, 0.1]),
                    kf(59, [0, 1, 0.9, 0.3, 1, 1, 0.6, 0.1], [0, 1, 0.9, 0.3, 1, 1, 0.6, 0.1]),
                ]),
                [50, 20], [50, 80], 0, 0),
        ]),
    ], ks({
        s: A([
            easeKf(0, [100, 100, 100], [112, 112, 100], 0.3, 0, 0.3, 1),
            easeKf(30, [112, 112, 100], [96, 96, 100], 0.4, 0, 0.6, 1),
            easeKf(59, [96, 96, 100], [96, 96, 100], 0.4, 0, 0.6, 1),
        ]),
        a: P([50, 50, 0]),
    }), {
        masksProperties: [
            mask('a', false, bezierPath(
                [[0, 0], [0, 0], [0, 0], [0, 0]], [[14, 0], [0, 14], [-14, 0], [0, -14]],
                [[36, 16], [64, 16], [64, 44], [36, 44]], true,
            ), P(100)),
            mask('s', false, bezierPath(
                [[0, 0], [0, 0]], [[6, 0], [-6, 0]],
                [[38, 20], [46, 20]], true,
            ), A([kf(0, [100], [30]), kf(45, [30], [0]), kf(59, [0], [0])])),
        ],
    }),
    // eyes: animated path vertices (blink), hold-keyframed opacity
    shapeLayer(32, 'eyes', [
        group([
            { ty: 'sh', ks: A([
                kf(0, { c: true, i: [[-4, 0], [0, -4], [4, 0], [0, 4]], o: [[4, 0], [0, 4], [-4, 0], [0, -4]], v: [[38, 42], [46, 42], [54, 42], [46, 46]] },
                    { c: true, i: [[-4, 0], [0, -2], [4, 0], [0, 2]], o: [[4, 0], [0, 2], [-4, 0], [0, -2]], v: [[38, 43], [46, 43], [54, 43], [46, 44]] }),
                kf(30, { c: true, i: [[-4, 0], [0, -2], [4, 0], [0, 2]], o: [[4, 0], [0, 2], [-4, 0], [0, -2]], v: [[38, 43], [46, 43], [54, 43], [46, 44]] },
                    { c: true, i: [[-4, 0], [0, -4], [4, 0], [0, 4]], o: [[4, 0], [0, 4], [-4, 0], [0, -4]], v: [[38, 42], [46, 42], [54, 42], [46, 46]] }),
                kf(59, { c: true, i: [[-4, 0], [0, -4], [4, 0], [0, 4]], o: [[4, 0], [0, 4], [-4, 0], [0, -4]], v: [[38, 42], [46, 42], [54, 42], [46, 46]] },
                    { c: true, i: [[-4, 0], [0, -4], [4, 0], [0, 4]], o: [[4, 0], [0, 4], [-4, 0], [0, -4]], v: [[38, 42], [46, 42], [54, 42], [46, 46]] }),
            ]), nm: 'eye' },
            fill(P([0.1, 0.1, 0.15, 1])),
        ]),
    ], ks({ p: P([50, 50, 0]), a: P([46, 43, 0]), o: A([hold(0, [100]), hold(25, [60]), hold(40, [100])]) })),
    // mouth: rounded rect with animated size + radius, multiply blend
    shapeLayer(33, 'mouth', [
        group([
            rect(P([50, 63, 0]),
                A([kf(0, [26, 10], [34, 16]), kf(30, [34, 16], [20, 6]), kf(59, [20, 6], [20, 6])]),
                A([kf(0, [3], [6]), kf(30, [6], [2]), kf(59, [2], [2])])),
            fill(P([0.55, 0.15, 0.2, 1])),
        ]),
    ], ks({ p: P([50, 50, 0]) }), { bm: 2 }),
];

// time-sliced flipbook asset: two static layers covering different frame spans
const BLINK = [
    shapeLayer(41, 'flip_open', [
        group([
            ellipse([50, 24], [40, 30]),
            fill(P([0.2, 0.7, 1, 1])),
        ]),
    ], ks({ p: P([50, 50, 0]) }), { ip: 0, op: 30 }),
    shapeLayer(42, 'flip_closed', [
        group([
            { ty: 'sh', ks: bezierPath(
                [[0, 0], [0, 0], [0, 0]], [[-10, 4], [0, -8], [10, 4]],
                [[40, 30], [50, 22], [60, 30]], false,
            ) },
            { ty: 'st', c: P([0.9, 0.9, 1, 1]), o: P(100), w: P(2.5), lc: 2, lj: 2, ml: 4 },
        ]),
    ], ks({ p: P([50, 50, 0]) }), { ip: 30, op: 60 }),
];

const FEATURES = {
    v: '5.9.6', fr: 30, ip: 0, op: 60, w: 100, h: 100, ddd: 0, nm: 'emoji_features',
    meta: { g: 'quality-suite' },
    assets: [
        { id: 'face', layers: FACE },
        { id: 'blink', layers: BLINK },
    ],
    layers: [
        // ring: dashed stroke with animated dash offset + animated width
        shapeLayer(8, 'ring', [
            group([
                ellipse([50, 50], [72, 72]),
                {
                    ...stroke(A([kf(0, [1, 0.4, 0.1, 1], [0.4, 0.2, 0.9, 1]), kf(40, [0.4, 0.2, 0.9, 1], [1, 0.6, 0.2, 1]), kf(59, [1, 0.6, 0.2, 1], [1, 0.6, 0.2, 1])]),
                        P(100), A([kf(0, [2], [4]), kf(30, [4], [1.5]), kf(59, [1.5], [1.5])]), 2, 2),
                    ...dashed(P(9), P(5), A([kf(0, [0], [40]), kf(59, [40], [40])])),
                },
            ]),
        ], ks({ p: P([50, 50, 0]) })),
        // matte source (td) for the sparkle precomp below it
        shapeLayer(7, 'matte_src', [
            group([
                star(2, 6, P([50, 50]), A([kf(0, [0], [180]), kf(59, [180], [180])]), P(22), P(0), P(26), P(0)),
                fill(P([1, 1, 1, 1])),
            ]),
        ], ks({ p: P([50, 50, 0]) }), { td: 1 }),
        // sparkle: precomp content clipped by the alpha matte above,
        // parented to the rotor, animated position + time remap
        precompLayer(6, 'sparkle', 'blink', ks({
            p: A([
                {
                    t: 0, s: [50, 50, 0], e: [50, 30, 0],
                    to: [8, -6, 0], ti: [-8, 6, 0],
                    o: { x: [0.3], y: [0] }, i: { x: [0.5], y: [1] },
                },
                { t: 30, s: [50, 30, 0] },
            ]),
            s: A([kf(0, [60, 60, 100], [110, 110, 100]), kf(59, [110, 110, 100], [110, 110, 100])]),
        }), { tt: 1, parent: 1, tm: A([kf(0, [0.0], [1.9]), kf(59, [1.9], [1.9])]) }),
        // spark: gradient stroke + wrapped trim
        shapeLayer(5, 'spark', [
            group([
                star(1, 5, P([50, 50]), P(0), P(14), P(0), P(30), P(0)),
                gradStroke(1, 3,
                    A([
                        kf(0, [0, 1, 0.3, 0.1, 1, 0.2, 0.4, 1, 1, 0.7, 0.9, 0.2, 1, 0.1, 0.3],
                            [0, 1, 0.3, 0.1, 1, 0.6, 0.2, 0.9, 1, 0.2, 0.4, 1, 0.9, 0.1, 0.3]),
                        kf(59, [0, 1, 0.3, 0.1, 1, 0.6, 0.2, 0.9, 1, 0.2, 0.4, 1, 0.9, 0.1, 0.3],
                            [0, 1, 0.3, 0.1, 1, 0.6, 0.2, 0.9, 1, 0.2, 0.4, 1, 0.9, 0.1, 0.3]),
                    ]),
                    [20, 50], [80, 50], P(3), 2, 2),
                trim(
                    A([kf(0, [0], [25]), kf(59, [25], [25])]),
                    A([kf(0, [20], [90]), kf(59, [90], [90])]),
                    A([kf(0, [0], [170]), kf(59, [170], [170])]), 1),
            ]),
        ], ks({ p: P([50, 50, 0]), r: A([kf(0, [0], [360]), kf(59, [360], [360])]) })),
        // multi: individually-trimmed group with even-odd fill + masks
        shapeLayer(4, 'multi', [
            group([
                rect(P([30, 70, 0]), P([22, 10]), P(4)),
                ellipse([70, 70], [18, 18]),
                { ty: 'sh', ks: A([
                    kf(0, { c: true, i: [[0, 0], [0, 0], [0, 0]], o: [[5, 5], [-5, 5], [-5, -5]], v: [[30, 90], [50, 78], [70, 90]] },
                        { c: true, i: [[0, 0], [0, 0], [0, 0]], o: [[5, 5], [-5, 5], [-5, -5]], v: [[35, 92], [50, 84], [65, 92]] }),
                    kf(59, { c: true, i: [[0, 0], [0, 0], [0, 0]], o: [[5, 5], [-5, 5], [-5, -5]], v: [[35, 92], [50, 84], [65, 92]] },
                        { c: true, i: [[0, 0], [0, 0], [0, 0]], o: [[5, 5], [-5, 5], [-5, -5]], v: [[35, 92], [50, 84], [65, 92]] }),
                ]) },
                { ...fill(P([0.95, 0.3, 0.35, 1])), r: 2 },
                trim(A([kf(0, [10], [40])]), A([kf(0, [60], [95])]), P(0), 2),
            ]),
        ], ks({ p: P([50, 50, 0]) }), {
            masksProperties: [
                mask('a', false, bezierPath(
                    [[0, 0], [0, 0], [0, 0], [0, 0]], [[20, 0], [0, 20], [-20, 0], [0, -20]],
                    [[20, 60], [80, 60], [80, 100], [20, 100]], true,
                ), P(100)),
                mask('i', true, bezierPath(
                    [[0, 0], [0, 0], [0, 0], [0, 0]], [[10, 0], [0, 10], [-10, 0], [0, -10]],
                    [[60, 70], [90, 70], [90, 96], [60, 96]], true,
                ), A([kf(0, [100], [40]), kf(59, [40], [40])])),
            ],
        }),
        // rays: repeater with animated copies and fading end opacity
        shapeLayer(3, 'rays', [
            group([
                rect(P([0, -3, 0]), P([16, 6]), P(3)),
                fill(A([kf(0, [1, 0.8, 0.2, 1], [1, 0.5, 0.1, 1]), kf(59, [1, 0.5, 0.1, 1], [1, 0.5, 0.1, 1])])),
            ]),
            repeater(
                A([kf(0, [4], [12]), kf(59, [12], [12])]),
                P(0),
                {
                    ...ks({ p: P([0, 9]), so: P(100), eo: P(35) }),
                    r: A([kf(0, [0], [24]), kf(59, [24], [24])]),
                }),
        ], ks({ p: P([50, 50, 0]), a: P([0, 0, 0]) })),
        // face holder: parented precomp with hold keyframes + scale pulse
        precompLayer(2, 'face_holder', 'face', ks({
            p: A([hold(0, [50, 50, 0]), hold(20, [54, 48, 0]), hold(40, [46, 52, 0]), hold(59, [50, 50, 0])]),
            s: A([
                easeKf(0, [100, 100, 100], [85, 85, 100], 0.4, 0, 0.6, 1),
                easeKf(45, [85, 85, 100], [105, 105, 100], 0.2, 0, 0.4, 1),
                easeKf(59, [105, 105, 100], [105, 105, 100], 0.2, 0, 0.4, 1),
            ]),
            a: P([50, 50, 0]),
        }), { parent: 1 }),
        // rotor: null layer driving the parent chain
        nullLayer(1, 'rotor', ks({
            r: A([
                easeKf(0, [0], [360], 0.25, 0, 0.75, 1),
                easeKf(59, [360], [360], 0.25, 0, 0.75, 1),
            ]),
            p: P([50, 50, 0]),
        })),
    ],
};

// ---------------------------------------------------------------------------
// static_badge.json — frame-invariant animation (static bitmap fast path)
// ---------------------------------------------------------------------------

const BADGE_INNER = [
    shapeLayer(51, 'inner_dot', [
        group([
            ellipse([50, 50], [40, 40]),
            fill(P([0.15, 0.15, 0.2, 1])),
        ]),
    ], ks({ p: P([50, 50, 0]) })),
];

const STATIC_BADGE = {
    v: '5.9.6', fr: 30, ip: 0, op: 30, w: 100, h: 100, ddd: 0, nm: 'static_badge',
    assets: [
        { id: 'badge_inner', layers: BADGE_INNER },
    ],
    layers: [
        shapeLayer(62, 'outline', [
            group([
                star(1, 8, P([50, 50]), P(0), P(34), P(0), P(46), P(0)),
                stroke(P([0.98, 0.75, 0.2, 1]), P(100), P(2.5), 1, 1),
            ]),
        ], ks({ p: P([50, 50, 0]) })),
        shapeLayer(61, 'badge', [
            group([
                star(1, 8, P([50, 50]), P(0), P(34), P(0), P(46), P(0)),
                gradFill(2, 2, P([0, 0.25, 0.5, 1, 1, 0.95, 0.98, 1]), [50, 20], [50, 80]),
            ]),
        ], ks({ p: P([50, 50, 0]) })),
        precompLayer(60, 'inner', 'badge_inner', ks({ p: P([50, 50, 0]), s: P([70, 70, 100]) })),
    ],
};

// ---------------------------------------------------------------------------
// cache_stress.json — animation designed to bloat the coverage-span cache.
//
// Real emoji files almost never fill the rotating coverage cache: their
// animated paints change every frame and are never captured, so the
// rotation/freeze/era-rebuild machinery stays idle. This fixture stacks ~22
// static near-full-canvas rect fills (each rasterizes to a large coverage
// entry, ~60KiB at a 256px render) to cross the cache budget twice, forcing
// rotations → freeze, plus static masked rects (mask-plane hits) and an
// animated masked overlay (per-frame mask-key churn) so the highest-speed
// path is genuinely under load while every frame must still match the
// uncached reference byte-for-byte.
// ---------------------------------------------------------------------------

const STRESS_RECT_COUNT = 22;
const stressRectLayer = (i) => shapeLayer(
    100 + i, `stress_rect_${i}`,
    [
        group([
            rect(P([50 + ((i % 7) - 3), 50 + ((i % 5) - 2), 0]), P([92 + (i % 4), 88 + (i % 3)]), P(2)),
            fill(P([0.12 + (i % 6) * 0.09, 0.2 + (i % 4) * 0.12, 0.35 + (i % 5) * 0.1, 1]), P(4)),
        ]),
    ],
    ks({ p: P([50, 50, 0]) }),
);

const CACHE_STRESS = {
    v: '5.9.6', fr: 30, ip: 0, op: 60, w: 100, h: 100, ddd: 0, nm: 'cache_stress',
    meta: { g: 'quality-suite' },
    assets: [],
    layers: [
        // bottom: the coverage-cache bloat stack (static, distinct keys)
        ...Array.from({ length: STRESS_RECT_COUNT }, (_, i) => stressRectLayer(i)),
        // static masked rect: mask-plane cache hits across frames
        shapeLayer(150, 'masked_static', [
            group([
                rect(P([50, 42, 0]), P([60, 44]), P(6)),
                fill(P([0.95, 0.55, 0.15, 1]), P(85)),
            ]),
        ], ks({ p: P([50, 50, 0]) }), {
            masksProperties: [
                mask('a', false, bezierPath(
                    [[0, 0], [0, 0], [0, 0], [0, 0]], [[-20, 0], [0, -20], [20, 0], [0, 20]],
                    [[30, 30], [70, 30], [70, 54], [30, 54]], true,
                ), P(100)),
            ],
        }),
        // animated masked overlay: mask key changes every frame (LRU churn)
        shapeLayer(151, 'masked_animated', [
            group([
                ellipse([50, 50], [46, 46]),
                fill(P([0.25, 0.6, 1, 1]), A([kf(0, [90], [30]), kf(30, [30], [90]), kf(59, [90], [90])])),
            ]),
        ], ks({
            p: P([50, 50, 0]),
            s: A([
                easeKf(0, [70, 70, 100], [130, 130, 100], 0.4, 0, 0.6, 1),
                easeKf(45, [130, 130, 100], [70, 70, 100], 0.4, 0, 0.6, 1),
                easeKf(59, [70, 70, 100], [70, 70, 100], 0.4, 0, 0.6, 1),
            ]),
            r: A([kf(0, [0], [200]), kf(59, [200], [200])]),
        }), {
            masksProperties: [
                mask('a', false, bezierPath(
                    [[0, 0], [0, 0], [0, 0], [0, 0]], [[-26, 0], [0, -26], [26, 0], [0, 26]],
                    [[24, 50], [76, 50], [76, 96], [24, 96]], true,
                ), A([kf(0, [20], [100]), kf(59, [100], [100])])),
            ],
        }),
    ],
};

for (const dir of OUT_DIRS) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'emoji_features.json'), JSON.stringify(FEATURES));
    writeFileSync(join(dir, 'static_badge.json'), JSON.stringify(STATIC_BADGE));
    writeFileSync(join(dir, 'cache_stress.json'), JSON.stringify(CACHE_STRESS));
    console.log('[gen-quality-fixtures] wrote emoji_features.json, static_badge.json, cache_stress.json to', dir);
}
