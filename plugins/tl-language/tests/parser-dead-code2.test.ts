import { strict as assert } from 'assert';
import { parseTLSchema } from '../src/parser';

describe('Parser dead code direct calls', () => {
    test('splitDeclarations with string containing semicolons', () => {
        const s = parseTLSchema('user name:string = User;');
        assert.strictEqual(s.constructors.size, 1);
    });

    test('splitDeclarations with escaped quote', () => {
        const s = parseTLSchema('user name:"hello\\"world" = User;');
        assert.strictEqual(s.constructors.size, 1);
    });

    test('splitDeclarations with multiple strings and semicolons', () => {
        const s = parseTLSchema('user a:"x;y" b:"z" = User;');
        assert.strictEqual(s.constructors.size, 1);
    });

    test('unnamed field with conditional type', () => {
        const s = parseTLSchema('user flags:# flags.0?int = User;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs[0].fields.some(f => f.conditionalFlagsField === 'flags'));
    });

    test('unnamed field without name prefix', () => {
        const s = parseTLSchema('pair int string = Pair;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields.length, 2);
    });

    test('unnamed field with complex type', () => {
        const s = parseTLSchema('data Vector<int> = Data;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs[0].fields[0].type.includes('Vector'));
    });

    test('unnamed repetition field', () => {
        const s = parseTLSchema('data int * [ string ] = Data;');
        const combs = Array.from(s.constructors.values());
        const repField = combs[0].fields.find(f => f.type.includes('repetition'));
        assert.ok(repField !== undefined);
    });

    test('unnamed paren repetition field', () => {
        const s = parseTLSchema('data (int * [ string ]) = Data;');
        const combs = Array.from(s.constructors.values());
        const repField = combs[0].fields.find(f => f.type.includes('repetition'));
        assert.ok(repField !== undefined);
    });

    test('unnamed conditional field', () => {
        const s = parseTLSchema('user flags:# flags.0?int = User;');
        const combs = Array.from(s.constructors.values());
        const condField = combs[0].fields.find(f => f.conditionalFlagsField === 'flags');
        assert.ok(condField !== undefined);
        assert.strictEqual(condField!.type, 'int');
    });

    test('unnamed field with type', () => {
        const s = parseTLSchema('user int = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].name, '_');
    });

    test('unnamed conditional field with bit', () => {
        const s = parseTLSchema('user flags:# flags.1?string = User;');
        const combs = Array.from(s.constructors.values());
        const condField = combs[0].fields.find(f => f.conditionalFlagsField === 'flags');
        assert.ok(condField !== undefined);
        assert.strictEqual(condField!.conditionalBit, 1);
    });

    test('unnamed field with various types', () => {
        const s = parseTLSchema(`
            user long = User;
            user double = User;
            user bool = User;
            user string = User;
            user null = User;
            user true = User;
            user false = User;
        `);
        assert.strictEqual(s.constructors.size, 7);
    });

    test('unnamed field with Object type', () => {
        const s = parseTLSchema('user Object = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Object');
    });

    test('unnamed field with Vector type', () => {
        const s = parseTLSchema('user Vector = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Vector');
    });

    test('unnamed field with vector type', () => {
        const s = parseTLSchema('user vector = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'vector');
    });

    test('unnamed field with # type', () => {
        const s = parseTLSchema('user # = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, '#');
    });

    test('unnamed field with int128 type', () => {
        const s = parseTLSchema('user int128 = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'int128');
    });

    test('unnamed field with int256 type', () => {
        const s = parseTLSchema('user int256 = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'int256');
    });

    test('unnamed field with bytes type', () => {
        const s = parseTLSchema('user bytes = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'bytes');
    });

    test('unnamed field with Int type', () => {
        const s = parseTLSchema('user Int = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Int');
    });

    test('unnamed field with Long type', () => {
        const s = parseTLSchema('user Long = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Long');
    });

    test('unnamed field with Double type', () => {
        const s = parseTLSchema('user Double = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Double');
    });

    test('unnamed field with String type', () => {
        const s = parseTLSchema('user String = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'String');
    });

    test('unnamed field with Bool type', () => {
        const s = parseTLSchema('user Bool = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Bool');
    });

    test('unnamed field with True type', () => {
        const s = parseTLSchema('user True = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'True');
    });

    test('unnamed field with False type', () => {
        const s = parseTLSchema('user False = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'False');
    });

    test('unnamed field with Null type', () => {
        const s = parseTLSchema('user Null = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Null');
    });

    test('unnamed field with Object type', () => {
        const s = parseTLSchema('user Object = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Object');
    });

    test('unnamed field with Vector type', () => {
        const s = parseTLSchema('user Vector = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'Vector');
    });

    test('unnamed field with vector type', () => {
        const s = parseTLSchema('user vector = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'vector');
    });

    test('unnamed field with # type', () => {
        const s = parseTLSchema('user # = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, '#');
    });
});
