import { strict as assert } from 'assert';
import { parseTLSchema } from '../src/parser';

describe('Parser Extended', () => {
    test('handles line comments', () => {
        const s = parseTLSchema('user id:int = User; // this is a comment');
        assert.ok(s.constructors.size > 0);
    });

    test('handles block comments', () => {
        const s = parseTLSchema('user id:int = User; /* block comment */');
        assert.ok(s.constructors.size > 0);
    });

    test('handles multi-line block comments', () => {
        const s = parseTLSchema('user id:int = User; /* multi\nline\ncomment */');
        assert.ok(s.constructors.size > 0);
    });

    test('handles empty fields', () => {
        const s = parseTLSchema('no_fields = NoFields;');
        assert.ok(s.constructors.size > 0);
    });

    test('handles conditional field with parens syntax', () => {
        const s = parseTLSchema('user {f:#} id:int name:(f.0?string) = User f;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs.length > 0);
        const nameField = combs[0].fields.find(f => f.name === 'name');
        assert.ok(nameField !== undefined);
        assert.strictEqual(nameField!.conditionalFlagsField, 'f');
        assert.strictEqual(nameField!.conditionalBit, 0);
    });

    test('handles conditional field without parens', () => {
        const s = parseTLSchema('user flags:# name:flags.0?string = User;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs.length > 0);
        const nameField = combs[0].fields.find(f => f.name === 'name');
        assert.ok(nameField !== undefined);
        assert.strictEqual(nameField!.conditionalFlagsField, 'flags');
        assert.strictEqual(nameField!.conditionalBit, 0);
    });

    test('handles generic params', () => {
        const s = parseTLSchema('vector {t:Type} # [ t ] = Vector t;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs.length > 0);
        assert.ok(combs[0].genericParams.length > 0);
    });

    test('handles result type with subexpressions', () => {
        const s = parseTLSchema('pair {alpha:Type} alpha alpha = Pair alpha;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs.length > 0);
        assert.strictEqual(combs[0].resultType, 'Pair');
        assert.ok(combs[0].resultSubexprs.length > 0);
    });

    test('handles bang modifier', () => {
        const s = parseTLSchema('msg_container messages:!(vector Message) = MessageContainer;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs.length > 0);
        assert.ok(combs[0].fields[0].type.includes('!'));
    });

    test('handles unnamed fields', () => {
        const s = parseTLSchema('int_couple int int = IntCouple;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs.length > 0);
        assert.strictEqual(combs[0].fields.length, 2);
        assert.strictEqual(combs[0].fields[0].name, '_');
    });

    test('handles named fields', () => {
        const s = parseTLSchema('user id:int name:string = User;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs.length > 0);
        assert.strictEqual(combs[0].fields[0].name, 'id');
        assert.strictEqual(combs[0].fields[1].name, 'name');
    });

    test('handles repetition fields', () => {
        const s = parseTLSchema('matrix {m n : #} a : m * [ n * [ double ] ] = Matrix m n;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs.length > 0);
        assert.ok(combs[0].genericParams.length > 0);
    });

    test('handles sections', () => {
        const s = parseTLSchema('int ? = Int;\n---functions---\ngetUser id:int = User;');
        assert.strictEqual(s.constructors.size, 1);
        assert.strictEqual(s.functions.size, 1);
    });

    test('handles multiple sections', () => {
        const s = parseTLSchema('---functions---\nget int = Int;\n---types---\nuser int = User;');
        assert.strictEqual(s.constructors.size, 1);
        assert.strictEqual(s.functions.size, 1);
    });

    test('handles empty schema', () => {
        const s = parseTLSchema('');
        assert.strictEqual(s.types.size, 0);
        assert.strictEqual(s.constructors.size, 0);
        assert.strictEqual(s.functions.size, 0);
    });

    test('handles schema with only comments', () => {
        const s = parseTLSchema('// just a comment\n/* block comment */');
        assert.strictEqual(s.types.size, 0);
    });

    test('handles complex types', () => {
        const s = parseTLSchema('user id:int name:string age:int = User;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs.length > 0);
        assert.strictEqual(combs[0].fields.length, 3);
    });

    test('handles constructor with hash', () => {
        const s = parseTLSchema('user#d23c81a3 id:int = User;');
        const combs = Array.from(s.constructors.values());
        assert.ok(combs.length > 0);
        assert.strictEqual(combs[0].id, 0xd23c81a3);
    });

    test('handles function declaration', () => {
        const s = parseTLSchema('---functions---\ngetUser id:int = User;');
        assert.strictEqual(s.functions.size, 1);
        const fn = Array.from(s.functions.values())[0];
        assert.strictEqual(fn.name, 'getUser');
    });

    test('handles type with multiple constructors', () => {
        const s = parseTLSchema(`
            user id:int = User;
            no_user id:int = User;
        `);
        const userType = s.types.get('User');
        assert.ok(userType !== undefined);
        assert.strictEqual(userType!.constructors.length, 2);
    });

    test('handles vector type', () => {
        const s = parseTLSchema('vector {t:Type} # [ t ] = Vector t;');
        const vectorType = s.types.get('Vector');
        assert.ok(vectorType !== undefined);
    });

    test('handles bool types', () => {
        const s = parseTLSchema('boolFalse#bc799737 = Bool;\nboolTrue#997275b5 = Bool;');
        assert.strictEqual(s.constructors.size, 2);
    });

    test('handles null type', () => {
        const s = parseTLSchema('null = Null;');
        assert.strictEqual(s.constructors.size, 1);
    });
});
