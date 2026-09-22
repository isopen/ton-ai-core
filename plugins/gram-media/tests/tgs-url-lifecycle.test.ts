import { configure } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '../src/router.js';
import { makeHost } from './helpers.js';

function makeRouter(): GramMediaRouter {
    const { host } = makeHost();
    return new GramMediaRouter(host);
}

function tinyTgs(i: number): ArrayBuffer {
    const json = JSON.stringify({ v: '5.5.2', fr: 60, ip: 0, op: 30, w: 512, h: 512, id: i, layers: [] });
    return new TextEncoder().encode(json).buffer as ArrayBuffer;
}

function watchRevokes(): { revoked: string[]; restore: () => void } {
    const revoked: string[] = [];
    const orig = URL.revokeObjectURL.bind(URL);
    (URL as any).revokeObjectURL = (u: string) => { revoked.push(u); return orig(u as any); };
    return { revoked, restore: () => { (URL as any).revokeObjectURL = orig; } };
}

function mapOf(router: GramMediaRouter): Map<string, string> {
    return (router as any).tgsJsonByUrl as Map<string, string>;
}

function tsOf(router: GramMediaRouter): Map<string, number> {
    return (router as any).tgsJsonByUrlTs as Map<string, number>;
}

describe('GramMediaRouter tgs json url lifecycle', () => {
    beforeAll(() => configure({ noMediaCache: false }));

    test('burst of fresh urls does not revoke live entries', async () => {
        const router = makeRouter();
        const { revoked, restore } = watchRevokes();
        try {
            const urls: string[] = [];
            for (let i = 0; i < 320; i++) urls.push(await router.tgsToJsonUrl(tinyTgs(i)));
            expect(new Set(urls).size).toBe(320);
            expect(revoked).toHaveLength(0);
            expect(mapOf(router).size).toBe(320);
        } finally {
            restore();
        }
    });

    test('evicts oldest idle unprotected url first', async () => {
        const router = makeRouter();
        const { revoked, restore } = watchRevokes();
        try {
            const victim = await router.tgsToJsonUrl(tinyTgs(1_000_000));
            tsOf(router).set(victim, Date.now() - 10 * 60 * 1000);
            for (let i = 0; i < 300; i++) await router.tgsToJsonUrl(tinyTgs(2_000_000 + i));
            expect(revoked).toEqual([victim]);
            expect(mapOf(router).has(victim)).toBe(false);
        } finally {
            restore();
        }
    });

    test('never revokes referenced emoji urls on evict or sweep', async () => {
        const router = makeRouter();
        const { revoked, restore } = watchRevokes();
        try {
            const guarded = await router.tgsToJsonUrl(tinyTgs(3_000_000));
            router.setCachedEmojiUrl('emojipack-9', guarded);
            tsOf(router).set(guarded, Date.now() - 40 * 60 * 1000);
            for (let i = 0; i < 300; i++) await router.tgsToJsonUrl(tinyTgs(4_000_000 + i));
            (router as any).tgsJsonSweepAt = 0;
            await router.tgsToJsonUrl(tinyTgs(9_000_000));
            expect(revoked).not.toContain(guarded);
            expect(mapOf(router).has(guarded)).toBe(true);
        } finally {
            restore();
        }
    });

    test('sweep drops old unprotected entries without revoking the blob', async () => {
            const router = makeRouter();
        const { revoked, restore } = watchRevokes();
        try {
            for (let i = 0; i < 64; i++) await router.tgsToJsonUrl(tinyTgs(5_100_000 + i));
            const old = await router.tgsToJsonUrl(tinyTgs(5_000_000));
            tsOf(router).set(old, Date.now() - 40 * 60 * 1000);
            (router as any).tgsJsonSweepAt = 0;
            await router.tgsToJsonUrl(tinyTgs(6_000_000));
            expect(mapOf(router).has(old)).toBe(false);
            expect(revoked).not.toContain(old);
        } finally {
            restore();
        }
    });
});
