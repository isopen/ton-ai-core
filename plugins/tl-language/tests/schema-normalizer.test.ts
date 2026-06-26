import { strict as assert } from 'assert';
import { normalizeForCRC32, normalizeTypeRef, stripBang, computeConstructorId } from '../src/schema-normalizer';
import { crc32, crc32Hex } from '../src/crc32';

describe('Schema Normalizer', () => {
    test('normalizeForCRC32 strips semicolons', () => {
        assert.strictEqual(normalizeForCRC32('user = User;'), 'user = User');
    });

    test('normalizeForCRC32 strips comments', () => {
        assert.strictEqual(normalizeForCRC32('user // comment\n= User'), 'user = User');
        assert.strictEqual(normalizeForCRC32('user /* block */ = User'), 'user = User');
        assert.strictEqual(normalizeForCRC32('user /* multi\nline */ = User'), 'user = User');
    });

    test('normalizeForCRC32 strips curly braces', () => {
        assert.strictEqual(normalizeForCRC32('vector {t:Type} # [ t ] = Vector t'), 'vector t:Type # [ t ] = Vector t');
    });

    test('normalizeForCRC32 collapses whitespace', () => {
        assert.strictEqual(normalizeForCRC32('user  id:  int  =  User'), 'user id: int = User');
    });

    test('normalizeForCRC32 trims input', () => {
        assert.strictEqual(normalizeForCRC32('  user = User  '), 'user = User');
    });

    test('normalizeForCRC32 handles empty string', () => {
        assert.strictEqual(normalizeForCRC32(''), '');
    });

    test('computeConstructorId returns correct CRC32', () => {
        const id = computeConstructorId('boolTrue = Bool');
        assert.strictEqual(id, 0x997275b5);
    });

    test('computeConstructorId strips parens', () => {
        const id1 = computeConstructorId('user (id:int) = User');
        const id2 = computeConstructorId('user id:int = User');
        assert.strictEqual(id1, id2, 'parens should be stripped');
    });

    test('normalizeTypeRef strips leading %', () => {
        assert.strictEqual(normalizeTypeRef('%int'), 'int');
        assert.strictEqual(normalizeTypeRef('%string'), 'string');
    });

    test('normalizeTypeRef strips outer parens', () => {
        assert.strictEqual(normalizeTypeRef('(int)'), 'int');
        assert.strictEqual(normalizeTypeRef('(string)'), 'string');
        assert.strictEqual(normalizeTypeRef('(  int  )'), 'int');
    });

    test('normalizeTypeRef handles nested parens', () => {
        assert.strictEqual(normalizeTypeRef('(int)'), 'int');
    });

    test('normalizeTypeRef trims whitespace', () => {
        assert.strictEqual(normalizeTypeRef('  int  '), 'int');
    });

    test('stripBang detects bang', () => {
        const result = stripBang('!string');
        assert.strictEqual(result.type, 'string');
        assert.strictEqual(result.bang, true);
    });

    test('stripBang no bang', () => {
        const result = stripBang('string');
        assert.strictEqual(result.type, 'string');
        assert.strictEqual(result.bang, false);
    });

    test('stripBang trims whitespace', () => {
        const result = stripBang('  ! string  ');
        assert.strictEqual(result.type, 'string');
        assert.strictEqual(result.bang, true);
    });

    test('stripBang empty string', () => {
        const result = stripBang('');
        assert.strictEqual(result.type, '');
        assert.strictEqual(result.bang, false);
    });

    test('CRC32 of known values', () => {
        assert.strictEqual(crc32(normalizeForCRC32('boolTrue = Bool')), 0x997275b5);
        assert.strictEqual(crc32(normalizeForCRC32('boolFalse = Bool')), 0xbc799737);
        assert.strictEqual(crc32(normalizeForCRC32('vector {t:Type} # [ t ] = Vector t')), 0x1cb5c415);
        assert.strictEqual(crc32(normalizeForCRC32('user id:int first_name:string last_name:string = User')), 0xd23c81a3);
    });

    test('crc32Hex returns hex string', () => {
        const hex = crc32Hex('test');
        assert.ok(hex.startsWith('0x'));
        assert.strictEqual(hex.length, 10);
    });

    test('crc32 of empty string', () => {
        assert.strictEqual(crc32(''), 0);
    });
});
