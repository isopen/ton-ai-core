import { strict as assert } from 'assert';
import { DiffieHellman } from '../diffie-hellman';
import { modPow } from '../utils';

describe('DiffieHellman', () => {
    const min = 1n << (2048n - 64n);
    const defaultP = DiffieHellman['DEFAULT_P'];
    const defaultG = 2n;

    test('generateKeys with default parameters', () => {
        const keys = DiffieHellman.generateKeys();
        assert.ok(keys.privateKey > 0n, 'Private key must be > 0');
        assert.ok(keys.publicKey > 0n, 'Public key must be > 0');
        assert.ok(keys.privateKey >= min && keys.privateKey <= defaultP - min, 'Private key range invalid');
        assert.ok(keys.publicKey > 1n && keys.publicKey < defaultP - 1n, 'Public key range invalid');
    });

    test('shared secret consistency', () => {
        const alice = DiffieHellman.generateKeys();
        const bob = DiffieHellman.generateKeys();
        const sA = DiffieHellman.computeSharedSecret(alice.privateKey, bob.publicKey);
        const sB = DiffieHellman.computeSharedSecret(bob.privateKey, alice.publicKey);
        assert.ok(sA.equals(sB), 'Shared secrets must match');
        assert.strictEqual(sA.length, 256, 'Shared secret must be 256 bytes');
    });

    test('validatePublicKey rejects invalid values', () => {
        assert.throws(() => DiffieHellman.validatePublicKey(0n), 'Public key 0 should throw');
        assert.throws(() => DiffieHellman.validatePublicKey(defaultP), 'Public key p should throw');
        assert.throws(() => DiffieHellman.validatePublicKey(min - 1n), 'Too small public key should throw');
        assert.throws(() => DiffieHellman.validatePublicKey(defaultP - min + 1n), 'Too large public key should throw');
        assert.doesNotThrow(() => DiffieHellman.validatePublicKey(min), 'Min valid public key should pass');
        assert.doesNotThrow(() => DiffieHellman.validatePublicKey(defaultP - min), 'Max valid public key should pass');
    });

    test('validatePublicKey with custom p', () => {
        assert.doesNotThrow(() => DiffieHellman.validatePublicKey(min, defaultP));
        assert.throws(() => DiffieHellman.validatePublicKey(0n, defaultP));
    });

    test('validateDhParams rejects invalid params', () => {
        assert.throws(() => DiffieHellman.validateDhParams(23n, 2n), 'Small p should throw');
        assert.throws(() => DiffieHellman.validateDhParams(defaultP, 1n), 'g=1 should throw');
        assert.throws(() => DiffieHellman.validateDhParams(defaultP, defaultP - 1n), 'g=p-1 should throw');
        assert.doesNotThrow(() => DiffieHellman.validateDhParams(defaultP, defaultG), 'Real Telegram (p,g) pair must be accepted');
    });

    test('generateKeys with custom parameters', () => {
        assert.doesNotThrow(() => DiffieHellman.generateKeys(defaultP, defaultG));
        const customKeys = DiffieHellman.generateKeys(defaultP, defaultG);
        assert.ok(customKeys.privateKey >= min && customKeys.privateKey <= defaultP - min);
        assert.throws(() => DiffieHellman.generateKeys(23n, 2n), 'Invalid p should throw');
        assert.throws(() => DiffieHellman.generateKeys(defaultP, 1n), 'Invalid g should throw');
    });

    test('computeSharedSecret with explicit p', () => {
        const alice = DiffieHellman.generateKeys(defaultP, defaultG);
        const bob = DiffieHellman.generateKeys(defaultP, defaultG);
        const secretCustom = DiffieHellman.computeSharedSecret(alice.privateKey, bob.publicKey, defaultP);
        const secretDefault = DiffieHellman.computeSharedSecret(alice.privateKey, bob.publicKey);
        assert.ok(secretCustom.equals(secretDefault), 'Explicit and default p must give same secret');
    });

    test('computePublicKey consistency', () => {
        const alice = DiffieHellman.generateKeys();
        const pubDefault = DiffieHellman.computePublicKey(alice.privateKey);
        const pubCustom = DiffieHellman.computePublicKey(alice.privateKey, defaultP, defaultG);
        assert.strictEqual(pubDefault, pubCustom, 'Public key must be consistent');
    });

    test('computeSharedSecret rejects invalid peer key', () => {
        const alice = DiffieHellman.generateKeys();
        assert.throws(() => DiffieHellman.computeSharedSecret(alice.privateKey, 0n), 'Peer key 0 should throw');
        assert.throws(() => DiffieHellman.computeSharedSecret(alice.privateKey, defaultP), 'Peer key p should throw');
    });

    test('shared secret matches manual modular exponentiation', () => {
        const alice = DiffieHellman.generateKeys();
        const bob = DiffieHellman.generateKeys();
        const shared = DiffieHellman.computeSharedSecret(alice.privateKey, bob.publicKey);
        const sharedNum = BigInt('0x' + shared.toString('hex'));
        const expectedNum = modPow(bob.publicKey, alice.privateKey, defaultP);
        assert.strictEqual(sharedNum, expectedNum, 'Shared secret BigInt mismatch');
    });

    test('strict mode accepts default prime', () => {
        assert.doesNotThrow(() => DiffieHellman.validateDhParams(defaultP, defaultG, true), 'Strict mode should accept RFC 3526 Group 14 prime');
    });

    test('reject non-2048-bit primes', () => {
        const tooSmallPrime = (1n << 2047n) - 1n;
        assert.throws(() => DiffieHellman.validateDhParams(tooSmallPrime, defaultG), /not a 2048-bit number/, 'Prime with <2048 bits must be rejected');
        const tooLargePrime = (1n << 2048n) + 1n;
        assert.throws(() => DiffieHellman.validateDhParams(tooLargePrime, defaultG), /not a 2048-bit number/, 'Prime with >2048 bits must be rejected');
    });

    test('wipePrivateKey zeroes all fields', () => {
        const keys = DiffieHellman.generateKeys();
        assert.ok(keys.privateKey > 0n, 'private key before wipe');
        assert.ok(keys.privateKeyBuf.some((b: number) => b !== 0), 'private key buf before wipe');
        DiffieHellman.wipePrivateKey(keys);
        assert.strictEqual(keys.privateKey, 0n, 'private key wiped');
        assert.strictEqual(keys.publicKey, 0n, 'public key wiped');
        assert.ok(keys.privateKeyBuf.every((b: number) => b === 0), 'private key buf zeroed');
    });
});
