import assert from 'assert';
import { rsaVerify } from '../rsa';
import { hexToBytes } from '../utils';

const FAKE_PEM = '-----BEGIN PUBLIC KEY-----\nQUJD\n-----END PUBLIC KEY-----\n';

function stubBrowserCrypto(subtle: any): () => void {
    const versionsDesc = Object.getOwnPropertyDescriptor(process, 'versions')!;
    const realCrypto = (globalThis as any).crypto;
    Object.defineProperty(process, 'versions', { value: {}, configurable: true });
    (globalThis as any).crypto = { subtle };
    return () => {
        Object.defineProperty(process, 'versions', {
            value: versionsDesc.value,
            configurable: versionsDesc.configurable,
            writable: versionsDesc.writable,
            enumerable: versionsDesc.enumerable,
        });
        (globalThis as any).crypto = realCrypto;
    };
}

describe('rsaVerify browser-path contract', () => {
    const data = Buffer.from('payload');
    const signature = Buffer.from('signature');

    test('rejected subtle.verify resolves to false', async () => {
        const restore = stubBrowserCrypto({
            importKey: async () => ({ kty: 'mock' }),
            verify: async () => {
                throw new Error('InvalidAccessError: signature length mismatch');
            },
        });
        try {
            await expect(rsaVerify(data, signature, FAKE_PEM)).resolves.toBe(false);
        } finally {
            restore();
        }
    });

    test('rejected importKey resolves to false', async () => {
        const restore = stubBrowserCrypto({
            importKey: async () => {
                throw new Error('DataError: malformed SPKI');
            },
            verify: async () => true,
        });
        try {
            await expect(rsaVerify(data, signature, FAKE_PEM)).resolves.toBe(false);
        } finally {
            restore();
        }
    });

    test('successful subtle.verify resolves to true', async () => {
        const restore = stubBrowserCrypto({
            importKey: async () => ({ kty: 'mock' }),
            verify: async () => true,
        });
        try {
            await expect(rsaVerify(data, signature, FAKE_PEM)).resolves.toBe(true);
        } finally {
            restore();
        }
    });
});

describe('hexToBytes strict parsing', () => {
    test('rejects sign and whitespace chunks instead of silent garbage', () => {
        for (const input of ['-1', ' 1', '+a', 'a ', '  ', '+ ']) {
            assert.throws(() => hexToBytes(input), /Invalid hex byte at position 0/);
        }
        assert.throws(() => hexToBytes('aa-1'), /Invalid hex byte at position 2/);
    });

    test('keeps existing error contract', () => {
        assert.throws(() => hexToBytes('abc'), /even length/);
        assert.throws(() => hexToBytes('zz'), /Invalid hex byte at position 0/);
        assert.throws(() => hexToBytes('a0z1'), /Invalid hex byte at position 2/);
    });

    test('valid hex unchanged including uppercase and digits', () => {
        expect(Buffer.from(hexToBytes('0A1f2B3c')).toString('hex')).toBe('0a1f2b3c');
        expect(hexToBytes('')).toHaveLength(0);
    });
});
