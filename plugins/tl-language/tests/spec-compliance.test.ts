import { strict as assert } from 'assert';
import { parseTLSchema } from '../src/parser';
import { crc32 } from '../src/crc32';
import { normalizeForCRC32 } from '../src/schema-normalizer';

describe('TL Spec Compliance', () => {
    describe('Conditional Fields', () => {
        test('conditional field with parens: first_name:(fields.0?string)', () => {
            const s = parseTLSchema('user {fields:#} id:int first_name:(fields.0?string) last_name:(fields.1?string) = User fields;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs.length, 1, 'constructor count');
            const f = combs[0].fields.find(x => x.name === 'first_name' || (x.conditionalFlagsField === 'fields' && x.conditionalBit === 0));
            assert.ok(f !== undefined, 'first_name conditional field should exist');
            assert.strictEqual(f!.type, 'string', 'type should be string');
            assert.strictEqual(f!.conditionalFlagsField, 'fields', 'conditionalFlagsField');
            assert.strictEqual(f!.conditionalBit, 0, 'conditionalBit');
        });

        test('conditional field without parens: name:flags.0?string', () => {
            const s = parseTLSchema('user flags:# name:flags.0?string = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs.length, 1, 'constructor count');
            const f = combs[0].fields.find(x => x.conditionalFlagsField === 'flags' && x.conditionalBit === 0);
            assert.ok(f !== undefined, 'name conditional field should exist');
            assert.strictEqual(f!.type, 'string', 'type should be string');
        });

        test('flags field detected as # type', () => {
            const s = parseTLSchema('user {fields:#} id:int = User fields;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].genericParams.length, 1, 'generic param count');
            assert.strictEqual(combs[0].genericParams[0].name, 'fields', 'generic param name');
            assert.strictEqual(combs[0].genericParams[0].type, '#', 'generic param type');
        });
    });

    describe('Namespaces', () => {
        test('namespace constructor: auth.sendCode', () => {
            const s = parseTLSchema('auth.sendCode phone_number:string = auth.SentCode;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs.length, 1, 'constructor count');
            assert.strictEqual(combs[0].name, 'auth.sendCode', 'constructor name');
            assert.strictEqual(combs[0].resultType, 'auth.SentCode', 'result type');
        });

        test('namespace function: auth.sendCode', () => {
            const s = parseTLSchema('---functions---\nauth.sendCode phone_number:string = auth.SentCode;');
            const funcs = Array.from(s.functions.values());
            assert.strictEqual(funcs.length, 1, 'function count');
            assert.strictEqual(funcs[0].name, 'auth.sendCode', 'function name');
        });
    });

    describe('Generic Parameters', () => {
        test('vector generic params', () => {
            const s = parseTLSchema('vector {t:Type} # [ t ] = Vector t;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].genericParams.length, 1, 'generic param count');
            assert.strictEqual(combs[0].genericParams[0].name, 't', 'param name');
            assert.strictEqual(combs[0].genericParams[0].type, 'Type', 'param type');
        });

        test('pair generic params', () => {
            const s = parseTLSchema('pair {alpha:Type} alpha alpha = Pair alpha;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].genericParams.length, 1, 'generic param count');
            assert.strictEqual(combs[0].genericParams[0].name, 'alpha', 'param name');
            assert.strictEqual(combs[0].resultSubexprs[0], 'alpha', 'result subexpr');
        });
    });

    describe('Result Type Subexpressions', () => {
        test('Vector<t> syntax', () => {
            const s = parseTLSchema('vector {t:Type} # [ t ] = Vector t;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].resultType, 'Vector', 'resultType');
            assert.strictEqual(combs[0].resultSubexprs[0], 't', 'subexpr');
        });

        test('Pair<alpha> syntax', () => {
            const s = parseTLSchema('pair {alpha:Type} alpha alpha = Pair<alpha>;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].resultType, 'Pair', 'resultType');
            assert.strictEqual(combs[0].resultSubexprs[0], 'alpha', 'subexpr');
        });
    });

    describe('Bang Modifier', () => {
        test('bang in field type', () => {
            const s = parseTLSchema('msg_container messages:!(vector Message) = MessageContainer;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields[0].type, '!(vector Message)', 'field type with bang');
        });
    });

    describe('Anonymous Fields', () => {
        test('unnamed fields become _', () => {
            const s = parseTLSchema('int_couple int int = IntCouple;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 2, 'field count');
            assert.strictEqual(combs[0].fields[0].name, '_', 'field 0 name');
            assert.strictEqual(combs[0].fields[0].type, 'int', 'field 0 type');
            assert.strictEqual(combs[0].fields[1].name, '_', 'field 1 name');
            assert.strictEqual(combs[0].fields[1].type, 'int', 'field 1 type');
        });

        test('named fields stay named', () => {
            const s = parseTLSchema('int_couple first:int second:int = IntCouple;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields[0].name, 'first', 'field 0 name');
            assert.strictEqual(combs[0].fields[1].name, 'second', 'field 1 name');
        });
    });

    describe('Repeats', () => {
        test('repetition with multiplicity', () => {
            const s = parseTLSchema('matrix {m n : #} a : m * [ n * [ double ] ] = Matrix m n;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].genericParams.length, 2, 'generic params');
            assert.strictEqual(combs[0].fields[0].name, 'a', 'field name');
        });
    });

    describe('CRC32 Normalization', () => {
        test('normalize strips semicolons', () => {
            assert.strictEqual(normalizeForCRC32('user = User;'), 'user = User');
        });

        test('normalize strips comments', () => {
            assert.strictEqual(normalizeForCRC32('user // comment\n= User'), 'user = User');
            assert.strictEqual(normalizeForCRC32('user /* block */ = User'), 'user = User');
        });

        test('normalize strips curly braces but keeps content', () => {
            assert.strictEqual(normalizeForCRC32('vector {t:Type} # [ t ] = Vector t'), 'vector t:Type # [ t ] = Vector t');
        });

        test('normalize collapses whitespace', () => {
            assert.strictEqual(normalizeForCRC32('user  id:  int  =  User'), 'user id: int = User');
        });

        test('CRC32 of known values', () => {
            assert.strictEqual(crc32(normalizeForCRC32('boolTrue = Bool')), 0x997275b5);
            assert.strictEqual(crc32(normalizeForCRC32('boolFalse = Bool')), 0xbc799737);
            assert.strictEqual(crc32(normalizeForCRC32('vector {t:Type} # [ t ] = Vector t')), 0x1cb5c415);
            assert.strictEqual(crc32(normalizeForCRC32('user id:int first_name:string last_name:string = User')), 0xd23c81a3);
            assert.strictEqual(crc32(normalizeForCRC32('getUsers Vector int = Vector User')), 0x2d84d5f5);
        });
    });

    describe('Sections', () => {
        test('---functions--- splits correctly', () => {
            const s = parseTLSchema('int ? = Int;\n---functions---\ngetUser int = User;');
            assert.strictEqual(s.constructors.size, 1);
            assert.strictEqual(s.functions.size, 1);
        });

        test('---types--- after ---functions---', () => {
            const s = parseTLSchema('---functions---\nget int = Int;\n---types---\nuser int = User;');
            assert.strictEqual(s.constructors.size, 1);
            assert.strictEqual(s.functions.size, 1);
        });
    });
});
