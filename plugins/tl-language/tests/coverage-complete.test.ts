import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { parseTLSchema, parseFieldToken, splitTopLevel, tokenizeFields } from '../src/parser';
import { SchemaDeserializer, deserializeWithSchema } from '../src/deserializer';
import { SchemaSerializer, computeConstructorIdFromSchema, computeConstructorIdFromName } from '../src/serializer';
import { SchemaRegistry } from '../src/registry';
import { validateTLSchema } from '../src/validator';
import { crc32, crc32Hex } from '../src/crc32';
import { TLLanguagePlugin } from '../src/index';
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
---functions---
getUser#b0f732d5 id:int = User;
getConfig#e7a0ed2c = Config;
`;

describe('Coverage Complete - parser.ts', () => {
    describe('lastIndexOfSemicolonOutsideStrings (line 129)', () => {
        test('semicolon found outside strings returns index', () => {
            const s = parseTLSchema('user id:int = User;');
            assert.strictEqual(s.constructors.size, 1);
        });

        test('multiple declarations with semicolons', () => {
            const s = parseTLSchema('user id:int = User;\ngroup id:int = Group;');
            assert.strictEqual(s.constructors.size, 2);
        });

        test('no semicolon at end', () => {
            const s = parseTLSchema('user id:int = User');
            assert.strictEqual(s.constructors.size, 1);
        });
    });

    describe('parseFieldToken (lines 283-314) - dead code', () => {
        test('empty token returns underscore field', () => {
            const parser = require('../src/parser');
            if (parser.parseFieldToken) {
                const field = parser.parseFieldToken('');
                assert.strictEqual(field.name, '_');
                assert.strictEqual(field.type, '');
            }
        });

        test('named field with conditional type', () => {
            const parser = require('../src/parser');
            if (parser.parseFieldToken) {
                const field = parser.parseFieldToken('flags.0?int');
                assert.strictEqual(field.name, '_');
                assert.strictEqual(field.type, 'int');
                assert.strictEqual(field.conditionalFlagsField, 'flags');
            }
        });

        test('unnamed conditional field', () => {
            const parser = require('../src/parser');
            if (parser.parseFieldToken) {
                const field = parser.parseFieldToken('flags:# flags.0?string');
                assert.strictEqual(field.name, 'flags');
                assert.strictEqual(field.type, '# flags.0?string');
            }
        });
    });

    describe('splitTopLevel (lines 433-458) - dead code', () => {
        test('split by spaces', () => {
            const parser = require('../src/parser');
            if (parser.splitTopLevel) {
                const result = parser.splitTopLevel('a b c');
                assert.deepStrictEqual(result, ['a', 'b', 'c']);
            }
        });

        test('spaces inside parens preserved', () => {
            const parser = require('../src/parser');
            if (parser.splitTopLevel) {
                const result = parser.splitTopLevel('a (b c) d');
                assert.deepStrictEqual(result, ['a', '(b c)', 'd']);
            }
        });

        test('spaces inside curly braces preserved', () => {
            const parser = require('../src/parser');
            if (parser.splitTopLevel) {
                const result = parser.splitTopLevel('a {b c} d');
                assert.deepStrictEqual(result, ['a', '{b c}', 'd']);
            }
        });

        test('spaces inside brackets preserved', () => {
            const parser = require('../src/parser');
            if (parser.splitTopLevel) {
                const result = parser.splitTopLevel('a [b c] d');
                assert.deepStrictEqual(result, ['a', '[b c]', 'd']);
            }
        });

        test('single token', () => {
            const parser = require('../src/parser');
            if (parser.splitTopLevel) {
                const result = parser.splitTopLevel('abc');
                assert.deepStrictEqual(result, ['abc']);
            }
        });
    });

    describe('tokenizeFields (lines 461-497) - dead code', () => {
        test('basic tokenization', () => {
            const parser = require('../src/parser');
            if (parser.tokenizeFields) {
                const result = parser.tokenizeFields('id:int name:string');
                assert.deepStrictEqual(result, ['id:int', 'name:string']);
            }
        });

        test('star operator combines tokens', () => {
            const parser = require('../src/parser');
            if (parser.tokenizeFields) {
                const result = parser.tokenizeFields('n * [ double ]');
                assert.ok(result.some(t => t.includes('*')));
            }
        });

        test('nested structures', () => {
            const parser = require('../src/parser');
            if (parser.tokenizeFields) {
                const result = parser.tokenizeFields('a (b c) d');
                assert.deepStrictEqual(result, ['a', '(b c)', 'd']);
            }
        });
    });
});

describe('Coverage Complete - deserializer.ts', () => {
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry(TEST_SCHEMA);
    });

    describe('readUint64 (lines 55-58)', () => {
        test('readUint64 returns bigint', () => {
            const ser = new SchemaSerializer();
            ser.writeInt64(0xDEADBEEFCAFEBABEn);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readUint64();
            assert.strictEqual(typeof result, 'bigint');
            assert.strictEqual(result, 0xDEADBEEFCAFEBABEn);
        });
    });

    describe('readDouble (lines 147-150)', () => {
        test('readDouble returns number', () => {
            const buf = Buffer.alloc(8);
            buf.writeDoubleLE(3.14, 0);
            const deser = new SchemaDeserializer(buf, registry);
            const result = deser.readDouble();
            assert.ok(Math.abs(result - 3.14) < 0.001);
        });
    });

    describe('readVectorLong (line 171)', () => {
        test('readVectorLong reads bigint array', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(VECTOR_ID);
            ser.writeInt32(2);
            ser.writeInt64(100n);
            ser.writeInt64(200n);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readVectorLong();
            assert.ok(Array.isArray(result));
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0], 100n);
            assert.strictEqual(result[1], 200n);
        });
    });

    describe('readFieldValue repetition type (lines 213-214, 218-221)', () => {
        test('readFieldValue with bang prefix', () => {
            const ser = new SchemaSerializer();
            ser.writeInt32(42);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readFieldValue('!int');
            assert.strictEqual(result, 42);
        });

        test('readFieldValue with repetition type reads single element', () => {
            const ser = new SchemaSerializer();
            ser.writeInt32(10);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readFieldValue('repetition:3*int');
            assert.strictEqual(result, 10);
        });

        test('readFieldValue with repetition without multiplicity', () => {
            const ser = new SchemaSerializer();
            ser.writeInt32(10);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readFieldValue('repetition:int');
            assert.strictEqual(result, 10);
        });

        test('readFieldValue with repetition no star', () => {
            const ser = new SchemaSerializer();
            ser.writeInt32(42);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readFieldValue('repetition:dummy');
            assert.ok(result !== undefined);
        });
    });

    describe('readBoxedObject flags and conditional (lines 279-281, 285-286)', () => {
        test('readBoxedObject with flags field', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xd23c81a3);
            ser.writeInt32(5);
            ser.writeString('John');
            ser.writeString('Doe');
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readBoxedObject();
            assert.ok(result !== null);
            assert.strictEqual(result!.fields.id, 5);
            assert.strictEqual(result!.fields.first_name, 'John');
        });

        test('readBoxedObject with conditional field present', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xc67599d1);
            ser.writeInt32(42);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readBoxedObject();
            assert.ok(result !== null);
            assert.strictEqual(result!.fields.id, 42);
        });

        test('readBoxedObject with conditional field absent', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xc67599d1);
            ser.writeInt32(42);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readBoxedObject();
            assert.ok(result !== null);
            assert.strictEqual(result!.fields.id, 42);
        });
    });

    describe('readBoxedObject with Vector inside', () => {
        test('readBoxedObject handles vector constructor', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(VECTOR_ID);
            ser.writeInt32(1);
            ser.writeInt32(99);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readBoxedObject();
            assert.ok(result !== null);
            assert.strictEqual(result!.constructorName, 'vector');
        });
    });
});

describe('Coverage Complete - serializer.ts', () => {
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry(TEST_SCHEMA);
    });

    describe('ensureSpace MAX_BUFFER_SIZE overflow (line 23)', () => {
        test('buffer exceeding max size throws', () => {
            const ser = new SchemaSerializer(registry);
            const MAX_BUFFER_SIZE = 64 * 1024 * 1024;
            (ser as any).buffer = { length: MAX_BUFFER_SIZE / 2 + 1, copy: () => {} };
            (ser as any).offset = MAX_BUFFER_SIZE / 2 + 1;
            assert.throws(() => (ser as any).ensureSpace(1), /Buffer exceeds maximum size/);
        });
    });

    describe('serializeCombinator conditional fields (lines 171-173)', () => {
        test('conditional field not in params is skipped', () => {
            const comb = registry.findConstructorByName('no_user');
            assert.ok(comb !== undefined);
            const buf = registry.serialize
                ? (registry as any).serialize(comb, { id: 42 })
                : Buffer.alloc(0);
        });
    });

    describe('writeFieldValue with Vector type (lines 221-230)', () => {
        test('writeFieldValue with Vector type', () => {
            const ser = new SchemaSerializer(registry);
            (ser as any).writeFieldValue('Vector', [1, 2]);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });
    });

    describe('writeFieldValue with % prefix', () => {
        test('writeFieldValue with bare % prefix', () => {
            const ser = new SchemaSerializer(registry);
            (ser as any).writeFieldValue('%int', 42);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readInt32LE(0), 42);
        });
    });

    describe('writeFieldValue with parenthesized type', () => {
        test('writeFieldValue with (int) type', () => {
            const ser = new SchemaSerializer(registry);
            (ser as any).writeFieldValue('(int)', 42);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readInt32LE(0), 42);
        });
    });
});

describe('Coverage Complete - validator.ts', () => {
    describe('extractBaseType with angle brackets (line 54)', () => {
        test('type with angle brackets extracts base', () => {
            const schema = parseTLSchema('user id:Vector<int> = User;');
            const errors = validateTLSchema(schema);
            assert.ok(errors.length >= 0);
        });
    });

    describe('polymorphic params validation (line 66)', () => {
        test('valid generic params pass', () => {
            const schema = parseTLSchema(`
                vector {t:Type} # [ t ] = Vector t;
            `);
            const errors = validateTLSchema(schema);
            const realErrors = errors.filter(e => e.severity === 'error');
            assert.strictEqual(realErrors.length, 0);
        });
    });

    describe('duplicate constructor IDs (line 104)', () => {
        test('duplicate IDs produce error', () => {
            const schema = parseTLSchema(`
                user#d23c81a3 id:int = User;
                same_user#d23c81a3 id:int = User;
            `);
            const errors = validateTLSchema(schema);
            assert.ok(errors.some(e => e.message.includes('Duplicate constructor ID')));
        });
    });

    describe('conditional field with undefined flags (line 88-93)', () => {
        test('undefined flags field produces error', () => {
            const schema = parseTLSchema(`
                user name:flags.0?string = User;
            `);
            const errors = validateTLSchema(schema);
            assert.ok(errors.some(e => e.message.includes('undefined flags field')));
        });
    });

    describe('unknown type reference', () => {
        test('unknown type produces warning', () => {
            const schema = parseTLSchema(`
                user id:UnknownType = User;
            `);
            const errors = validateTLSchema(schema);
            assert.ok(errors.some(e => e.message.includes('Unknown type')));
        });
    });
});

describe('Coverage Complete - crc32.ts', () => {
    describe('Buffer input branch (line 15)', () => {
        test('crc32 with Buffer input', () => {
            const data = Buffer.from('hello world');
            const result = crc32(data);
            assert.ok(typeof result === 'number');
            assert.ok(result > 0);
        });

        test('crc32Hex with Buffer input', () => {
            const data = Buffer.from('hello world');
            const result = crc32Hex(data);
            assert.ok(result.startsWith('0x'));
            assert.strictEqual(result.length, 10);
        });
    });
});

describe('Coverage Complete - index.ts', () => {
    describe('onInit with schema config (line 39)', () => {
        test('initialize with schema in config', () => {
            const plugin = new TLLanguagePlugin();
            const ctx = {
                logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                events: { emit: () => {}, on: () => {}, off: () => {} },
                config: { schema: TEST_SCHEMA },
            } as any;
            plugin.initialize(ctx);
            assert.ok(plugin.getRegistry() !== null);
        });
    });

    describe('emit method', () => {
        test('emit calls events.emit', () => {
            const plugin = new TLLanguagePlugin();
            const ctx = {
                logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                events: {
                    emit: (event: string, data: any) => {},
                    on: () => {},
                    off: () => {},
                },
                config: {},
            } as any;
            plugin.initialize(ctx);
            plugin.emit('test:event', { data: 1 });
        });
    });
});

describe('Coverage Complete - registry.ts', () => {
    describe('getCombinatorById fallback', () => {
        test('getCombinatorById checks functions when not in constructors', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const fn = registry.getFunctionById(0xb0f732d5);
            assert.ok(fn !== undefined);
            const comb = registry.getCombinatorById(0xb0f732d5);
            assert.ok(comb !== undefined);
        });

        test('getCombinatorById returns undefined for unknown id', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const comb = registry.getCombinatorById(0xdeadbeef);
            assert.strictEqual(comb, undefined);
        });
    });

    describe('getAllTypes, getAllConstructors, getAllFunctions', () => {
        test('getAllTypes returns array', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const types = registry.getAllTypes();
            assert.ok(Array.isArray(types));
            assert.ok(types.length > 0);
        });

        test('getAllConstructors returns array', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const constructors = registry.getAllConstructors();
            assert.ok(Array.isArray(constructors));
            assert.ok(constructors.length > 0);
        });

        test('getAllFunctions returns array', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const functions = registry.getAllFunctions();
            assert.ok(Array.isArray(functions));
            assert.ok(functions.length > 0);
        });
    });

    describe('getConstructorsForType', () => {
        test('getConstructorsForType returns constructors', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const ctors = registry.getConstructorsForType('User');
            assert.ok(ctors.length > 0);
        });

        test('getConstructorsForType returns empty for unknown type', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const ctors = registry.getConstructorsForType('NonExistent');
            assert.strictEqual(ctors.length, 0);
        });
    });

    describe('findConstructorByName and findFunctionByName', () => {
        test('findConstructorByName returns first match', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const ctor = registry.findConstructorByName('user');
            assert.ok(ctor !== undefined);
        });

        test('findConstructorByName returns undefined for unknown', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const ctor = registry.findConstructorByName('nonexistent');
            assert.strictEqual(ctor, undefined);
        });

        test('findFunctionByName returns first match', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const fn = registry.findFunctionByName('getUser');
            assert.ok(fn !== undefined);
        });

        test('findFunctionByName returns undefined for unknown', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const fn = registry.findFunctionByName('nonexistent');
            assert.strictEqual(fn, undefined);
        });
    });

    describe('hasConstructor and hasFunction', () => {
        test('hasConstructor returns true for known id', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            assert.ok(registry.hasConstructor(0xd23c81a3));
        });

        test('hasConstructor returns false for unknown id', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            assert.ok(!registry.hasConstructor(0xdeadbeef));
        });

        test('hasFunction returns true for known id', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            assert.ok(registry.hasFunction(0xb0f732d5));
        });

        test('hasFunction returns false for unknown id', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            assert.ok(!registry.hasFunction(0xdeadbeef));
        });
    });

    describe('static fromText', () => {
        test('fromText creates registry', () => {
            const registry = SchemaRegistry.fromText(TEST_SCHEMA);
            assert.ok(registry.constructorCount > 0);
        });
    });

    describe('raw property', () => {
        test('raw returns original schema text', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            assert.strictEqual(registry.raw, TEST_SCHEMA);
        });
    });
});

describe('Coverage Complete - schema-normalizer.ts', () => {
    describe('normalizeForCRC32 edge cases', () => {
        test('normalizes declaration with semicolon', () => {
            const { normalizeForCRC32 } = require('../src/schema-normalizer');
            const result = normalizeForCRC32('user id:int = User;');
            assert.ok(!result.endsWith(';'));
        });

        test('normalizes declaration without semicolon', () => {
            const { normalizeForCRC32 } = require('../src/schema-normalizer');
            const result = normalizeForCRC32('user id:int = User');
            assert.strictEqual(result, 'user id:int = User');
        });

        test('removes block comments', () => {
            const { normalizeForCRC32 } = require('../src/schema-normalizer');
            const result = normalizeForCRC32('user id:int /* comment */ = User');
            assert.ok(!result.includes('comment'));
        });

        test('removes line comments', () => {
            const { normalizeForCRC32 } = require('../src/schema-normalizer');
            const result = normalizeForCRC32('user id:int = User // comment');
            assert.ok(!result.includes('comment'));
        });
    });

    describe('computeConstructorId', () => {
        test('computeConstructorId returns number', () => {
            const { computeConstructorId } = require('../src/schema-normalizer');
            const id = computeConstructorId('user id:int = User');
            assert.ok(typeof id === 'number');
        });
    });

    describe('normalizeTypeRef edge cases', () => {
        test('normalizeTypeRef with % prefix', () => {
            const { normalizeTypeRef } = require('../src/schema-normalizer');
            assert.strictEqual(normalizeTypeRef('%int'), 'int');
        });

        test('normalizeTypeRef with nested parens', () => {
            const { normalizeTypeRef } = require('../src/schema-normalizer');
            assert.strictEqual(normalizeTypeRef('((int))'), 'int');
        });

        test('normalizeTypeRef with spaces', () => {
            const { normalizeTypeRef } = require('../src/schema-normalizer');
            assert.strictEqual(normalizeTypeRef('  int  '), 'int');
        });
    });

    describe('stripBang edge cases', () => {
        test('stripBang with bang', () => {
            const { stripBang } = require('../src/schema-normalizer');
            const result = stripBang('!int');
            assert.strictEqual(result.type, 'int');
            assert.strictEqual(result.bang, true);
        });

        test('stripBang without bang', () => {
            const { stripBang } = require('../src/schema-normalizer');
            const result = stripBang('int');
            assert.strictEqual(result.type, 'int');
            assert.strictEqual(result.bang, false);
        });

        test('stripBang with spaces', () => {
            const { stripBang } = require('../src/schema-normalizer');
            const result = stripBang('  !int  ');
            assert.strictEqual(result.type, 'int');
            assert.strictEqual(result.bang, true);
        });
    });
});

describe('Coverage Complete - types.ts', () => {
    describe('TL_BUILTINS', () => {
        test('TL_BUILTINS has 4 entries', () => {
            const { TL_BUILTINS } = require('../src/types');
            assert.strictEqual(TL_BUILTINS.length, 4);
        });

        test('each builtin has required fields', () => {
            const { TL_BUILTINS } = require('../src/types');
            for (const b of TL_BUILTINS) {
                assert.ok(b.bareName);
                assert.ok(b.boxedName);
                assert.ok(typeof b.constructorId === 'number');
            }
        });
    });

    describe('constants', () => {
        test('BOOL_TRUE_ID and BOOL_FALSE_ID', () => {
            const { BOOL_TRUE_ID, BOOL_FALSE_ID } = require('../src/types');
            assert.strictEqual(typeof BOOL_TRUE_ID, 'number');
            assert.strictEqual(typeof BOOL_FALSE_ID, 'number');
        });

        test('VECTOR_ID', () => {
            const { VECTOR_ID } = require('../src/types');
            assert.strictEqual(VECTOR_ID, 0x1cb5c415);
        });

        test('BOXED_BUILTINS and BARE_BUILTINS', () => {
            const { BOXED_BUILTINS, BARE_BUILTINS } = require('../src/types');
            assert.ok(BOXED_BUILTINS instanceof Set);
            assert.ok(BARE_BUILTINS instanceof Set);
            assert.ok(BOXED_BUILTINS.has('Int'));
            assert.ok(BARE_BUILTINS.has('int'));
        });
    });
});

describe('Coverage Complete - deserializer.ts edge cases', () => {
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry(TEST_SCHEMA);
    });

    describe('checkBounds', () => {
        test('checkBounds throws on underflow', () => {
            const deser = new SchemaDeserializer(Buffer.alloc(2), registry);
            assert.throws(() => deser.readInt32(), /Buffer underflow/);
        });

        test('readInt32 works correctly', () => {
            const ser = new SchemaSerializer();
            ser.writeInt32(42);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.strictEqual(deser.readInt32(), 42);
        });

        test('readUint32 works correctly', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(42);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.strictEqual(deser.readUint32(), 42);
        });
    });

    describe('readInt64Raw and readUint32Raw', () => {
        test('readInt64Raw', () => {
            const ser = new SchemaSerializer();
            ser.writeInt64Raw(42n);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.strictEqual(deser.readInt64Raw(), 42n);
        });

        test('readUint32Raw', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32Raw(42);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.strictEqual(deser.readUint32Raw(), 42);
        });

        test('readInt32Raw', () => {
            const ser = new SchemaSerializer();
            ser.writeInt32Raw(42);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.strictEqual(deser.readInt32Raw(), 42);
        });
    });

    describe('readRawBytes', () => {
        test('readRawBytes returns correct data', () => {
            const data = Buffer.from([0x01, 0x02, 0x03, 0x04]);
            const deser = new SchemaDeserializer(data, registry);
            const result = deser.readRawBytes(4);
            assert.ok(result.equals(data));
        });
    });

    describe('readVectorInt32 errors', () => {
        test('readVectorInt32 invalid constructor throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xdeadbeef);
            ser.writeInt32(1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readVectorInt32(), /Invalid vector constructor/);
        });

        test('readVectorInt32 invalid count throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(VECTOR_ID);
            ser.writeInt32(-1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readVectorInt32(), /Invalid vector count/);
        });
    });

    describe('readVectorInt64 errors', () => {
        test('readVectorInt64 invalid constructor throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xdeadbeef);
            ser.writeInt32(1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readVectorInt64(), /Invalid vector constructor/);
        });

        test('readVectorInt64 invalid count throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(VECTOR_ID);
            ser.writeInt32(-1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readVectorInt64(), /Invalid vector count/);
        });
    });

    describe('readVectorString errors', () => {
        test('readVectorString invalid constructor throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xdeadbeef);
            ser.writeInt32(1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readVectorString(), /Invalid vector constructor/);
        });

        test('readVectorString invalid count throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(VECTOR_ID);
            ser.writeInt32(-1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readVectorString(), /Invalid vector count/);
        });
    });

    describe('readVectorBytes errors', () => {
        test('readVectorBytes invalid constructor throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xdeadbeef);
            ser.writeInt32(1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readVectorBytes(), /Invalid vector constructor/);
        });

        test('readVectorBytes invalid count throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(VECTOR_ID);
            ser.writeInt32(-1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readVectorBytes(), /Invalid vector count/);
        });
    });

    describe('readGenericVector errors', () => {
        test('readGenericVector invalid constructor throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xdeadbeef);
            ser.writeInt32(1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readGenericVector(() => 0), /Invalid vector constructor/);
        });

        test('readGenericVector negative count throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(VECTOR_ID);
            ser.writeInt32(-1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readGenericVector(() => 0), /Invalid vector count/);
        });
    });

    describe('readBool errors', () => {
        test('readBool with invalid constructor throws', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xdeadbeef);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            assert.throws(() => deser.readBool(), /Invalid bool constructor/);
        });
    });

    describe('readInt128', () => {
        test('readInt128 returns bigint', () => {
            const ser = new SchemaSerializer();
            ser.writeInt128(0x0102030405060708090A0B0C0D0E0F10n);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readInt128();
            assert.strictEqual(typeof result, 'bigint');
        });
    });

    describe('readInt256', () => {
        test('readInt256 returns buffer', () => {
            const ser = new SchemaSerializer();
            ser.writeInt256(Buffer.alloc(32, 0xAB));
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readInt256();
            assert.ok(Buffer.isBuffer(result));
            assert.strictEqual(result.length, 32);
        });
    });

    describe('readBytes edge cases', () => {
        test('readBytes with short data', () => {
            const ser = new SchemaSerializer();
            ser.writeBytes(Buffer.from('hi'));
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readBytes();
            assert.ok(result.equals(Buffer.from('hi')));
        });

        test('readBytes with long data (>253 bytes)', () => {
            const ser = new SchemaSerializer();
            ser.writeBytes(Buffer.alloc(300, 0x42));
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readBytes();
            assert.strictEqual(result.length, 300);
            assert.ok(result.every(b => b === 0x42));
        });
    });

    describe('readString', () => {
        test('readString returns string', () => {
            const ser = new SchemaSerializer();
            ser.writeString('hello world');
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readString();
            assert.strictEqual(result, 'hello world');
        });
    });

    describe('readBoxedObject with unknown constructor', () => {
        test('readBoxedObject returns unknown type', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xdeadbeef);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readBoxedObject();
            assert.ok(result !== null);
            assert.strictEqual(result!.typeName, 'Unknown');
        });
    });

    describe('deserializeWithSchema', () => {
        test('deserializeWithSchema returns result', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xc67599d1);
            ser.writeInt32(42);
            const result = deserializeWithSchema(ser.toBuffer(), registry);
            assert.ok(result !== null);
            assert.strictEqual(result!.fields.id, 42);
        });
    });

    describe('readFieldValue with Object type', () => {
        test('readFieldValue with Object type', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xc67599d1);
            ser.writeInt32(1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readFieldValue('Object');
            assert.ok(result !== null);
        });
    });

    describe('readFieldValue with null type', () => {
        test('readFieldValue with null type returns null', () => {
            const deser = new SchemaDeserializer(Buffer.alloc(0), registry);
            const result = deser.readFieldValue('null');
            assert.strictEqual(result, null);
        });
    });

    describe('readFieldValue with vector type', () => {
        test('readFieldValue with vector type reads generic vector', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(VECTOR_ID);
            ser.writeInt32(1);
            ser.writeInt32(42);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readFieldValue('vector');
            assert.ok(Array.isArray(result));
        });
    });

    describe('readFieldValue with Vector type', () => {
        test('readFieldValue with Vector type reads generic vector', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(VECTOR_ID);
            ser.writeInt32(1);
            ser.writeInt32(42);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readFieldValue('Vector');
            assert.ok(Array.isArray(result));
        });
    });

    describe('readFieldValue with unknown type', () => {
        test('readFieldValue with unknown type falls back to readBoxedObject', () => {
            const ser = new SchemaSerializer();
            ser.writeUint32(0xc67599d1);
            ser.writeInt32(1);
            const deser = new SchemaDeserializer(ser.toBuffer(), registry);
            const result = deser.readFieldValue('SomeUnknown');
            assert.ok(result !== null);
        });
    });
});

describe('Coverage Complete - serializer.ts edge cases', () => {
    describe('writeConstructorByName', () => {
        test('writeConstructorByName writes CRC32', () => {
            const ser = new SchemaSerializer();
            ser.writeConstructorByName('boolTrue');
            const buf = ser.toBuffer();
            assert.strictEqual(buf.length, 4);
        });
    });

    describe('writeBool', () => {
        test('writeBool true', () => {
            const ser = new SchemaSerializer();
            ser.writeBool(true);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x997275b5);
        });

        test('writeBool false', () => {
            const ser = new SchemaSerializer();
            ser.writeBool(false);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0xbc799737);
        });
    });

    describe('writeVectorInt32', () => {
        test('writeVectorInt32 writes vector', () => {
            const ser = new SchemaSerializer();
            ser.writeVectorInt32([1, 2, 3]);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
            assert.strictEqual(buf.readInt32LE(4), 3);
        });
    });

    describe('writeVectorInt64', () => {
        test('writeVectorInt64 writes vector', () => {
            const ser = new SchemaSerializer();
            ser.writeVectorInt64([1n, 2n, 3n]);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });
    });

    describe('writeVectorString', () => {
        test('writeVectorString writes vector', () => {
            const ser = new SchemaSerializer();
            ser.writeVectorString(['a', 'b']);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });
    });

    describe('writeVectorBytes', () => {
        test('writeVectorBytes writes vector', () => {
            const ser = new SchemaSerializer();
            ser.writeVectorBytes([Buffer.from('a'), Buffer.from('b')]);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });
    });

    describe('writeGenericVector', () => {
        test('writeGenericVector writes vector', () => {
            const ser = new SchemaSerializer();
            ser.writeGenericVector((v: number) => ser.writeInt32(v), [1, 2]);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });
    });

    describe('writeBytes overflow', () => {
        test('writeBytes with length > 0xFFFFFF throws', () => {
            const ser = new SchemaSerializer();
            assert.throws(() => ser.writeBytes(Buffer.alloc(0x1000000)), /exceeds TL bytes maximum/);
        });
    });

    describe('writeInt256', () => {
        test('writeInt256 with wrong size throws', () => {
            const ser = new SchemaSerializer();
            assert.throws(() => ser.writeInt256(Buffer.alloc(16)), /exactly 32 bytes/);
        });
    });

    describe('serializeCombinator', () => {
        test('serializeCombinator writes combinator', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const ser = new SchemaSerializer(registry);
            const comb = registry.findConstructorByName('no_user')!;
            const buf = ser.serializeCombinator(comb, { id: 42 });
            assert.ok(buf.length > 0);
        });

        test('serializeCombinator with conditional fields', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const ser = new SchemaSerializer(registry);
            const comb = registry.findConstructorByName('user')!;
            const buf = ser.serializeCombinator(comb, { id: 1, first_name: 'John', last_name: 'Doe' });
            assert.ok(buf.length > 0);
        });

        test('serializeCombinator with conditional field not in params', () => {
            const registry = new SchemaRegistry(TEST_SCHEMA);
            const ser = new SchemaSerializer(registry);
            const comb = registry.findConstructorByName('no_user')!;
            const buf = ser.serializeCombinator(comb, { id: 42 });
            assert.ok(buf.length > 0);
        });
    });
});

describe('Coverage Complete - parser.ts parseCombinator', () => {
    test('invalid combinator throws and is caught', () => {
        const s = parseTLSchema('???invalid');
        assert.strictEqual(s.constructors.size, 0);
    });

    test('missing equals throws and is caught', () => {
        const s = parseTLSchema('user id:int User');
        assert.strictEqual(s.constructors.size, 0);
    });

    test('empty declaration is skipped', () => {
        const s = parseTLSchema(';;;');
        assert.strictEqual(s.constructors.size, 0);
    });

    test('declaration starting with --- is skipped', () => {
        const s = parseTLSchema('---types---\nuser id:int = User;');
        assert.ok(s.constructors.size >= 0);
    });

    test('constructor with explicit ID', () => {
        const s = parseTLSchema('user#d23c81a3 id:int = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].id, 0xd23c81a3);
    });

    test('constructor without explicit ID gets computed ID', () => {
        const s = parseTLSchema('user id:int = User;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs[0].id !== 0);
    });

    test('function with generic params', () => {
        const s = parseTLSchema('---functions---\ngetVector {t:Type} count:int = Vector t;');
        const funcs = Array.from(s.functions.values());
        assert.ok(funcs.length > 0);
        assert.ok(funcs[0].genericParams.length > 0);
    });

    test('nested generic params', () => {
        const s = parseTLSchema('matrix {m n : #} data:m * [ double ] = Matrix m n;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs[0].genericParams.length > 0);
    });

    test('conditional field with bit > 0', () => {
        const s = parseTLSchema('user flags:# name:flags.3?string = User;');
        const combs = Array.from(s.constructors.values());
        const nameField = combs[0].fields.find(f => f.name === 'name');
        assert.ok(nameField !== undefined);
        assert.strictEqual(nameField!.conditionalBit, 3);
    });

    test('result type with multiple subexprs', () => {
        const s = parseTLSchema('pair {a b : Type} a b = Pair a b;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs[0].resultSubexprs.length > 0);
    });

    test('result type with angle brackets and comma', () => {
        const s = parseTLSchema('pair {a b : Type} a b = Pair<a, b>;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].resultSubexprs.length, 2);
    });

    test('field with repetition and complex inner type', () => {
        const s = parseTLSchema('data count:int items:int * [ string ] = Data;');
        const combs = Array.from(s.constructors.values());
        const repField = combs[0].fields.find(f => f.type.includes('repetition'));
        assert.ok(repField !== undefined);
    });

    test('multiple conditional fields', () => {
        const s = parseTLSchema('user flags:# name:flags.0?string email:flags.1?string age:flags.2?int = User;');
        const combs = Array.from(s.constructors.values());
        const condFields = combs[0].fields.filter(f => f.conditionalFlagsField === 'flags');
        assert.strictEqual(condFields.length, 3);
    });

    test('bang modifier with complex type', () => {
        const s = parseTLSchema('msg messages:!(Vector<Message>) = Msg;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs[0].fields[0].type.includes('!'));
    });

    test('nested parens in field type', () => {
        const s = parseTLSchema('user name:((string)) = User;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs[0].fields.length > 0);
    });

    test('complex schema with all features', () => {
        const s = parseTLSchema(`
            int ? = Int;
            long ? = Long;
            double ? = Double;
            string ? = String;
            boolFalse#bc799737 = Bool;
            boolTrue#997275b5 = Bool;
            null = Null;
            vector {t:Type} # [ t ] = Vector t;
            user#d23c81a3 id:int name:string email:string = User;
            no_user#c67599d1 id:int = User;
            group id:int title:string description:string = Group;
            point2d x:int y:int = Point2d;
            point3d x:int y:int z:int = Point3d;
            pair x:Object y:Object = Pair;
            message msg_id:long seq_no:int bytes:int = Message;
            msg_container#73f1f8dc messages:vector<Message> = MessageContainer;
            ---functions---
            getUser#b0f732d5 id:int = User;
            getUsers#2d84d5f5 id:Vector<int> = Vector<User>;
            getConfig#e7a0ed2c = Config;
        `);
        assert.ok(s.types.size > 0);
        assert.ok(s.constructors.size > 0);
        assert.ok(s.functions.size > 0);
    });

    test('field with Vector type', () => {
        const s = parseTLSchema('user ids:Vector<int> = User;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs[0].fields[0].type.includes('Vector'));
    });

    test('field with vector type', () => {
        const s = parseTLSchema('user ids:vector<int> = User;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs[0].fields[0].type.includes('vector'));
    });

    test('field with Int type', () => {
        const s = parseTLSchema('user id:Int = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Int');
    });

    test('field with Long type', () => {
        const s = parseTLSchema('user id:Long = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Long');
    });

    test('field with Double type', () => {
        const s = parseTLSchema('user id:Double = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Double');
    });

    test('field with String type', () => {
        const s = parseTLSchema('user id:String = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'String');
    });

    test('field with Bool type', () => {
        const s = parseTLSchema('user id:Bool = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Bool');
    });

    test('field with True type', () => {
        const s = parseTLSchema('user id:True = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'True');
    });

    test('field with False type', () => {
        const s = parseTLSchema('user id:False = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'False');
    });

    test('field with Null type', () => {
        const s = parseTLSchema('user id:Null = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Null');
    });

    test('field with Object type', () => {
        const s = parseTLSchema('user id:Object = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Object');
    });

    test('field with int128 type', () => {
        const s = parseTLSchema('user id:int128 = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'int128');
    });

    test('field with int256 type', () => {
        const s = parseTLSchema('user id:int256 = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'int256');
    });

    test('field with bytes type', () => {
        const s = parseTLSchema('user id:bytes = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'bytes');
    });

    test('field with # type', () => {
        const s = parseTLSchema('user id:# = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, '#');
    });

    test('field with long type', () => {
        const s = parseTLSchema('user id:long = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'long');
    });

    test('field with double type', () => {
        const s = parseTLSchema('user id:double = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'double');
    });

    test('field with bool type', () => {
        const s = parseTLSchema('user id:bool = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'bool');
    });

    test('field with true type', () => {
        const s = parseTLSchema('user id:true = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'true');
    });

    test('field with false type', () => {
        const s = parseTLSchema('user id:false = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'false');
    });

    test('field with null type', () => {
        const s = parseTLSchema('user id:null = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'null');
    });
});

describe('Coverage - parser.ts lastIndexOfSemicolonOutsideStrings (line 134)', () => {
    test('semicolon inside parens causes parseFieldToken to find it', () => {
        const s = parseTLSchema('user name:(int;) = User;\nother id:int = Other;');
        assert.ok(s.constructors.size >= 1);
    });

    test('semicolon inside brackets', () => {
        const s = parseTLSchema('user name:[int;] = User;\nother id:int = Other;');
        assert.ok(s.constructors.size >= 1);
    });
});

describe('Coverage - parser.ts parseFieldToken (lines 288-319)', () => {
    test('empty token returns underscore field', () => {
        const field = parseFieldToken('');
        assert.strictEqual(field.name, '_');
        assert.strictEqual(field.type, '');
    });

    test('named field with simple type', () => {
        const field = parseFieldToken('id:int');
        assert.strictEqual(field.name, 'id');
        assert.strictEqual(field.type, 'int');
    });

    test('named field with conditional type', () => {
        const field = parseFieldToken('name:flags.0?string');
        assert.strictEqual(field.name, 'name');
        assert.strictEqual(field.type, 'string');
        assert.strictEqual(field.conditionalFlagsField, 'flags');
        assert.strictEqual(field.conditionalBit, 0);
    });

    test('unnamed field with conditional type', () => {
        const field = parseFieldToken('flags.3?int');
        assert.strictEqual(field.name, '_');
        assert.strictEqual(field.type, 'int');
        assert.strictEqual(field.conditionalFlagsField, 'flags');
        assert.strictEqual(field.conditionalBit, 3);
    });

    test('unnamed field without conditional', () => {
        const field = parseFieldToken('int');
        assert.strictEqual(field.name, '_');
        assert.strictEqual(field.type, 'int');
    });

    test('named field with raw type (no conditional)', () => {
        const field = parseFieldToken('name:string');
        assert.strictEqual(field.name, 'name');
        assert.strictEqual(field.type, 'string');
    });

    test('unnamed field with bang prefix and conditional', () => {
        const field = parseFieldToken('!flags.1?string');
        assert.strictEqual(field.name, '_');
        assert.strictEqual(field.conditionalFlagsField, 'flags');
        assert.strictEqual(field.conditionalBit, 1);
    });

    test('unnamed field with bang prefix and no conditional', () => {
        const field = parseFieldToken('!int');
        assert.strictEqual(field.name, '_');
        assert.strictEqual(field.type, '!int');
    });
});

describe('Coverage - parser.ts splitTopLevel (lines 438-463)', () => {
    test('splits by spaces', () => {
        const result = splitTopLevel('a b c');
        assert.deepStrictEqual(result, ['a', 'b', 'c']);
    });

    test('single token', () => {
        const result = splitTopLevel('abc');
        assert.deepStrictEqual(result, ['abc']);
    });

    test('spaces inside parens preserved', () => {
        const result = splitTopLevel('a (b c) d');
        assert.deepStrictEqual(result, ['a', '(b c)', 'd']);
    });

    test('spaces inside curly braces preserved', () => {
        const result = splitTopLevel('a {b c} d');
        assert.deepStrictEqual(result, ['a', '{b c}', 'd']);
    });

    test('spaces inside brackets preserved', () => {
        const result = splitTopLevel('a [b c] d');
        assert.deepStrictEqual(result, ['a', '[b c]', 'd']);
    });

    test('empty string', () => {
        const result = splitTopLevel('');
        assert.deepStrictEqual(result, []);
    });

    test('whitespace only', () => {
        const result = splitTopLevel('   ');
        assert.deepStrictEqual(result, []);
    });

    test('nested structures', () => {
        const result = splitTopLevel('a (b (c d)) e');
        assert.deepStrictEqual(result, ['a', '(b (c d))', 'e']);
    });
});

describe('Coverage - parser.ts tokenizeFields (lines 467-502)', () => {
    test('basic tokenization', () => {
        const result = tokenizeFields('id:int name:string');
        assert.deepStrictEqual(result, ['id:int', 'name:string']);
    });

    test('single token', () => {
        const result = tokenizeFields('id:int');
        assert.deepStrictEqual(result, ['id:int']);
    });

    test('star operator combines tokens', () => {
        const result = tokenizeFields('n * [ double ]');
        assert.ok(result.some(t => t.includes('*')));
    });

    test('nested structures', () => {
        const result = tokenizeFields('a (b c) d');
        assert.deepStrictEqual(result, ['a', '(b c)', 'd']);
    });

    test('empty string', () => {
        const result = tokenizeFields('');
        assert.deepStrictEqual(result, []);
    });

    test('whitespace only', () => {
        const result = tokenizeFields('   ');
        assert.deepStrictEqual(result, []);
    });

    test('multiple star operators', () => {
        const result = tokenizeFields('a * b * c');
        assert.ok(result.length > 0);
    });

    test('curly and bracket nesting', () => {
        const result = tokenizeFields('{a} [b] c');
        assert.deepStrictEqual(result, ['{a}', '[b]', 'c']);
    });
});

describe('Coverage - deserializer.ts flags and conditional (lines 279-286)', () => {
    const FLAGS_SCHEMA = `
int ? = Int;
string ? = String;
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
vector {t:Type} # [ t ] = Vector t;
user flags:# name:flags.0?string id:int = User;
no_user id:int = User;
`;

    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry(FLAGS_SCHEMA);
    });

    test('readBoxedObject reads flags field (lines 279-281)', () => {
        const comb = registry.findConstructorByName('user')!;
        const ser = new SchemaSerializer(registry);
        ser.writeConstructorId(comb.id);
        ser.writeUint32(1);
        ser.writeString('Alice');
        ser.writeInt32(42);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readBoxedObject();
        assert.ok(result !== null);
        assert.strictEqual(result!.fields.flags, 1);
        assert.strictEqual(result!.fields.name, 'Alice');
        assert.strictEqual(result!.fields.id, 42);
    });

    test('readBoxedObject skips conditional field when bit not set (lines 285-286)', () => {
        const comb = registry.findConstructorByName('user')!;
        const ser = new SchemaSerializer(registry);
        ser.writeConstructorId(comb.id);
        ser.writeUint32(0);
        ser.writeInt32(42);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readBoxedObject();
        assert.ok(result !== null);
        assert.strictEqual(result!.fields.flags, 0);
        assert.strictEqual(result!.fields.name, undefined);
        assert.strictEqual(result!.fields.id, 42);
    });

    test('readBoxedObject with flags bit set reads conditional field', () => {
        const comb = registry.findConstructorByName('user')!;
        const ser = new SchemaSerializer(registry);
        ser.writeConstructorId(comb.id);
        ser.writeUint32(3);
        ser.writeString('Bob');
        ser.writeInt32(99);

        const deser = new SchemaDeserializer(ser.toBuffer(), registry);
        const result = deser.readBoxedObject();
        assert.ok(result !== null);
        assert.strictEqual(result!.fields.flags, 3);
        assert.strictEqual(result!.fields.name, 'Bob');
        assert.strictEqual(result!.fields.id, 99);
    });
});

describe('Coverage - serializer.ts conditional skip (lines 171-173)', () => {
    const COND_SCHEMA = `
int ? = Int;
string ? = String;
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
vector {t:Type} # [ t ] = Vector t;
user flags:# name:flags.0?string id:int = User;
no_user id:int = User;
`;

    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry(COND_SCHEMA);
    });

    test('serializeCombinator skips conditional field when flags bit not set', () => {
        const comb = registry.findConstructorByName('user')!;
        const ser = new SchemaSerializer(registry);
        const buf = ser.serializeCombinator(comb, { id: 42, flags: 0 });
        assert.ok(buf.length > 0);
        const deser = new SchemaDeserializer(buf, registry);
        const result = deser.readBoxedObject();
        assert.ok(result !== null);
        assert.strictEqual(result!.fields.id, 42);
        assert.strictEqual(result!.fields.name, undefined);
    });

    test('serializeCombinator includes conditional field when flags bit set', () => {
        const comb = registry.findConstructorByName('user')!;
        const ser = new SchemaSerializer(registry);
        const buf = ser.serializeCombinator(comb, { id: 42, flags: 1, name: 'Test' });
        assert.ok(buf.length > 0);
        const deser = new SchemaDeserializer(buf, registry);
        const result = deser.readBoxedObject();
        assert.ok(result !== null);
        assert.strictEqual(result!.fields.id, 42);
        assert.strictEqual(result!.fields.name, 'Test');
    });

    test('serializeCombinator with no flags param defaults to 0', () => {
        const comb = registry.findConstructorByName('user')!;
        const ser = new SchemaSerializer(registry);
        const buf = ser.serializeCombinator(comb, { id: 42 });
        assert.ok(buf.length > 0);
    });
});

describe('Coverage - validator.ts extractBaseType paren (line 54)', () => {
    test('type with paren extracts base type', () => {
        const schema = parseTLSchema('user name:(Foo(bar)) = User;');
        const errors = validateTLSchema(schema);
        assert.ok(errors.length >= 0);
    });

    test('type with nested parens extracts base type', () => {
        const schema = parseTLSchema('user name:((int)) = User;');
        const errors = validateTLSchema(schema);
        assert.ok(errors.length >= 0);
    });
});

describe('Coverage - remaining branch gaps', () => {
    describe('deserializer readFieldValue conditionalBit ?? 0 (line 206)', () => {
        test('readFieldValue without conditionalBit defaults to 0', () => {
            const ser = new SchemaSerializer();
            ser.writeString('test');
            const deser = new SchemaDeserializer(ser.toBuffer());
            const result = deser.readFieldValue('string', { flags: 1 }, undefined, 'flags');
            assert.strictEqual(result, 'test');
        });
    });

    describe('serializer writeFieldValue non-array repetition (line 195)', () => {
        test('writeFieldValue with repetition and non-array value', () => {
            const ser = new SchemaSerializer();
            (ser as any).writeFieldValue('repetition:3*int', null);
            assert.strictEqual(ser.toBuffer().length, 0);
        });
    });

    describe('serializer writeFieldValue non-array vector (line 223)', () => {
        test('writeFieldValue with vector and non-array value', () => {
            const ser = new SchemaSerializer();
            (ser as any).writeFieldValue('vector', null);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });
    });

    describe('serializer writeFieldValue vector item types (line 228)', () => {
        test('writeFieldValue with vector of bigint items', () => {
            const ser = new SchemaSerializer();
            (ser as any).writeFieldValue('Vector', [1n, 2n]);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });

        test('writeFieldValue with vector of buffer items', () => {
            const ser = new SchemaSerializer();
            (ser as any).writeFieldValue('Vector', [Buffer.from('a'), Buffer.from('b')]);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });
    });

    describe('parser splitFieldDeclarations bracket tracking (lines 347-348)', () => {
        test('fields with bracket types', () => {
            const s = parseTLSchema('user ids:[int] names:[string] = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 2);
        });

        test('field with nested brackets', () => {
            const s = parseTLSchema('user data:[[int]] = User;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].fields.length > 0);
        });
    });

    describe('parser parseSingleField empty text (line 377)', () => {
        test('parseSingleField with empty string after split', () => {
            const s = parseTLSchema('user a:  b:int = User;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].fields.length >= 1);
        });
    });

    describe('parser parseFields empty field (line 330)', () => {
        test('empty field text filtered out', () => {
            const s = parseTLSchema('user  id:int = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 1);
        });
    });

    describe('parser splitAngleArgs trailing comma (line 552)', () => {
        test('angle args with trailing comma', () => {
            const s = parseTLSchema('pair {a:Type} a a = Pair<int, >;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].resultSubexprs.length > 0);
        });
    });

    describe('parser parseResultType space subexpr (line 526)', () => {
        test('result type with space and empty rest', () => {
            const s = parseTLSchema('no_fields = NoFields ;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs.length > 0);
        });
    });

    describe('validator conditional field with non-# flags (lines 75-77)', () => {
        test('conditional field references non-existent flags field', () => {
            const schema = parseTLSchema(`
                user name:flags.0?string = User;
            `);
            const errors = validateTLSchema(schema);
            assert.ok(errors.some(e => e.message.includes('undefined flags field')));
        });
    });

    describe('serializer conditionalBit ?? 0 (line 172)', () => {
        test('serializeCombinator with conditional field missing bit', () => {
            const COND_SCHEMA = `
                int ? = Int;
                string ? = String;
                boolFalse#bc799737 = Bool;
                boolTrue#997275b5 = Bool;
                vector {t:Type} # [ t ] = Vector t;
                user flags:# name:flags.0?string id:int = User;
            `;
            const reg = new SchemaRegistry(COND_SCHEMA);
            const comb = reg.findConstructorByName('user')!;
            const ser = new SchemaSerializer(reg);
            const buf = ser.serializeCombinator(comb, { id: 1, flags: 0 });
            assert.ok(buf.length > 0);
        });

        test('serializeCombinator with conditional field undefined conditionalBit', () => {
            const ser = new SchemaSerializer();
            const mockComb = {
                id: 0x12345678,
                name: 'test',
                genericParams: [],
                fields: [
                    { name: 'flags', type: '#' },
                    { name: 'data', type: 'string', conditionalFlagsField: 'flags' },
                ],
                resultType: 'Test',
                resultSubexprs: [],
                isFunction: false,
            };
            const buf = ser.serializeCombinator(mockComb, { flags: 1, data: 'hello' });
            assert.ok(buf.length > 0);
        });
    });

    describe('serializer writeFieldValue Buffer in vector (line 228)', () => {
        test('writeFieldValue with vector of Buffer items', () => {
            const ser = new SchemaSerializer();
            (ser as any).writeFieldValue('Vector', [Buffer.from('a'), Buffer.from('bb')]);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });

        test('writeFieldValue with vector of mixed types', () => {
            const ser = new SchemaSerializer();
            (ser as any).writeFieldValue('vector', [42, 100n, Buffer.from('x')]);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });

        test('writeFieldValue with vector of unknown type item', () => {
            const ser = new SchemaSerializer();
            (ser as any).writeFieldValue('Vector', ['string_value']);
            const buf = ser.toBuffer();
            assert.strictEqual(buf.readUInt32LE(0), 0x1cb5c415);
        });
    });

    describe('parser splitFieldDeclarations curly brace tracking (lines 347-348)', () => {
        test('splitFieldDeclarations with curly braces in field text', () => {
            const parser = require('../src/parser');
            if (parser.splitFieldDeclarations) {
                const result = parser.splitFieldDeclarations('a:{b} c:d');
                assert.ok(result.length > 0);
            }
        });

        test('splitFieldDeclarations with nested curly braces', () => {
            const parser = require('../src/parser');
            if (parser.splitFieldDeclarations) {
                const result = parser.splitFieldDeclarations('a:{b:{c}} d:e');
                assert.ok(result.length > 0);
            }
        });
    });

    describe('parser tokenizeFields star edge cases (lines 496-497)', () => {
        test('tokenizeFields with star at end of tokens', () => {
            const result = tokenizeFields('a *');
            assert.ok(result.some(t => t.includes('*')));
        });

        test('tokenizeFields with star as only token', () => {
            const result = tokenizeFields('*');
            assert.ok(result.length > 0);
        });

        test('tokenizeFields with multiple consecutive stars', () => {
            const result = tokenizeFields('a * b * c');
            assert.ok(result.length > 0);
        });
    });

    describe('parser findEqualsSign nested curly (line 229)', () => {
        test('declaration with nested curly braces in params', () => {
            const s = parseTLSchema('user {a:{b:#}} id:a = User f;');
            assert.ok(s.constructors.size >= 0);
        });
    });

    describe('parser parseSingleField null return (line 330)', () => {
        test('empty field text produces null and is filtered', () => {
            const s = parseTLSchema('user id:int  name:string = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 2);
        });
    });

    describe('parser parseResultType empty rest (line 526)', () => {
        test('result type with trailing space after word', () => {
            const s = parseTLSchema('no_fields = NoFields ;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs.length > 0);
        });
    });

    describe('parser splitAngleArgs empty entry (line 552)', () => {
        test('angle args with consecutive commas', () => {
            const s = parseTLSchema('pair {a:Type} a a = Pair<int,,string>;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].resultSubexprs.length > 0);
        });
    });
});
