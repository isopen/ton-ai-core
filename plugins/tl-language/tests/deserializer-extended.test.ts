import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { SchemaDeserializer, deserializeWithSchema } from '../src/deserializer';
import { SchemaSerializer } from '../src/serializer';
import { SchemaRegistry } from '../src/registry';
import { VECTOR_ID } from '../src/types';

const TEST_SCHEMA = `
int ? = Int;
long ? = Long;
double ? = Double;
string ? = String;
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
null = Null;
vector {t:Type} # [ t ] = Vector t;
user#d23c81a3 id:int first_name:string last_name:string = User;
no_user#c67599d1 id:int = User;
group id:int title:string = Group;
point2d x:int y:int = Point2d;
pair x:Object y:Object = Pair;
`;

describe('SchemaDeserializer Extended', () => {
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry(TEST_SCHEMA);
    });

    test('readBoxedObject returns null for empty buffer', () => {
        const deser = new SchemaDeserializer(Buffer.alloc(0), registry);
        assert.strictEqual(deser.readBoxedObject(), null);
    });

    test('readBoxedObject returns null for <4 bytes', () => {
        const deser = new SchemaDeserializer(Buffer.alloc(3), registry);
        assert.strictEqual(deser.readBoxedObject(), null);
    });

    test('readBoxedObject with unknown constructor', () => {
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(0xdeadbeef, 0);
        const deser = new SchemaDeserializer(buf, registry);
        const result = deser.readBoxedObject();
        assert.ok(result !== null);
        assert.strictEqual(result!.typeName, 'Unknown');
    });

    test('readBoxedObject with vector constructor', () => {
        const ser = new SchemaSerializer(registry);
        ser.writeUint32(VECTOR_ID);
        ser.writeInt32(2);
        ser.writeInt32(10);
        ser.writeInt32(20);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readBoxedObject();
        assert.ok(result !== null);
        assert.strictEqual(result!.constructorId, VECTOR_ID);
        assert.strictEqual(result!.typeName, 'Vector');
        assert.strictEqual(result!.fields.count, 2);
    });

    test('readFieldValue with conditional field present', () => {
        const ser = new SchemaSerializer(registry);
        ser.writeUint32(0xd23c81a3);
        ser.writeInt32(1);
        ser.writeString('John');
        ser.writeString('Doe');

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readBoxedObject();
        assert.ok(result !== null);
        assert.strictEqual(result!.fields.id, 1);
        assert.strictEqual(result!.fields.first_name, 'John');
        assert.strictEqual(result!.fields.last_name, 'Doe');
    });

    test('readFieldValue with conditional field absent', () => {
        const ser = new SchemaSerializer(registry);
        ser.writeUint32(0xc67599d1);
        ser.writeInt32(42);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readBoxedObject();
        assert.ok(result !== null);
        assert.strictEqual(result!.fields.id, 42);
    });

    test('readFieldValue with int type', () => {
        const ser = new SchemaSerializer();
        ser.writeInt32(42);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('int');
        assert.strictEqual(result, 42);
    });

    test('readFieldValue with long type', () => {
        const ser = new SchemaSerializer();
        ser.writeInt64(123n);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('long');
        assert.strictEqual(result, 123n);
    });

    test('readFieldValue with double type', () => {
        const buf = Buffer.alloc(8);
        buf.writeDoubleLE(3.14, 0);
        const deser = new SchemaDeserializer(buf, registry);
        const result = deser.readFieldValue('double');
        assert.ok(Math.abs(result as number - 3.14) < 0.001);
    });

    test('readFieldValue with string type', () => {
        const ser = new SchemaSerializer();
        ser.writeString('hello');

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('string');
        assert.strictEqual(result, 'hello');
    });

    test('readFieldValue with bool type true', () => {
        const ser = new SchemaSerializer();
        ser.writeBoolTrue();

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('bool');
        assert.strictEqual(result, true);
    });

    test('readFieldValue with bool type false', () => {
        const ser = new SchemaSerializer();
        ser.writeBoolFalse();

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('bool');
        assert.strictEqual(result, false);
    });

    test('readFieldValue with true literal', () => {
        const deser = new SchemaDeserializer(Buffer.alloc(0), registry);
        const result = deser.readFieldValue('true');
        assert.strictEqual(result, true);
    });

    test('readFieldValue with false literal', () => {
        const deser = new SchemaDeserializer(Buffer.alloc(0), registry);
        const result = deser.readFieldValue('false');
        assert.strictEqual(result, false);
    });

    test('readFieldValue with int128 type', () => {
        const ser = new SchemaSerializer();
        ser.writeInt128(0x0102030405060708090A0B0C0D0E0F10n);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('int128');
        assert.strictEqual(result, 0x0102030405060708090A0B0C0D0E0F10n);
    });

    test('readFieldValue with int256 type', () => {
        const ser = new SchemaSerializer();
        const val = Buffer.alloc(32);
        val.fill(0xAB);
        ser.writeInt256(val);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('int256');
        assert.ok(Buffer.isBuffer(result));
        assert.strictEqual(result.length, 32);
    });

    test('readFieldValue with bytes type', () => {
        const ser = new SchemaSerializer();
        ser.writeBytes(Buffer.from('test'));

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('bytes');
        assert.ok(Buffer.isBuffer(result));
        assert.ok(result.equals(Buffer.from('test')));
    });

    test('readFieldValue with Object type', () => {
        const ser = new SchemaSerializer();
        ser.writeUint32(0xc67599d1);
        ser.writeInt32(1);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('Object');
        assert.ok(result !== null);
        assert.ok(typeof result === 'object');
    });

    test('readFieldValue with null type', () => {
        const deser = new SchemaDeserializer(Buffer.alloc(0), registry);
        const result = deser.readFieldValue('null');
        assert.strictEqual(result, null);
    });

    test('readFieldValue with vector type', () => {
        const ser = new SchemaSerializer();
        ser.writeUint32(VECTOR_ID);
        ser.writeInt32(2);
        ser.writeInt32(10);
        ser.writeInt32(20);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('vector');
        assert.ok(Array.isArray(result));
        assert.strictEqual(result.length, 2);
    });

    test('readFieldValue with unknown type falls back to readBoxedObject', () => {
        const ser = new SchemaSerializer();
        ser.writeUint32(0xc67599d1);
        ser.writeInt32(1);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('SomeUnknown');
        assert.ok(result !== null);
    });

    test('readFieldValue with conditional bit set reads field', () => {
        const ser = new SchemaSerializer();
        ser.writeString('hello');

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readFieldValue('string', { flags: 1 }, 0, 'flags');
        assert.strictEqual(result, 'hello');
    });

    test('readFieldValue with conditional bit not set returns undefined', () => {
        const deser = new SchemaDeserializer(Buffer.alloc(0), registry);
        const result = deser.readFieldValue('string', 0, 0, 'flags');
        assert.strictEqual(result, undefined);
    });

    test('deserializeWithSchema', () => {
        const ser = new SchemaSerializer();
        ser.writeUint32(0xc67599d1);
        ser.writeInt32(42);

        const result = deserializeWithSchema(ser.toBuffer(), registry);
        assert.ok(result !== null);
        assert.strictEqual(result!.fields.id, 42);
    });

    test('readGenericVector', () => {
        const ser = new SchemaSerializer();
        ser.writeUint32(VECTOR_ID);
        ser.writeInt32(2);
        ser.writeInt32(10);
        ser.writeInt32(20);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readGenericVector(() => deser.readInt32());
        assert.ok(Array.isArray(result));
        assert.deepStrictEqual(result, [10, 20]);
    });

    test('readGenericVector invalid constructor throws', () => {
        const ser = new SchemaSerializer();
        ser.writeUint32(0xdeadbeef);
        ser.writeInt32(2);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        assert.throws(() => deser.readGenericVector(() => 0), /Invalid vector constructor/);
    });

    test('remaining and position', () => {
        const ser = new SchemaSerializer();
        ser.writeInt32(1);
        ser.writeInt32(2);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        assert.strictEqual(deser.remaining, 8);
        assert.strictEqual(deser.position, 0);
        assert.strictEqual(deser.totalLength, 8);
        deser.readInt32();
        assert.strictEqual(deser.remaining, 4);
        assert.strictEqual(deser.position, 4);
    });

    test('readUnencryptedMessage roundtrip', () => {
        const ser = new SchemaSerializer();
        ser.writeInt64(0x1234567890ABCDEFn);
        ser.writeInt64(0xDEADBEEFCAFEBABEn);
        ser.writeInt32(16);
        ser.writeBytes(Buffer.alloc(16, 0x42));

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const msg = deser.readUnencryptedMessage();
        assert.strictEqual(msg.authKeyId, 0x1234567890ABCDEFn);
        assert.strictEqual(msg.messageId, 0xDEADBEEFCAFEBABEn);
        assert.strictEqual(msg.dataLength, 16);
    });
});
