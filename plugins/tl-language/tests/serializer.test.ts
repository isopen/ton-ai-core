import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { TLSerializer, TLDeserializer } from '../src/index';

describe('TL Serialization Roundtrip', () => {
    test('int32 roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeInt32(42);
        ser.writeInt32(-100);
        ser.writeInt32(0);
        ser.writeInt32(2147483647);
        ser.writeInt32(-2147483648);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readInt32(), 42);
        assert.strictEqual(deser.readInt32(), -100);
        assert.strictEqual(deser.readInt32(), 0);
        assert.strictEqual(deser.readInt32(), 2147483647);
        assert.strictEqual(deser.readInt32(), -2147483648);
    });

    test('uint32 roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeUint32(0);
        ser.writeUint32(0xDEADBEEF);
        ser.writeUint32(0xFFFFFFFF);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readUint32(), 0);
        assert.strictEqual(deser.readUint32(), 0xDEADBEEF);
        assert.strictEqual(deser.readUint32(), 0xFFFFFFFF);
    });

    test('int64 roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeInt64(0n);
        ser.writeInt64(123456789012345n);
        ser.writeInt64(-1n);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readInt64(), 0n);
        assert.strictEqual(deser.readInt64(), 123456789012345n);
        assert.strictEqual(deser.readInt64(), 0xFFFFFFFFFFFFFFFFn);
    });

    test('int128 roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeInt128(0n);
        ser.writeInt128(0x0102030405060708090A0B0C0D0E0F10n);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readInt128(), 0n);
        assert.strictEqual(deser.readInt128(), 0x0102030405060708090A0B0C0D0E0F10n);
    });

    test('int256 roundtrip', () => {
        const ser = new TLSerializer();
        const val = Buffer.alloc(32);
        val.fill(0xAB);
        ser.writeInt256(val);

        const deser = new TLDeserializer(ser.toBuffer());
        const result = deser.readInt256();
        assert.ok(result.equals(val));
    });

    test('int256 wrong length throws', () => {
        const ser = new TLSerializer();
        assert.throws(() => ser.writeInt256(Buffer.alloc(16)), /int256 requires exactly 32 bytes/);
    });

    test('bool roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeBool(true);
        ser.writeBool(false);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readBool(), true);
        assert.strictEqual(deser.readBool(), false);
    });

    test('boolTrue/boolFalse constructors', () => {
        const ser = new TLSerializer();
        ser.writeBoolTrue();
        ser.writeBoolFalse();

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readBool(), true);
        assert.strictEqual(deser.readBool(), false);
    });

    test('bytes roundtrip short (<254)', () => {
        const ser = new TLSerializer();
        const data = Buffer.from('hello');
        ser.writeBytes(data);

        const deser = new TLDeserializer(ser.toBuffer());
        const result = deser.readBytes();
        assert.ok(result.equals(data));
    });

    test('bytes roundtrip long (>=254)', () => {
        const ser = new TLSerializer();
        const data = Buffer.alloc(300, 0x42);
        ser.writeBytes(data);

        const deser = new TLDeserializer(ser.toBuffer());
        const result = deser.readBytes();
        assert.ok(result.equals(data));
    });

    test('bytes roundtrip exact 254', () => {
        const ser = new TLSerializer();
        const data = Buffer.alloc(254, 0xFF);
        ser.writeBytes(data);

        const deser = new TLDeserializer(ser.toBuffer());
        const result = deser.readBytes();
        assert.ok(result.equals(data));
    });

    test('bytes too long throws', () => {
        const ser = new TLSerializer();
        assert.throws(() => ser.writeBytes(Buffer.alloc(0x1000000)), /exceeds TL bytes maximum/);
    });

    test('string roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeString('hello world');

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readString(), 'hello world');
    });

    test('string with unicode', () => {
        const ser = new TLSerializer();
        ser.writeString('привет мир');

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readString(), 'привет мир');
    });

    test('vectorInt32 roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeVectorInt32([1, 2, 3, 4, 5]);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.deepStrictEqual(deser.readVectorInt32(), [1, 2, 3, 4, 5]);
    });

    test('vectorInt64 roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeVectorInt64([1n, 2n, 3n]);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.deepStrictEqual(deser.readVectorInt64(), [1n, 2n, 3n]);
    });

    test('vectorString roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeVectorString(['hello', 'world']);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.deepStrictEqual(deser.readVectorString(), ['hello', 'world']);
    });

    test('vectorBytes roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeVectorBytes([Buffer.from('a'), Buffer.from('bb'), Buffer.from('ccc')]);

        const deser = new TLDeserializer(ser.toBuffer());
        const result = deser.readVectorBytes();
        assert.strictEqual(result.length, 3);
        assert.ok(result[0].equals(Buffer.from('a')));
        assert.ok(result[1].equals(Buffer.from('bb')));
        assert.ok(result[2].equals(Buffer.from('ccc')));
    });

    test('constructorId roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeConstructorId(0xDEADBEEF);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readUint32(), 0xDEADBEEF);
    });

    test('multiple fields roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeConstructorId(0x12345678);
        ser.writeInt32(42);
        ser.writeInt64(123n);
        ser.writeBytes(Buffer.from('test'));

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readUint32(), 0x12345678);
        assert.strictEqual(deser.readInt32(), 42);
        assert.strictEqual(deser.readInt64(), 123n);
        assert.ok(deser.readBytes().equals(Buffer.from('test')));
    });

    test('buffer underflow throws', () => {
        const deser = new TLDeserializer(Buffer.alloc(2));
        assert.throws(() => deser.readInt32(), /Buffer underflow/);
    });

    test('readBool invalid constructor throws', () => {
        const ser = new TLSerializer();
        ser.writeUint32(0xDEADBEEF);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.throws(() => deser.readBool(), /Invalid bool constructor/);
    });

    test('readVectorInt32 invalid constructor throws', () => {
        const ser = new TLSerializer();
        ser.writeUint32(0xDEADBEEF);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.throws(() => deser.readVectorInt32(), /Invalid vector constructor/);
    });

    test('readVectorInt64 invalid constructor throws', () => {
        const ser = new TLSerializer();
        ser.writeUint32(0xDEADBEEF);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.throws(() => deser.readVectorInt64(), /Invalid vector constructor/);
    });

    test('readVectorString invalid constructor throws', () => {
        const ser = new TLSerializer();
        ser.writeUint32(0xDEADBEEF);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.throws(() => deser.readVectorString(), /Invalid vector constructor/);
    });

    test('readVectorBytes invalid constructor throws', () => {
        const ser = new TLSerializer();
        ser.writeUint32(0xDEADBEEF);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.throws(() => deser.readVectorBytes(), /Invalid vector constructor/);
    });

    test('readGenericVector roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeGenericVector((v: number) => ser.writeInt32(v), [10, 20, 30]);

        const deser = new TLDeserializer(ser.toBuffer());
        const result = deser.readGenericVector(() => deser.readInt32());
        assert.deepStrictEqual(result, [10, 20, 30]);
    });

    test('writeConstructorByName roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeConstructorByName('test');
        const buf = ser.toBuffer();
        assert.strictEqual(buf.length, 4, 'constructor id is 4 bytes');
    });

    test('reset clears buffer', () => {
        const ser = new TLSerializer();
        ser.writeInt32(42);
        assert.strictEqual(ser.length, 4);
        ser.reset();
        assert.strictEqual(ser.length, 0);
    });

    test('toBuffer returns correct slice', () => {
        const ser = new TLSerializer();
        ser.writeInt32(1);
        ser.writeInt32(2);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.length, 8);
    });

    test('readRawBytes roundtrip', () => {
        const data = Buffer.from([1, 2, 3, 4, 5]);
        const ser = new TLSerializer();
        ser.writeBytesRaw(data);

        const deser = new TLDeserializer(ser.toBuffer());
        const result = deser.readRawBytes(5);
        assert.ok(result.equals(data));
    });

    test('readInt32Raw roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeInt32Raw(42);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readInt32Raw(), 42);
    });

    test('readInt64Raw roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeInt64Raw(123n);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readInt64Raw(), 123n);
    });

    test('readUint32Raw roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeUint32Raw(42);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readUint32Raw(), 42);
    });

    test('remaining and position getters', () => {
        const ser = new TLSerializer();
        ser.writeInt32(1);
        ser.writeInt32(2);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.remaining, 8);
        assert.strictEqual(deser.position, 0);
        deser.readInt32();
        assert.strictEqual(deser.remaining, 4);
        assert.strictEqual(deser.position, 4);
        assert.strictEqual(deser.totalLength, 8);
    });

    test('writeInt128 with large value', () => {
        const ser = new TLSerializer();
        ser.writeInt128(0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readInt128(), 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn);
    });

    test('writeInt256 roundtrip', () => {
        const ser = new TLSerializer();
        const val = Buffer.alloc(32);
        val[0] = 0x01;
        val[31] = 0xFF;
        ser.writeInt256(val);

        const deser = new TLDeserializer(ser.toBuffer());
        const result = deser.readInt256();
        assert.strictEqual(result[0], 0x01);
        assert.strictEqual(result[31], 0xFF);
    });

    test('writeBool true and false', () => {
        const ser = new TLSerializer();
        ser.writeBool(true);
        ser.writeBool(false);

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readBool(), true);
        assert.strictEqual(deser.readBool(), false);
    });

    test('writeBytes with padding alignment', () => {
        const ser = new TLSerializer();
        ser.writeBytes(Buffer.alloc(1));

        const deser = new TLDeserializer(ser.toBuffer());
        const result = deser.readBytes();
        assert.strictEqual(result.length, 1);
    });

    test('writeString with empty string', () => {
        const ser = new TLSerializer();
        ser.writeString('');

        const deser = new TLDeserializer(ser.toBuffer());
        assert.strictEqual(deser.readString(), '');
    });

    test('readUnencryptedMessage roundtrip', () => {
        const ser = new TLSerializer();
        ser.writeInt64(0x1234567890ABCDEFn);
        ser.writeInt64(0xDEADBEEFCAFEBABEn);
        ser.writeInt32(16);
        ser.writeBytes(Buffer.alloc(16, 0x42));

        const deser = new TLDeserializer(ser.toBuffer());
        const msg = deser.readUnencryptedMessage();
        assert.strictEqual(msg.authKeyId, 0x1234567890ABCDEFn);
        assert.strictEqual(msg.messageId, 0xDEADBEEFCAFEBABEn);
        assert.strictEqual(msg.dataLength, 16);
    });
});
