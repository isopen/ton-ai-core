import { parseTLSchema } from '../src/parser';
import { crc32 } from '../src/crc32';
import { normalizeForCRC32 } from '../src/schema-normalizer';

function test(name: string, fn: () => void) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
    } catch (e: any) {
        console.log(`  ❌ ${name}: ${e.message}`);
    }
}

function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
}

function assertEqual(actual: any, expected: any, msg: string) {
    if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// === CONDITIONAL FIELDS (flags.N?type) ===
console.log('\n=== Conditional Fields ===');

test('conditional field with parens: first_name:(fields.0?string)', () => {
    const s = parseTLSchema('user {fields:#} id:int first_name:(fields.0?string) last_name:(fields.1?string) = User fields;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs.length, 1, 'constructor count');
    const f = combs[0].fields.find(x => x.name === 'first_name' || (x.conditionalFlagsField === 'fields' && x.conditionalBit === 0));
    assert(f !== undefined, 'first_name conditional field should exist');
    assertEqual(f!.type, 'string', 'type should be string');
    assertEqual(f!.conditionalFlagsField, 'fields', 'conditionalFlagsField');
    assertEqual(f!.conditionalBit, 0, 'conditionalBit');
});

test('conditional field without parens: name:flags.0?string', () => {
    const s = parseTLSchema('user flags:# name:flags.0?string = User;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs.length, 1, 'constructor count');
    const f = combs[0].fields.find(x => x.conditionalFlagsField === 'flags' && x.conditionalBit === 0);
    assert(f !== undefined, 'name conditional field should exist');
    assertEqual(f!.type, 'string', 'type should be string');
});

test('flags field detected as # type', () => {
    const s = parseTLSchema('user {fields:#} id:int = User fields;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs[0].genericParams.length, 1, 'generic param count');
    assertEqual(combs[0].genericParams[0].name, 'fields', 'generic param name');
    assertEqual(combs[0].genericParams[0].type, '#', 'generic param type');
});

// === NAMESPACES ===
console.log('\n=== Namespaces ===');

test('namespace constructor: auth.sendCode', () => {
    const s = parseTLSchema('auth.sendCode phone_number:string = auth.SentCode;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs.length, 1, 'constructor count');
    assertEqual(combs[0].name, 'auth.sendCode', 'constructor name');
    assertEqual(combs[0].resultType, 'auth.SentCode', 'result type');
});

test('namespace function: auth.sendCode', () => {
    const s = parseTLSchema('---functions---\nauth.sendCode phone_number:string = auth.SentCode;');
    const funcs = Array.from(s.functions.values());
    assertEqual(funcs.length, 1, 'function count');
    assertEqual(funcs[0].name, 'auth.sendCode', 'function name');
});

// === GENERIC PARAMS ===
console.log('\n=== Generic Parameters ===');

test('vector generic params', () => {
    const s = parseTLSchema('vector {t:Type} # [ t ] = Vector t;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs[0].genericParams.length, 1, 'generic param count');
    assertEqual(combs[0].genericParams[0].name, 't', 'param name');
    assertEqual(combs[0].genericParams[0].type, 'Type', 'param type');
});

test('pair generic params', () => {
    const s = parseTLSchema('pair {alpha:Type} alpha alpha = Pair alpha;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs[0].genericParams.length, 1, 'generic param count');
    assertEqual(combs[0].genericParams[0].name, 'alpha', 'param name');
    assertEqual(combs[0].resultSubexprs[0], 'alpha', 'result subexpr');
});

// === RESULT TYPE SUBEXPRESSIONS ===
console.log('\n=== Result Type Subexpressions ===');

test('Vector<t> syntax', () => {
    const s = parseTLSchema('vector {t:Type} # [ t ] = Vector t;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs[0].resultType, 'Vector', 'resultType');
    assertEqual(combs[0].resultSubexprs[0], 't', 'subexpr');
});

test('Pair<alpha> syntax', () => {
    const s = parseTLSchema('pair {alpha:Type} alpha alpha = Pair<alpha>;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs[0].resultType, 'Pair', 'resultType');
    assertEqual(combs[0].resultSubexprs[0], 'alpha', 'subexpr');
});

// === BANG MODIFIER ===
console.log('\n=== Bang Modifier ===');

test('bang in field type', () => {
    const s = parseTLSchema('msg_container messages:!(vector Message) = MessageContainer;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs[0].fields[0].type, '!(vector Message)', 'field type with bang');
});

// === INT COUPLE (ANONYMOUS FIELDS) ===
console.log('\n=== Anonymous Fields ===');

test('unnamed fields become _', () => {
    const s = parseTLSchema('int_couple int int = IntCouple;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs[0].fields.length, 2, 'field count');
    assertEqual(combs[0].fields[0].name, '_', 'field 0 name');
    assertEqual(combs[0].fields[0].type, 'int', 'field 0 type');
    assertEqual(combs[0].fields[1].name, '_', 'field 1 name');
    assertEqual(combs[0].fields[1].type, 'int', 'field 1 type');
});

test('named fields stay named', () => {
    const s = parseTLSchema('int_couple first:int second:int = IntCouple;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs[0].fields[0].name, 'first', 'field 0 name');
    assertEqual(combs[0].fields[1].name, 'second', 'field 1 name');
});

// === REPEATS (MULTIPLICITY) ===
console.log('\n=== Repeats ===');

test('repetition with multiplicity', () => {
    const s = parseTLSchema('matrix {m n : #} a : m * [ n * [ double ] ] = Matrix m n;');
    const combs = Array.from(s.constructors.values());
    assertEqual(combs[0].genericParams.length, 2, 'generic params');
    assertEqual(combs[0].fields[0].name, 'a', 'field name');
});

// === CRC32 NORMALIZATION ===
console.log('\n=== CRC32 Normalization ===');

test('normalize strips semicolons', () => {
    assertEqual(normalizeForCRC32('user = User;'), 'user = User', 'semicolon stripped');
});

test('normalize strips comments', () => {
    assertEqual(normalizeForCRC32('user // comment\n= User'), 'user = User', 'line comment stripped');
    assertEqual(normalizeForCRC32('user /* block */ = User'), 'user = User', 'block comment stripped');
});

test('normalize strips curly braces but keeps content', () => {
    assertEqual(normalizeForCRC32('vector {t:Type} # [ t ] = Vector t'), 'vector t:Type # [ t ] = Vector t', 'curly braces stripped');
});

test('normalize collapses whitespace', () => {
    assertEqual(normalizeForCRC32('user  id:  int  =  User'), 'user id: int = User', 'whitespace collapsed');
});

test('CRC32 of known values', () => {
    assertEqual(crc32(normalizeForCRC32('boolTrue = Bool')), 0x997275b5, 'boolTrue');
    assertEqual(crc32(normalizeForCRC32('boolFalse = Bool')), 0xbc799737, 'boolFalse');
    assertEqual(crc32(normalizeForCRC32('vector {t:Type} # [ t ] = Vector t')), 0x1cb5c415, 'vector');
    assertEqual(crc32(normalizeForCRC32('user id:int first_name:string last_name:string = User')), 0xd23c81a3, 'user');
    assertEqual(crc32(normalizeForCRC32('getUsers Vector int = Vector User')), 0x2d84d5f5, 'getUsers');
});

// === SECTIONS ===
console.log('\n=== Sections ===');

test('---functions--- splits correctly', () => {
    const s = parseTLSchema('int ? = Int;\n---functions---\ngetUser int = User;');
    assertEqual(s.constructors.size, 1, 'constructor count');
    assertEqual(s.functions.size, 1, 'function count');
});

test('---types--- after ---functions---', () => {
    const s = parseTLSchema('---functions---\nget int = Int;\n---types---\nuser int = User;');
    assertEqual(s.constructors.size, 1, 'constructor count');
    assertEqual(s.functions.size, 1, 'function count');
});

console.log('\nAll checks complete.');
