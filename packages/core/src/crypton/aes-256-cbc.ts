import { AES256ECB } from './aes-256-ecb';

export class AES256CBC {
    static encrypt(plaintext: Buffer, key: Buffer, iv: Buffer): Buffer {
        if (key.length !== 32) throw new Error('AES-256 requires a 32-byte key');
        if (iv.length !== 16) throw new Error('IV must be 16 bytes');
        if (plaintext.length % 16 !== 0) throw new Error('Plaintext must be multiple of 16 bytes');

        const ecb = new AES256ECB(key);
        const result = Buffer.alloc(plaintext.length);
        const prev = Buffer.from(iv);

        try {
            for (let i = 0; i < plaintext.length; i += 16) {
                const block = Buffer.alloc(16);
                for (let j = 0; j < 16; j++) block[j] = plaintext[i + j] ^ prev[j];
                const enc = ecb.encryptBlock(block);
                enc.copy(result, i);
                enc.copy(prev, 0, 0, 16);
            }
        } finally {
            ecb.destroy();
        }

        return result;
    }

    static decrypt(ciphertext: Buffer, key: Buffer, iv: Buffer): Buffer {
        if (key.length !== 32) throw new Error('AES-256 requires a 32-byte key');
        if (iv.length !== 16) throw new Error('IV must be 16 bytes');
        if (ciphertext.length % 16 !== 0) throw new Error('Ciphertext must be multiple of 16 bytes');

        const ecb = new AES256ECB(key);
        const result = Buffer.alloc(ciphertext.length);
        const prev = Buffer.from(iv);

        try {
            for (let i = 0; i < ciphertext.length; i += 16) {
                const block = ciphertext.subarray(i, i + 16);
                const dec = ecb.decryptBlock(block);
                for (let j = 0; j < 16; j++) result[i + j] = dec[j] ^ prev[j];
                block.copy(prev, 0, 0, 16);
            }
        } finally {
            ecb.destroy();
        }

        return result;
    }
}
