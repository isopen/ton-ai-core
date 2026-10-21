import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { readWasmBinary } from './wasm-binary';

describe('crypton WASM routing', () => {
    let crypton: typeof import('../index').crypton;
    let initWasmCrypton: typeof import('../index').initWasmCrypton;
    let getWasmCallStats: typeof import('../index').getWasmCallStats;
    let resetWasmCallStats: typeof import('../index').resetWasmCallStats;
    let AES256ECB: typeof import('../typescript/src/aes-256-ecb').AES256ECB;
    let AES256CTR: typeof import('../typescript/src/aes-256-ctr').AES256CTR;
    let AesCtrCipher: typeof import('../typescript/src/aes-256-ctr').AesCtrCipher;
    let AES256IGE: typeof import('../typescript/src/aes-256-ige').AES256IGE;
    let AES256CBC: typeof import('../typescript/src/aes-256-cbc').AES256CBC;
    let AES256CBC_ETM: typeof import('../typescript/src/aes-256-cbc-etm').AES256CBC_ETM;

    beforeAll(async () => {
        ({ crypton, initWasmCrypton, getWasmCallStats, resetWasmCallStats } = await import('../index'));
        ({ AES256ECB } = await import('../typescript/src/aes-256-ecb'));
        ({ AES256CTR, AesCtrCipher } = await import('../typescript/src/aes-256-ctr'));
        ({ AES256IGE } = await import('../typescript/src/aes-256-ige'));
        ({ AES256CBC } = await import('../typescript/src/aes-256-cbc'));
        ({ AES256CBC_ETM } = await import('../typescript/src/aes-256-cbc-etm'));
        await initWasmCrypton({ wasmBinary: readWasmBinary() });
    }, 60000);

    test('WASM backend is active', () => {
        assert.ok(crypton.isCryptonWasmActive(), 'expected WASM backend after initWasmCrypton');
    });

    test('ECB use-after-destroy throws under WASM (no zero-key encrypt)', () => {
        const ecb = new AES256ECB(Buffer.alloc(32, 1));
        ecb.destroy();
        assert.throws(() => ecb.encryptBlock(Buffer.alloc(16)), /destroyed/);
        assert.throws(() => ecb.decryptBlock(Buffer.alloc(16)), /destroyed/);
    });

    test('CTR roundtrip + counter-offset parity under WASM', () => {
        const key = Buffer.alloc(32, 5);
        const iv = Buffer.alloc(16, 6);
        const data = Buffer.from('hello wasm ctr routing');
        const enc = AES256CTR.process(data, key, iv, 3);
        const dec = AES256CTR.process(enc, key, iv, 3);
        assert.ok(dec.equals(data));
        assert.throws(() => AES256CTR.process(Buffer.alloc(32), key, iv, 0xffffffff), /overflow|range/i);
    });

    test('sync AES256CTR.process routes through WASM aes_ctr_process', async () => {
        const key = Buffer.alloc(32, 1);
        const iv = Buffer.alloc(16, 2);
        const data = Buffer.alloc(65, 3);
        resetWasmCallStats();
        const synced = AES256CTR.process(data, key, iv, 7);
        const stats = getWasmCallStats();
        assert.ok((stats['aes_ctr_process'] ?? 0) >= 1, 'sync CTR did not route to WASM: ' + JSON.stringify(stats));
        const asynced = await AES256CTR.processAsync(data, key, iv, 7);
        assert.ok(synced.equals(asynced), 'sync and async CTR outputs differ');
    });

    test('AesCtrCipher aligned process routes through WASM aes_ctr_process', async () => {
        const key = Buffer.alloc(32, 5);
        const iv = Buffer.alloc(16, 6);
        const cipher = new AesCtrCipher(key, iv, 3);
        const data = Buffer.alloc(48, 9);
        resetWasmCallStats();
        const out = cipher.process(data);
        const stats = getWasmCallStats();
        assert.ok((stats['aes_ctr_process'] ?? 0) >= 1, 'aligned streaming did not route to WASM: ' + JSON.stringify(stats));
        assert.strictEqual(cipher.counter, 6);
        assert.ok(out.equals(AES256CTR.process(data, key, iv, 3)), 'streaming fast path differs from static process');
        cipher.destroy();
        assert.throws(() => cipher.process(data), /destroyed/);
    });

    test('AesCtrCipher unaligned process matches static process', async () => {
        const key = Buffer.alloc(32, 5);
        const iv = Buffer.alloc(16, 6);
        const sequences: number[][] = [[5, 21, 16], [39, 20, 4], [4, 12, 32], [64]];
        for (const seq of sequences) {
            const full = Buffer.alloc(seq.reduce((sum, n) => sum + n, 0), 40);
            const cipher = new AesCtrCipher(key, iv, 11);
            const parts: Buffer[] = [];
            let at = 0;
            for (const size of seq) {
                parts.push(Buffer.from(cipher.process(full.subarray(at, at + size))));
                at += size;
            }
            cipher.destroy();
            const streamed = Buffer.concat(parts);
            const want = AES256CTR.process(full, key, iv, 11);
            assert.ok(streamed.equals(want), 'streaming parity for sequence ' + seq.join('/'));
        }
    });

    test('hkdfExtract routes hmac_sha512 through WASM', async () => {
        const salt = Buffer.alloc(32, 0x07);
        const ikm = Buffer.alloc(64, 0x08);
        resetWasmCallStats();
        const prk = await crypton.hkdfExtract(salt, ikm);
        const stats = getWasmCallStats();
        assert.ok((stats['hmac_sha512'] ?? 0) >= 1, 'hkdfExtract did not route hmac_sha512 to WASM: ' + JSON.stringify(stats));
        assert.strictEqual(prk.length, 64);
        const node = require('crypto').createHmac('sha512', salt).update(ikm).digest();
        assert.ok(prk.equals(node), 'WASM hmac_sha512 differs from node reference');
    });

    test('IGE roundtrip under WASM', async () => {
        const key = Buffer.alloc(32, 7);
        const iv = Buffer.alloc(32, 8);
        const data = Buffer.alloc(64, 9);
        const enc = await AES256IGE.encrypt(data, key, iv);
        const dec = await AES256IGE.decrypt(enc, key, iv);
        assert.ok(dec.equals(data));
    });

    test('CBC roundtrip under WASM', () => {
        const key = Buffer.alloc(32, 11);
        const iv = Buffer.alloc(16, 12);
        const data = Buffer.alloc(32, 13);
        const enc = AES256CBC.encrypt(data, key, iv);
        const dec = AES256CBC.decrypt(enc, key, iv);
        assert.ok(dec.equals(data));
    });

    test('ETM empty plaintext parity across backends', async () => {
        const mac = Buffer.alloc(32, 2);
        const enc = Buffer.alloc(32, 3);
        const iv = Buffer.alloc(16, 4);
        const sealed = await AES256CBC_ETM.encrypt(mac, enc, iv, Buffer.alloc(0));
        assert.strictEqual(sealed.length, 32);
        assert.ok((await AES256CBC_ETM.decrypt(mac, enc, iv, sealed)).equals(Buffer.alloc(0)));
        const s = await AES256CBC_ETM.seal(mac, enc, Buffer.alloc(0));
        assert.strictEqual(s.length, 16 + 32);
        assert.ok((await AES256CBC_ETM.open(mac, enc, s)).equals(Buffer.alloc(0)));
        await assert.rejects(
            () => AES256CBC_ETM.decrypt(mac, enc, iv, sealed.subarray(0, 31)),
            /authentication failed/
        );
        await assert.rejects(
            () => AES256CBC_ETM.open(mac, enc, s.subarray(0, s.length - 1)),
            /authentication failed/
        );
    });

    test('ETM non-empty roundtrip under WASM', async () => {
        const mac = Buffer.alloc(32, 2);
        const enc = Buffer.alloc(32, 3);
        const iv = Buffer.alloc(16, 4);
        const pt = Buffer.alloc(48, 14);
        const sealed = await AES256CBC_ETM.encrypt(mac, enc, iv, pt);
        assert.ok((await AES256CBC_ETM.decrypt(mac, enc, iv, sealed)).equals(pt));
    });

    test('modPow + sha256 routed through WASM', async () => {
        assert.strictEqual(crypton.modPow(2n, 10n, 1000n), 24n);
        const h = await crypton.sha256(Buffer.from('abc'));
        assert.strictEqual(
            Buffer.from(h).toString('hex'),
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        );
    });

    test('WASM routing keeps the argument validation of the public wrappers', async () => {
        assert.throws(() => crypton.getRandomBytes(1.5), /Invalid random length/);
        assert.throws(() => crypton.getRandomBytes(-1), /Invalid random length/);
        assert.throws(() => crypton.getRandomBytes(2 * 1024 * 1024), /1 MiB/);
        assert.strictEqual(crypton.modPow(2n, 10n, 1n), 0n);
        assert.strictEqual(crypton.modPow(0n, 0n, 1n), 0n);
        for (const [b, e, m] of [[2n, 10n, 1n], [3n, 5n, 6n], [123n, 0n, 257n], [7n, 65537n, (1n << 2048n) - 59n]] as Array<[bigint, bigint, bigint]>) {
            const want = (() => { let r = 1n, base = b % m, exp = e; while (exp > 0n) { if (exp & 1n) r = (r * base) % m; base = (base * base) % m; exp >>= 1n; } return r; })();
            assert.strictEqual(crypton.modPow(b, e, m), want, `modPow(${b}, ${e}, ${m % 97n})`);
        }
        assert.throws(() => crypton.modPow(-1n, 2n, 10n), /Negative base/);
        assert.throws(() => crypton.modPow(2n, 2n, 0n), /Modulus must be positive/);
    });
});
