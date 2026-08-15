import { inflateTgs, loadTgs, parseTgs, frameAtPos, TgsPlugin, Property } from '@ton-ai/tgs';
import { gzipSync } from 'zlib';

const JSON_BODY = JSON.stringify({
    tgs: 1,
    v: '5.5.2',
    fr: 60,
    ip: 0,
    op: 180,
    w: 100,
    h: 100,
    nm: 'test',
    layers: [],
});

describe('inflateTgs', () => {
    it('decodes plain bytes as utf-8', async () => {
        const out = await inflateTgs(new TextEncoder().encode(JSON_BODY));
        expect(out).toBe(JSON_BODY);
    });
    it('gunzips gzip magic bytes', async () => {
        const gz = gzipSync(Buffer.from(JSON_BODY));
        const out = await inflateTgs(new Uint8Array(gz));
        expect(out).toBe(JSON_BODY);
    });
    it('treats short non-gzip buffers as plain', async () => {
        const out = await inflateTgs(new Uint8Array([1, 2]));
        expect(out).toBe('\u0001\u0002');
    });
    it('throws when DecompressionStream is unavailable', async () => {
        const gz = gzipSync(Buffer.from(JSON_BODY));
        const original = (globalThis as any).DecompressionStream;
        (globalThis as any).DecompressionStream = undefined;
        try {
            await expect(inflateTgs(new Uint8Array(gz))).rejects.toThrow('DecompressionStream not available');
        } finally {
            (globalThis as any).DecompressionStream = original;
        }
    });
});

describe('loadTgs', () => {
    it('parses a JSON string', async () => {
        const anim = await loadTgs(JSON_BODY);
        expect(anim.width).toBe(100);
    });
    it('parses a gzipped byte array', async () => {
        const gz = gzipSync(Buffer.from(JSON_BODY));
        const anim = await loadTgs(new Uint8Array(gz));
        expect(anim.width).toBe(100);
    });
    it('parses a plain byte array', async () => {
        const anim = await loadTgs(new TextEncoder().encode(JSON_BODY));
        expect(anim.width).toBe(100);
    });
    it('forwards parse options', async () => {
        const anim = await loadTgs(JSON_BODY, { key: 'k1' });
        const again = await loadTgs(JSON_BODY, { key: 'k1' });
        expect(anim).toBe(again);
    });
});

describe('frameAtPos', () => {
    it('maps a position to a frame', () => {
        const anim = parseTgs(JSON_BODY);
        expect(frameAtPos(anim, 0)).toBe(0);
        expect(frameAtPos(anim, 0.5)).toBe(90);
        expect(frameAtPos(anim, 1)).toBe(180);
    });
});

describe('TgsPlugin', () => {
    const context = {
        events: { on: () => this, off: () => this, emit: () => true, once: () => this, removeAllListeners: () => this },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        config: {} as Record<string, any>,
    };
    it('exposes metadata', () => {
        const p = new TgsPlugin();
        expect(p.metadata.name).toBe('tgs');
    });
    it('parses, interpolates and inspects layers', async () => {
        const p = new TgsPlugin();
        await p.initialize(context);
        const anim = p.parse(JSON_BODY);
        expect(anim.layers).toHaveLength(0);
        expect(p.frameAtPos(anim, 0.5)).toBe(90);
        expect(p.layers(anim)).toEqual([]);
        expect(p.interpolate({ animated: false, value: 7 }, 3)).toBe(7);
    });
    it('setValue routes to keypath overrides', async () => {
        const p = new TgsPlugin();
        await p.initialize(context);
        const anim = p.parse(JSON.stringify({
            tgs: 1, v: '5.5.2', fr: 60, ip: 0, op: 180, w: 100, h: 100, nm: 't', layers: [{
                ind: 0, ty: 4, nm: 'L', ks: {},
                shapes: [{ ty: 'fl', nm: 'F', c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } }],
            }],
        }));
        p.setValue(anim, 'L.F', Property.FillColor, [0, 0, 1]);
        expect(p.interpolate(anim.layers[0].shapes![0].color!, 0)).toEqual([0, 0, 1]);
    });
    it('applies cacheSize from config on init', async () => {
        const p = new TgsPlugin();
        await p.initialize({ ...context, config: { cacheSize: 1 } });
        const json = JSON.stringify({ tgs: 1, v: '5.5.2', fr: 60, ip: 0, op: 180, w: 100, h: 100, nm: 't', layers: [] });
        const a = p.parse(json);
        p.parse(json);
        const again = p.parse(json);
        expect(again).not.toBe(a);
        expect(context.logger.info).toHaveBeenCalledWith('TGS Parser initialized');
    });
});