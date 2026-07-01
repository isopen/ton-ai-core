"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultPublicRsaKey = void 0;
const core_1 = require("@ton-ai/core");
class DefaultPublicRsaKey {
    keys = new Map();
    constructor(pemKeys) {
        for (const pem of pemKeys) {
            const { modulus, exponent } = core_1.crypton.pemToBigInts(pem);
            const fingerprint = core_1.crypton.rsaFingerprint(modulus, exponent);
            this.keys.set(fingerprint, { pem, modulus, exponent, fingerprint });
        }
    }
    getRsaKey(fingerprints) {
        for (const fp of fingerprints) {
            const key = this.keys.get(fp);
            if (key)
                return key;
        }
        return null;
    }
    dropKeys() {
        this.keys.clear();
    }
    getFingerprints() {
        return Array.from(this.keys.keys());
    }
}
exports.DefaultPublicRsaKey = DefaultPublicRsaKey;
//# sourceMappingURL=public-rsa-key.js.map