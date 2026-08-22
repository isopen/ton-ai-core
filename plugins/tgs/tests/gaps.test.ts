import { parseTgs, inflateTgs, loadTgs, frameAtPos, configureModelCacheSize } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';
import { gzipSync } from 'zlib';

function tgs(body: object): string {
    return JSON.stringify({
        tgs: 1, v: '5.5.2', fr: 60, ip: 0, op: 180, w: 100, h: 100, nm: 'test',
        ...body,
    });
}

const MINIMAL = { layers: [] };

describe('parser defaults and edge inputs', () => {
    test('missing fr defaults to 30 and drives duration', () => {
        const anim = parseTgs(JSON.stringify({ tgs: 1, v: '5.5.2', ip: 10, op: 70, w: 8, h: 8, layers: [] }));
        expect(anim.fps).toBe(30);
        expect(anim.duration).toBeCloseTo(2, 5);
    });

    test('fr=0 is coerced to 30 (no division by zero downstream)', () => {
        const anim = parseTgs(tgs({ fr: 0, layers: [] }));
        expect(anim.fps).toBe(30);
    });

    test('missing w/h default to 512', () => {
        const anim = parseTgs(JSON.stringify({ tgs: 1, fr: 30, ip: 0, op: 30, layers: [] }));
        expect(anim.width).toBe(512);
        expect(anim.height).toBe(512);
    });

    test('missing ip/op default to 0 with zero duration', () => {
        const anim = parseTgs(JSON.stringify({ tgs: 1, fr: 30, layers: [] }));
        expect(anim.inFrame).toBe(0);
        expect(anim.outFrame).toBe(0);
        expect(anim.duration).toBe(0);
    });

    test('inverted range (op < ip) parses without throwing', () => {
        const anim = parseTgs(tgs({ ip: 100, op: 10, layers: [] }));
        expect(anim.inFrame).toBe(100);
        expect(anim.outFrame).toBe(10);
        expect(anim.duration).toBeLessThan(0);
    });

    test('markers missing leaves the field undefined', () => {
        const anim = parseTgs(tgs(MINIMAL));
        expect(anim.markers).toBeUndefined();
    });
});

describe('model cache keys', () => {
    test('same json without key re-parses fresh objects; explicit key reuses one', () => {
        const a = parseTgs(tgs(MINIMAL));
        const b = parseTgs(tgs(MINIMAL));
        expect(b).not.toBe(a);

        const keyed1 = parseTgs(tgs(MINIMAL), { key: 'k1' });
        const keyed2 = parseTgs(tgs(MINIMAL), { key: 'k1' });
        expect(keyed2).toBe(keyed1);

        const other = parseTgs(tgs(MINIMAL), { key: 'k2' });
        expect(other).not.toBe(keyed1);
    });

    test('cache lookup is keyed solely by options.key (json ignored)', () => {
        // Documented sharp edge: two different payloads sharing a key return
        // the first parsed model. Callers must use unique keys.
        const a = parseTgs(tgs({ layers: [], nm: 'first' }), { key: 'shared' });
        const b = parseTgs(tgs({ layers: [], nm: 'second' }), { key: 'shared' });
        expect(b).toBe(a);
        expect(b.name).toBe('first');
    });

    test('configureModelCacheSize(0) clears existing entries', () => {
        configureModelCacheSize(4);
        const a = parseTgs(tgs(MINIMAL), { key: 'zero-test' });
        configureModelCacheSize(0);
        const b = parseTgs(tgs(MINIMAL), { key: 'zero-test' });
        expect(b).not.toBe(a);
    });
});

describe('frameAtPos edge cases', () => {
    const anim: ParsedAnimation = parseTgs(tgs({ ip: 10, op: 110, layers: [] }));

    test('pos 0 maps to inFrame', () => {
        expect(frameAtPos(anim, 0)).toBe(10);
    });

    test('pos 1 maps to outFrame', () => {
        expect(frameAtPos(anim, 1)).toBe(110);
    });

    test('negative positions clamp to inFrame', () => {
        expect(frameAtPos(anim, -3)).toBe(10);
    });

    test('positions above 1 clamp to outFrame', () => {
        expect(frameAtPos(anim, 42)).toBe(110);
    });

    test('midpoint maps into the range', () => {
        const f = frameAtPos(anim, 0.5);
        expect(f).toBeGreaterThanOrEqual(10);
        expect(f).toBeLessThanOrEqual(110);
    });

    test('degenerate op===ip returns inFrame for every position', () => {
        const degenerate: ParsedAnimation = parseTgs(tgs({ ip: 7, op: 7, layers: [] }));
        expect(frameAtPos(degenerate, 0)).toBe(7);
        expect(frameAtPos(degenerate, 0.5)).toBe(7);
        expect(frameAtPos(degenerate, 1)).toBe(7);
    });
});

describe('inflateTgs robustness', () => {
    test('roundtrips a large multi-chunk gzip payload', async () => {
        const big = JSON.stringify({
            tgs: 1, fr: 60, ip: 0, op: 60, w: 8, h: 8,
            layers: [],
            filler: 'x'.repeat(400_000),
        });
        const out = await inflateTgs(new Uint8Array(gzipSync(Buffer.from(big))));
        expect(out).toBe(big);
    }, 15000);

    test('empty buffer decodes to empty string', async () => {
        expect(await inflateTgs(new Uint8Array(0))).toBe('');
    });

    test('gzip of an empty string inflates to empty string', async () => {
        const out = await inflateTgs(new Uint8Array(gzipSync(Buffer.from(''))));
        expect(out).toBe('');
    });

    test('loadTgs accepts gzipped input end-to-end', async () => {
        const body = tgs({ layers: [] });
        const anim = await loadTgs(new Uint8Array(gzipSync(Buffer.from(body))));
        expect(anim.tgs).toBe(true);
        expect(anim.layers).toEqual([]);
    });
});
