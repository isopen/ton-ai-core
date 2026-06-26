import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { SchemaSerializer } from '../src/serializer';
import { SchemaRegistry } from '../src/registry';

const TEST_SCHEMA = `
int ? = Int;
long ? = Long;
double ? = Double;
string ? = String;
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
vector {t:Type} # [ t ] = Vector t;
user#d23c81a3 id:int first_name:string last_name:string = User;
no_user#c67599d1 id:int = User;
group id:int title:string = Group;
point2d x:int y:int = Point2d;
pair x:Object y:Object = Pair;
`;

describe('SchemaSerializer Extended', () => {
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry(TEST_SCHEMA);
    });

    test('writeFieldValue with int type', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('int', 42);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readInt32LE(0), 42);
    });

    test('writeFieldValue with long type', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('long', 123n);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.length, 8);
    });

    test('writeFieldValue with double type', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('double', 3.14);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.length, 8);
    });

    test('writeFieldValue with string type (string value)', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('string', 'hello');
        const buf = ser.toBuffer();
        assert.ok(buf.length > 0);
    });

    test('writeFieldValue with string type (buffer value)', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('string', Buffer.from('hello'));
        const buf = ser.toBuffer();
        assert.ok(buf.length > 0);
    });

    test('writeFieldValue with bool type', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('bool', true);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readUInt32LE(0), 0x997275b5);
    });

    test('writeFieldValue with vector type (number array)', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('vector', [1, 2, 3]);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        assert.strictEqual(buf.readInt32LE(4), 3);
    });

    test('writeFieldValue with vector type (bigint array)', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('vector', [1n, 2n]);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
    });

    test('writeFieldValue with vector type (buffer array)', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('vector', [Buffer.from('a'), Buffer.from('bb')]);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
    });

    test('writeFieldValue with int128 type', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('int128', 0x0102030405060708090A0B0C0D0E0F10n);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.length, 16);
    });

    test('writeFieldValue with int256 type', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('int256', Buffer.alloc(32, 0xAB));
        const buf = ser.toBuffer();
        assert.strictEqual(buf.length, 32);
    });

    test('writeFieldValue with bytes type', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('bytes', Buffer.from('test'));
        const buf = ser.toBuffer();
        assert.ok(buf.length > 0);
    });

    test('writeFieldValue with true literal', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('true', null);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readUInt32LE(0), 0x997275b5);
    });

    test('writeFieldValue with false literal', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('false', null);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readUInt32LE(0), 0xbc799737);
    });

    test('writeFieldValue with unknown type and number value', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('SomeType', 42);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readInt32LE(0), 42);
    });

    test('writeFieldValue with unknown type and bigint value', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('SomeType', 123n);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.length, 8);
    });

    test('writeFieldValue with unknown type and buffer value', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('SomeType', Buffer.from('test'));
        const buf = ser.toBuffer();
        assert.ok(buf.length > 0);
    });

    test('writeFieldValue with unknown type and string value', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('SomeType', 'hello');
        const buf = ser.toBuffer();
        assert.ok(buf.length > 0);
    });

    test('writeFieldValue with repetition type', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('repetition:3*int', [1, 2, 3]);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readInt32LE(0), 1);
        assert.strictEqual(buf.readInt32LE(4), 2);
        assert.strictEqual(buf.readInt32LE(8), 3);
    });

    test('writeFieldValue with repetition type no multiplicity', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('repetition:int', [1, 2]);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readInt32LE(0), 1);
    });

    test('writeFieldValue with bang prefix', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('!int', 42);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readInt32LE(0), 42);
    });

    test('writeFieldValue with Vector type', () => {
        const ser = new SchemaSerializer(registry);
        (ser as any).writeFieldValue('Vector', [1, 2]);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
    });

    test('writeGenericVector', () => {
        const ser = new SchemaSerializer(registry);
        ser.writeGenericVector((v: number) => (ser as any).writeFieldValue('int', v), [1, 2, 3]);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        assert.strictEqual(buf.readInt32LE(4), 3);
    });

    test('serializeCombinator with conditional fields', () => {
        const comb = registry.findConstructorByName('user');
        assert.ok(comb !== undefined);
        const buf = registry.serialize
            ? (registry as any).serialize(comb, { id: 1, first_name: 'John', last_name: 'Doe' })
            : Buffer.alloc(0);
    });

    test('computeConstructorIdFromSchema', () => {
        const { computeConstructorIdFromSchema } = require('../src/serializer');
        const id = computeConstructorIdFromSchema('user id:int first_name:string last_name:string = User');
        assert.strictEqual(id, 0xd23c81a3);
    });

    test('computeConstructorIdFromName', () => {
        const { computeConstructorIdFromName } = require('../src/serializer');
        const id = computeConstructorIdFromName('boolTrue');
        assert.ok(typeof id === 'number');
    });

    test('reset and length', () => {
        const ser = new SchemaSerializer(registry);
        ser.writeInt32(42);
        assert.strictEqual(ser.length, 4);
        ser.reset();
        assert.strictEqual(ser.length, 0);
    });

    test('toBuffer returns correct slice', () => {
        const ser = new SchemaSerializer(registry);
        ser.writeInt32(1);
        ser.writeInt32(2);
        const buf = ser.toBuffer();
        assert.strictEqual(buf.length, 8);
    });
});
