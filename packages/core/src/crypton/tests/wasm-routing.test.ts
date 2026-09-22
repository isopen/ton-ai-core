import { strict as assert } from 'assert';
import { Buffer } from 'buffer';

describe('crypton WASM routing', () => {
    let crypton: typeof import('../index').crypton;
    let initWasmCrypton: typeof import('../index').initWasmCrypton;
    let AES256ECB: typeof import('../aes-256-ecb').AES256ECB;
    let AES256CTR: typeof import('../aes-256-ctr').AES256CTR;
    let AES256IGE: typeof import('../aes-256-ige').AES256IGE;
    let AES256CBC: typeof import('../aes-256-cbc').AES256CBC;
    let AES256CBC_ETM: typeof import('../aes-256-cbc-etm').AES256CBC_ETM;

    beforeAll(async () => {
        ({ crypton, initWasmCrypton } = await import('../index'));
        ({ AES256ECB } = await import('../aes-256-ecb'));
        ({ AES256CTR } = await import('../aes-256-ctr'));
        ({ AES256IGE } = await import('../aes-256-ige'));
        ({ AES256CBC } = await import('../aes-256-cbc'));
        ({ AES256CBC_ETM } = await import('../aes-256-cbc-etm'));
        await initWasmCrypton();
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
});
