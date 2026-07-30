import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { abridgedEncode, abridgedDecodeLength, intermediateEncode, intermediateDecodeLength, generateObfuscationInit, aes256CtrProcess } from '../src/obfuscation-utils';

test('abridgedEncode small data (< 0x7F ints)', () => {
  const data = Buffer.alloc(8);
  data.writeUInt32LE(0xDEADBEEF, 0);
  data.writeUInt32LE(0xCAFEBABE, 4);
  const encoded = abridgedEncode(data);
  assert.strictEqual(encoded.length, 9);
  assert.strictEqual(encoded[0], 2);
  assert.strictEqual(encoded.readUInt32LE(1), 0xDEADBEEF);
});

test('abridgedEncode large data (>= 0x7F ints)', () => {
  const data = Buffer.alloc(512);
  const encoded = abridgedEncode(data);
  assert.strictEqual(encoded.length, 516);
  assert.strictEqual(encoded[0], 0x7F);
  const intsLen = (encoded[1]) | (encoded[2] << 8) | (encoded[3] << 16);
  assert.strictEqual(intsLen, 128);
});

test('abridgedDecodeLength small packet', () => {
  const header = Buffer.alloc(1);
  header[0] = 0x05;
  const len = abridgedDecodeLength(header);
  assert.strictEqual(len, 21);
});

test('abridgedDecodeLength large packet', () => {
  const header = Buffer.alloc(4);
  header[0] = 0x7F;
  header[1] = 0x80;
  header[2] = 0x00;
  header[3] = 0x00;
  const len = abridgedDecodeLength(header);
  assert.strictEqual(len, 516);
});

test('abridgedDecodeLength incomplete buffer returns null', () => {
  assert.strictEqual(abridgedDecodeLength(Buffer.alloc(0)), null);
  assert.strictEqual(abridgedDecodeLength(Buffer.from([0x7F, 0x00, 0x00])), null);
});

test('abridgedDecodeLength invalid first byte returns -1', () => {
  assert.strictEqual(abridgedDecodeLength(Buffer.from([0x00])), -1);
  assert.strictEqual(abridgedDecodeLength(Buffer.from([0xFF])), -1);
});

test('abridgedDecodeLength 0x7F with ints < 0x7F returns null', () => {
  const header = Buffer.alloc(4);
  header[0] = 0x7F;
  header[1] = 0x01;
  header[2] = 0x00;
  header[3] = 0x00;
  assert.strictEqual(abridgedDecodeLength(header), null);
});

test('abridgedEncode + abridgedDecodeLength roundtrip small', () => {
  const data = Buffer.alloc(16);
  const encoded = abridgedEncode(data);
  const decoded = abridgedDecodeLength(encoded);
  assert.strictEqual(decoded, data.length + 1);
});

test('abridgedEncode + abridgedDecodeLength roundtrip large', () => {
  const data = Buffer.alloc(1024);
  const encoded = abridgedEncode(data);
  const decoded = abridgedDecodeLength(encoded);
  assert.strictEqual(decoded, data.length + 4);
});

test('intermediateEncode adds 4-byte length prefix', () => {
  const data = Buffer.from([0x01, 0x02, 0x03]);
  const encoded = intermediateEncode(data);
  assert.strictEqual(encoded.length, 7);
  assert.strictEqual(encoded.readUInt32LE(0), 3);
  assert.strictEqual(encoded[4], 0x01);
});

test('intermediateDecodeLength normal packet', () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(100, 0);
  assert.strictEqual(intermediateDecodeLength(header), 104);
});

test('intermediateDecodeLength incomplete buffer', () => {
  assert.strictEqual(intermediateDecodeLength(Buffer.alloc(0)), null);
  assert.strictEqual(intermediateDecodeLength(Buffer.alloc(3)), null);
});

test('intermediateDecodeLength oversized packet returns -1', () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(0x01000001, 0);
  assert.strictEqual(intermediateDecodeLength(header), -1);
});

test('intermediateEncode + intermediateDecodeLength roundtrip', () => {
  const data = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55]);
  const encoded = intermediateEncode(data);
  const decoded = intermediateDecodeLength(encoded);
  assert.strictEqual(decoded, data.length + 4);
});

test('generateObfuscationInit returns valid structure', () => {
  const result = generateObfuscationInit();
  assert.ok(result.init);
  assert.ok(result.obf);
  assert.ok(result.keys);
  assert.strictEqual(result.init.length, 64);
  assert.strictEqual(result.obf.length, 64);
  assert.strictEqual(result.keys.encryptKey.length, 32);
  assert.strictEqual(result.keys.encryptIv.length, 16);
});

test('generateObfuscationInit init does not start with 0xef', () => {
  for (let i = 0; i < 100; i++) {
    const result = generateObfuscationInit();
    assert.notStrictEqual(result.init[0], 0xef);
  }
});

test('aes256CtrProcess with counter > 0 covers carry loop', () => {
  const key = Buffer.alloc(32, 0x01);
  const iv = Buffer.alloc(16, 0x02);
  const data = Buffer.alloc(32, 0x03);
  const result = aes256CtrProcess(data, key, iv, 1);
  assert.strictEqual(result.length, 32);
  assert.notDeepStrictEqual(result, data);
});

test('abridgedDecodeLength incomplete 0x7F header', () => {
  const header = Buffer.alloc(2);
  header[0] = 0x7F;
  assert.strictEqual(abridgedDecodeLength(header), null);
});

test('generateObfuscationInit handles forbidden random values', () => {
  const getRandomBytesMock = jest.spyOn(crypton, 'getRandomBytes');

  const makeBuf = (firstByte: number, firstU32: number, fifthU32: number) => {
    const b = Buffer.alloc(64, 0x00);
    b[0] = firstByte;
    b.writeUInt32LE(firstU32, 0);
    b.writeUInt32LE(fifthU32, 4);
    return b;
  };

  const buf1 = makeBuf(0xef, 0, 0);
  const buf2 = makeBuf(0x01, 0x44414548, 0);
  const buf3 = makeBuf(0x01, 0x44414549, 0);
  const buf4 = makeBuf(0x01, 0x44414549, 1);

  getRandomBytesMock
    .mockReturnValueOnce(buf1)
    .mockReturnValueOnce(buf2)
    .mockReturnValueOnce(buf3)
    .mockReturnValueOnce(buf4);

  const result = generateObfuscationInit();
  assert.ok(result);

  getRandomBytesMock.mockRestore();
});
