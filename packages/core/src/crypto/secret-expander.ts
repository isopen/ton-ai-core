import { createHmac } from 'crypto';

export class SecretExpander {
  static expandSecret(secret: Buffer): Buffer {
    const hmac0 = createHmac('sha512', secret).update('0').digest();
    const hmac1 = createHmac('sha512', secret).update('1').digest();
    return Buffer.concat([hmac0, hmac1]);
  }
}
