import { strict as assert } from 'assert';
import {
    parseTLSchema,
    SchemaRegistry,
    SchemaSerializer,
    SchemaDeserializer,
    crc32,
    crc32Hex,
    normalizeForCRC32,
    computeConstructorIdFromSchema,
    validateTLSchema,
    BOOL_TRUE_ID,
    BOOL_FALSE_ID,
    VECTOR_ID,
} from '../src';

const TEST_SCHEMA = `
int#a8509bda ? = Int;
long ? = Long;
double ? = Double;
string ? = String;
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
null = Null;

vector {t:Type} # [ t ] = Vector t;

user#d23c81a3 id:int first_name:string last_name:string = User;
no_user#c67599d1 id:int = User;
group id:int title:string description:string = Group;
no_group = Group;

point2d x:int y:int = Point2d;
point3d x:int y:int z:int = Point2d;

pair x:Object y:Object = Pair;

message msg_id:long seq_no:int bytes:int = Message;
msg_container#73f1f8dc messages:vector<Message> = MessageContainer;

---functions---

getUser#b0f732d5 id:int = User;
getUsers#2d84d5f5 id:Vector<int> = Vector<User>;
getConfig#e7a0ed2c = Config;
`;

describe('TL Language', () => {
    test('CRC32 computation', () => {
        const id1 = crc32('hello');
        assert.ok(typeof id1 === 'number');
        assert.ok(id1 > 0 && id1 < 0xFFFFFFFF);

        const id2 = crc32Hex('hello');
        assert.ok(id2.startsWith('0x'));
        assert.ok(id2.length === 10);

        const id3 = crc32('');
        assert.strictEqual(id3, 0);
    });

    test('Schema parsing', () => {
        const schema = parseTLSchema(TEST_SCHEMA);

        assert.ok(schema.types.size > 0, 'Should have types');
        assert.ok(schema.constructors.size > 0, 'Should have constructors');
        assert.ok(schema.functions.size > 0, 'Should have functions');

        const userType = schema.types.get('User');
        assert.ok(userType, 'Should have User type');
        assert.strictEqual(userType!.constructors.length, 2, 'User should have 2 constructors');

        const vectorType = schema.types.get('Vector');
        assert.ok(vectorType, 'Should have Vector type');

        const getConfigFn = Array.from(schema.functions.values()).find(f => f.name === 'getConfig');
        assert.ok(getConfigFn, 'Should have getConfig function');
    });

    test('Schema registry', () => {
        const registry = new SchemaRegistry(TEST_SCHEMA);

        assert.strictEqual(registry.typeCount, 13);
        assert.ok(registry.constructorCount > 0);
        assert.ok(registry.functionCount > 0);

        const userConstructors = registry.getConstructorsByName('user');
        assert.ok(userConstructors.length > 0, 'Should find user constructors');
        assert.strictEqual(userConstructors[0].fields.length, 3, 'user#d23c81a3 should have 3 fields');

        const userType = registry.getType('User');
        assert.ok(userType, 'Should find User type');

        const getConfig = registry.findFunctionByName('getConfig');
        assert.ok(getConfig, 'Should find getConfig function');
        assert.strictEqual(getConfig.fields.length, 0, 'getConfig has no fields');

        const combById = registry.getCombinatorById(VECTOR_ID);
        assert.ok(combById, 'Should find vector by ID');
        assert.strictEqual(combById.name, 'vector');
    });

    test('Constructor ID computation', () => {
        const knownUser = computeConstructorIdFromSchema('user id:int first_name:string last_name:string = User');
        assert.strictEqual(knownUser, 0xd23c81a3, 'user constructor should be 0xd23c81a3');

        const noUser = computeConstructorIdFromSchema('no_user id:int = User');
        assert.strictEqual(noUser, 0xc67599d1, 'no_user should be 0xc67599d1');

        const vectorId = computeConstructorIdFromSchema('vector t:Type # [ t ] = Vector t');
        assert.strictEqual(vectorId, VECTOR_ID, 'vector should match VECTOR_ID');

        const boolTrue = computeConstructorIdFromSchema('boolTrue = Bool');
        assert.strictEqual(boolTrue, BOOL_TRUE_ID, 'boolTrue should match');

        const boolFalse = computeConstructorIdFromSchema('boolFalse = Bool');
        assert.strictEqual(boolFalse, BOOL_FALSE_ID, 'boolFalse should match');
    });

    test('Serialization', () => {
        const registry = new SchemaRegistry(TEST_SCHEMA);
        const serializer = new SchemaSerializer(registry);

        serializer.writeInt32(42);
        assert.strictEqual(serializer.length, 4);

        serializer.reset();
        serializer.writeInt64(1234567890n);
        assert.strictEqual(serializer.length, 8);

        serializer.reset();
        serializer.writeString('hello');
        assert.ok(serializer.length > 0);

        serializer.reset();
        serializer.writeBoolTrue();
        const buf = serializer.toBuffer();
        assert.strictEqual(buf.readUInt32LE(0), BOOL_TRUE_ID);

        serializer.reset();
        serializer.writeBoolFalse();
        const buf2 = serializer.toBuffer();
        assert.strictEqual(buf2.readUInt32LE(0), BOOL_FALSE_ID);

        serializer.reset();
        serializer.writeVectorInt32([1, 2, 3]);
        const vbuf = serializer.toBuffer();
        assert.strictEqual(vbuf.readUInt32LE(0), VECTOR_ID);
        assert.strictEqual(vbuf.readInt32LE(4), 3);
        assert.strictEqual(vbuf.readInt32LE(8), 1);
        assert.strictEqual(vbuf.readInt32LE(12), 2);
        assert.strictEqual(vbuf.readInt32LE(16), 3);

        serializer.reset();
        serializer.writeVectorInt64([100n, 200n]);
        const v64buf = serializer.toBuffer();
        assert.strictEqual(v64buf.readUInt32LE(0), VECTOR_ID);
        assert.strictEqual(v64buf.readInt32LE(4), 2);

        serializer.reset();
        serializer.writeVectorString(['abc', 'def']);
        const vsbuf = serializer.toBuffer();
        assert.strictEqual(vsbuf.readUInt32LE(0), VECTOR_ID);
    });

    test('Deserialization', () => {
        const registry = new SchemaRegistry(TEST_SCHEMA);
        const serializer = new SchemaSerializer(registry);

        serializer.writeUint32(VECTOR_ID);
        serializer.writeInt32(3);
        serializer.writeInt32(10);
        serializer.writeInt32(20);
        serializer.writeInt32(30);

        const deserializer = new SchemaDeserializer(serializer.toBuffer(), registry);
        const result = deserializer.readBoxedObject();
        assert.ok(result, 'Should deserialize vector');
        assert.strictEqual(result!.constructorId, VECTOR_ID);
        assert.strictEqual(result!.typeName, 'Vector');
        assert.strictEqual(result!.fields.count, 3);

        serializer.reset();
        serializer.writeUint32(BOOL_TRUE_ID);
        const boolDeser = new SchemaDeserializer(serializer.toBuffer(), registry);
        const boolResult = boolDeser.readBoxedObject();
        assert.ok(boolResult, 'Should deserialize boolTrue');
        assert.strictEqual(boolResult!.constructorName, 'boolTrue');
        assert.strictEqual(boolResult!.typeName, 'Bool');

        serializer.reset();
        serializer.writeUint32(computeConstructorIdFromSchema('no_user id:int = User'));
        serializer.writeInt32(12345);
        const noUserDeser = new SchemaDeserializer(serializer.toBuffer(), registry);
        const noUserResult = noUserDeser.readBoxedObject();
        assert.ok(noUserResult, 'Should deserialize no_user');
        assert.strictEqual(noUserResult!.typeName, 'User');
        assert.strictEqual(noUserResult!.fields.id, 12345);

        serializer.reset();
        serializer.writeUint32(computeConstructorIdFromSchema('user id:int first_name:string last_name:string = User'));
        serializer.writeInt32(42);
        serializer.writeString('John');
        serializer.writeString('Doe');
        const userDeser = new SchemaDeserializer(serializer.toBuffer(), registry);
        const userResult = userDeser.readBoxedObject();
        assert.ok(userResult, 'Should deserialize user');
        assert.strictEqual(userResult!.typeName, 'User');
        assert.strictEqual(userResult!.fields.id, 42);
        assert.strictEqual(userResult!.fields.first_name, 'John');
        assert.strictEqual(userResult!.fields.last_name, 'Doe');
    });

    test('Schema validation', () => {
        const schema = parseTLSchema(TEST_SCHEMA);
        const errors = validateTLSchema(schema);

        const realErrors = errors.filter(e => e.severity === 'error');
        assert.strictEqual(realErrors.length, 0, `Should have no errors, got: ${realErrors.map(e => e.message).join(', ')}`);
    });

    test('Normalization', () => {
        const n1 = normalizeForCRC32('user id:int first_name:string last_name:string = User;');
        assert.strictEqual(n1, 'user id:int first_name:string last_name:string = User');

        const n2 = normalizeForCRC32('user  id:  int  first_name:  string  last_name:  string  =  User');
        assert.strictEqual(n2, 'user id: int first_name: string last_name: string = User');

        const n3 = normalizeForCRC32('user id:int // comment\nfirst_name:string = User');
        assert.strictEqual(n3, 'user id:int first_name:string = User');
    });

    test('Edge cases', () => {
        const registry = new SchemaRegistry(TEST_SCHEMA);

        const unknown = registry.getCombinatorById(0xdeadbeef);
        assert.strictEqual(unknown, undefined, 'Unknown constructor should return undefined');

        const emptyRegistry = new SchemaRegistry('');
        assert.strictEqual(emptyRegistry.typeCount, 0);
        assert.strictEqual(emptyRegistry.constructorCount, 0);

        const unknownType = registry.getType('NonExistent');
        assert.strictEqual(unknownType, undefined);
    });
});
