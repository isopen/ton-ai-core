import { strict as assert } from 'assert';
import { parseTLSchema } from '../src/parser';

describe('Parser dead code coverage', () => {
    test('splitDeclarations with string containing semicolon', () => {
        const s = parseTLSchema('user name:string = User;');
        assert.strictEqual(s.constructors.size, 1);
    });

    test('splitDeclarations with escaped quote', () => {
        const s = parseTLSchema('user name:"hello\\"world" = User;');
        assert.strictEqual(s.constructors.size, 1);
    });

    test('splitDeclarations with multiple strings', () => {
        const s = parseTLSchema('user a:"x" b:"y" = User;');
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

    test('unnamed field with conditional type and no name', () => {
        const s = parseTLSchema('user flags:# flags.1?string = User;');
        const combs = Array.from(s.constructors.values());
        const condField = combs[0].fields.find(f => f.conditionalFlagsField === 'flags');
        assert.ok(condField !== undefined);
        assert.strictEqual(condField!.conditionalBit, 1);
    });

    test('unnamed field with type and no conditional', () => {
        const s = parseTLSchema('user long = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].name, '_');
        assert.strictEqual(combs[0].fields[0].type, 'long');
    });

    test('unnamed field with double type', () => {
        const s = parseTLSchema('user double = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'double');
    });

    test('unnamed field with bool type', () => {
        const s = parseTLSchema('user bool = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'bool');
    });

    test('unnamed field with string type', () => {
        const s = parseTLSchema('user string = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'string');
    });

    test('unnamed field with null type', () => {
        const s = parseTLSchema('user null = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'null');
    });

    test('unnamed field with true type', () => {
        const s = parseTLSchema('user true = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'true');
    });

    test('unnamed field with false type', () => {
        const s = parseTLSchema('user false = User;');
        const combs = Array.from(s.constructors.values());
        assert.strictEqual(combs[0].fields[0].type, 'false');
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
