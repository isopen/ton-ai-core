import { strict as assert } from 'assert';
import { DiffieHellman } from '../diffie-hellman';
import { modPow } from '../utils';

async function run() {
    const min = 1n << (2048n - 64n);
    const defaultP = DiffieHellman['DEFAULT_P'];
    const defaultG = 2n;

    // 1. generateKeys with default parameters
    const keys = DiffieHellman.generateKeys();
    assert.ok(keys.privateKey > 0n, 'Private key must be > 0');
    assert.ok(keys.publicKey > 0n, 'Public key must be > 0');
    assert.ok(keys.privateKey >= min && keys.privateKey <= defaultP - min,
        'Private key range invalid');
    assert.ok(keys.publicKey > 1n && keys.publicKey < defaultP - 1n,
        'Public key range invalid');

    // 2. Shared secret consistency
    const alice = DiffieHellman.generateKeys();
    const bob = DiffieHellman.generateKeys();
    const sA = DiffieHellman.computeSharedSecret(alice.privateKey, bob.publicKey);
    const sB = DiffieHellman.computeSharedSecret(bob.privateKey, alice.publicKey);
    assert.ok(sA.equals(sB), 'Shared secrets must match');
    assert.strictEqual(sA.length, 256, 'Shared secret must be 256 bytes');

    // 3. validatePublicKey with default p
    assert.throws(() => DiffieHellman.validatePublicKey(0n), 'Public key 0 should throw');
    assert.throws(() => DiffieHellman.validatePublicKey(defaultP), 'Public key p should throw');
    assert.throws(() => DiffieHellman.validatePublicKey(min - 1n), 'Too small public key should throw');
    assert.throws(
        () => DiffieHellman.validatePublicKey(defaultP - min + 1n),
        'Too large public key should throw'
    );
    assert.doesNotThrow(() => DiffieHellman.validatePublicKey(min), 'Min valid public key should pass');
    assert.doesNotThrow(
        () => DiffieHellman.validatePublicKey(defaultP - min),
        'Max valid public key should pass'
    );

    // 4. validatePublicKey with custom p
    assert.doesNotThrow(() => DiffieHellman.validatePublicKey(min, defaultP));
    assert.throws(() => DiffieHellman.validatePublicKey(0n, defaultP));

    // 5. validateDhParams – rejects non‑2048‑bit primes
    assert.throws(() => DiffieHellman.validateDhParams(23n, 2n), 'Small p should throw');
    assert.throws(() => DiffieHellman.validateDhParams(defaultP, 1n), 'g=1 should throw');
    assert.throws(
        () => DiffieHellman.validateDhParams(defaultP, defaultP - 1n),
        'g=p-1 should throw'
    );
    // Default Telegram prime with g=2 must be accepted in non-strict mode
    assert.doesNotThrow(
        () => DiffieHellman.validateDhParams(defaultP, defaultG),
        'Real Telegram (p,g) pair must be accepted'
    );

    // 6. generateKeys with custom and default parameters
    assert.doesNotThrow(() => DiffieHellman.generateKeys(defaultP, defaultG));
    const customKeys = DiffieHellman.generateKeys(defaultP, defaultG);
    assert.ok(customKeys.privateKey >= min && customKeys.privateKey <= defaultP - min);

    assert.throws(() => DiffieHellman.generateKeys(23n, 2n), 'Invalid p should throw');
    assert.throws(() => DiffieHellman.generateKeys(defaultP, 1n), 'Invalid g should throw');

    // 7. computeSharedSecret with explicit p
    const alice2 = DiffieHellman.generateKeys(defaultP, defaultG);
    const bob2 = DiffieHellman.generateKeys(defaultP, defaultG);
    const secretCustom = DiffieHellman.computeSharedSecret(alice2.privateKey, bob2.publicKey, defaultP);
    const secretDefault = DiffieHellman.computeSharedSecret(alice2.privateKey, bob2.publicKey);
    assert.ok(secretCustom.equals(secretDefault), 'Explicit and default p must give same secret');

    // 8. computePublicKey with default and custom parameters
    const pubDefault = DiffieHellman.computePublicKey(alice.privateKey);
    const pubCustom = DiffieHellman.computePublicKey(alice.privateKey, defaultP, defaultG);
    assert.strictEqual(pubDefault, pubCustom, 'Public key must be consistent');

    // 9. computeSharedSecret rejects invalid peer key
    assert.throws(
        () => DiffieHellman.computeSharedSecret(alice.privateKey, 0n),
        'Peer key 0 should throw'
    );
    assert.throws(
        () => DiffieHellman.computeSharedSecret(alice.privateKey, defaultP),
        'Peer key p should throw'
    );

    // 10. Shared secret matches manual modular exponentiation
    const shared = DiffieHellman.computeSharedSecret(alice.privateKey, bob.publicKey);
    const sharedNum = BigInt('0x' + shared.toString('hex'));
    const expectedNum = modPow(bob.publicKey, alice.privateKey, defaultP);
    assert.strictEqual(sharedNum, expectedNum, 'Shared secret BigInt mismatch');

    // 11. Strict mode rejects default Telegram prime because p mod 8 != 7
    assert.throws(
        () => DiffieHellman.validateDhParams(defaultP, defaultG, true),
        'Strict mode must reject default p because p mod 8 != 7'
    );

    // 12. New bit-length check: reject primes that are not 2^2047 < p < 2^2048
    const tooSmallPrime = (1n << 2047n) - 1n;   // 2047 bits
    assert.throws(
        () => DiffieHellman.validateDhParams(tooSmallPrime, defaultG),
        /not a 2048-bit number/,
        'Prime with <2048 bits must be rejected'
    );
    const tooLargePrime = (1n << 2048n) + 1n;   // 2049 bits
    assert.throws(
        () => DiffieHellman.validateDhParams(tooLargePrime, defaultG),
        /not a 2048-bit number/,
        'Prime with >2048 bits must be rejected'
    );

    console.log('DiffieHellman tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
