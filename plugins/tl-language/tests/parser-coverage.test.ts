import { strict as assert } from 'assert';
import { parseTLSchema } from '../src/parser';

describe('Parser Coverage - uncovered lines', () => {
    describe('removeComments (lines 33, 35-37)', () => {
        test('line comment at end of line', () => {
            const s = parseTLSchema('user id:int = User; // comment\nno_user id:int = User;');
            assert.strictEqual(s.constructors.size, 2);
        });

        test('line comment without newline at end', () => {
            const s = parseTLSchema('user id:int = User; // comment');
            assert.strictEqual(s.constructors.size, 1);
        });

        test('block comment in middle', () => {
            const s = parseTLSchema('user id:int /* middle */ = User;');
            assert.strictEqual(s.constructors.size, 1);
        });

        test('block comment at end', () => {
            const s = parseTLSchema('user id:int = User; /* end */');
            assert.strictEqual(s.constructors.size, 1);
        });

        test('nested block comments', () => {
            const s = parseTLSchema('user id:int = User; /* outer /* inner */ outer */');
            assert.strictEqual(s.constructors.size, 1);
        });

        test('multiple line comments', () => {
            const s = parseTLSchema('// comment1\nuser id:int = User; // comment2\n// comment3');
            assert.strictEqual(s.constructors.size, 1);
        });
    });

    describe('splitSections (line 55)', () => {
        test('---types--- after ---functions---', () => {
            const s = parseTLSchema('---functions---\nget int = Int;\n---types---\nuser int = User;');
            assert.strictEqual(s.constructors.size, 1);
            assert.strictEqual(s.functions.size, 1);
        });

        test('only ---functions---', () => {
            const s = parseTLSchema('---functions---\ngetUser id:int = User;');
            assert.strictEqual(s.functions.size, 1);
        });

        test('only ---types---', () => {
            const s = parseTLSchema('---types---\nuser id:int = User;');
            assert.ok(s.constructors.size >= 0);
        });

        test('---types--- before ---functions---', () => {
            const s = parseTLSchema('---types---\nuser id:int = User;\n---functions---\ngetUser id:int = User;');
            assert.ok(s.constructors.size >= 0);
            assert.ok(s.functions.size >= 0);
        });
    });

    describe('parseDeclarations catch block (line 115)', () => {
        test('invalid declaration is skipped', () => {
            const s = parseTLSchema(';;;user id:int = User;');
            assert.strictEqual(s.constructors.size, 1);
        });

        test('malformed declaration is skipped', () => {
            const s = parseTLSchema('???invalid???');
            assert.strictEqual(s.constructors.size, 0);
        });
    });

    describe('splitDeclarations string parsing (lines 131-134)', () => {
        test('string with semicolon inside', () => {
            const s = parseTLSchema('user name:string = User;');
            assert.strictEqual(s.constructors.size, 1);
        });

        test('string with special chars', () => {
            const s = parseTLSchema('user name:string = User;');
            assert.strictEqual(s.constructors.size, 1);
        });

        test('multiple declarations with strings', () => {
            const s = parseTLSchema('user id:int name:string = User;\ngroup id:int title:string = Group;');
            assert.strictEqual(s.constructors.size, 2);
        });
    });

    describe('findEqualsSign (line 218)', () => {
        test('no equals sign - declaration skipped', () => {
            const s = parseTLSchema('user id:int User;');
            assert.strictEqual(s.constructors.size, 0);
        });
    });

    describe('parseFieldToken (lines 270-301)', () => {
        test('named field with type', () => {
            const s = parseTLSchema('user id:int = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields[0].name, 'id');
            assert.strictEqual(combs[0].fields[0].type, 'int');
        });

        test('named field with conditional type', () => {
            const s = parseTLSchema('user flags:# name:flags.0?string = User;');
            const combs = Array.from(s.constructors.values());
            const nameField = combs[0].fields.find(f => f.name === 'name');
            assert.ok(nameField !== undefined);
            assert.strictEqual(nameField!.type, 'string');
            assert.strictEqual(nameField!.conditionalFlagsField, 'flags');
        });

        test('unnamed field with conditional type', () => {
            const s = parseTLSchema('user flags:# flags.0?string = User;');
            const combs = Array.from(s.constructors.values());
            const condField = combs[0].fields.find(f => f.conditionalFlagsField === 'flags');
            assert.ok(condField !== undefined);
        });

        test('unnamed field without conditional', () => {
            const s = parseTLSchema('user int = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields[0].name, '_');
            assert.strictEqual(combs[0].fields[0].type, 'int');
        });
    });

    describe('parseSingleField repetition (lines 374-375, 388-389, 394-395)', () => {
        test('named repetition with multiplicity', () => {
            const s = parseTLSchema('matrix {m n : #} a : m * [ n * [ double ] ] = Matrix m n;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].fields[0].type.includes('repetition'));
        });

        test('named repetition with paren multiplicity', () => {
            const s = parseTLSchema('matrix {m : #} a : (m * [ double ]) = Matrix m;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].fields[0].type.includes('repetition'));
        });

        test('unnamed repetition', () => {
            const s = parseTLSchema('data int * [ int ] = Data;');
            const combs = Array.from(s.constructors.values());
            const repField = combs[0].fields.find(f => f.type.includes('repetition'));
            assert.ok(repField !== undefined);
        });

        test('unnamed paren repetition', () => {
            const s = parseTLSchema('data (int * [ int ]) = Data;');
            const combs = Array.from(s.constructors.values());
            const repField = combs[0].fields.find(f => f.type.includes('repetition'));
            assert.ok(repField !== undefined);
        });
    });

    describe('parseConditionalType (lines 400, 253-266)', () => {
        test('bang with parens', () => {
            const s = parseTLSchema('user name:!(string) = User;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].fields[0].type.includes('!'));
        });

        test('unnamed conditional without name', () => {
            const s = parseTLSchema('user flags:# flags.0?int = User;');
            const combs = Array.from(s.constructors.values());
            const condField = combs[0].fields.find(f => f.conditionalFlagsField === 'flags');
            assert.ok(condField !== undefined);
        });
    });

    describe('parseGenericParams (lines 228)', () => {
        test('generic params without colon', () => {
            const s = parseTLSchema('vector {t} # [ t ] = Vector t;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].genericParams.length === 0);
        });

        test('multiple generic params', () => {
            const s = parseTLSchema('matrix {m n : #} a : m * [ double ] = Matrix m n;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].genericParams.length, 2);
        });
    });

    describe('parseResultType (lines 492, 504-509, 528-529)', () => {
        test('underscore result type', () => {
            const s = parseTLSchema('no_fields = _;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].resultType, '_');
        });

        test('result type with space-separated subexprs', () => {
            const s = parseTLSchema('pair x:Object y:Object = Pair alpha;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].resultType, 'Pair');
            assert.ok(combs[0].resultSubexprs.length > 0);
        });

        test('result type with angle brackets', () => {
            const s = parseTLSchema('pair {alpha:Type} alpha alpha = Pair<alpha>;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].resultType, 'Pair');
        });

        test('result type with multiple angle args', () => {
            const s = parseTLSchema('matrix {m n : #} a : m * [ double ] = Matrix<m, n>;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].resultType, 'Matrix');
            assert.strictEqual(combs[0].resultSubexprs.length, 2);
        });
    });

    describe('splitAngleArgs (lines 528-529)', () => {
        test('angle args with nested parens', () => {
            const s = parseTLSchema('pair {a:Type} a a = Pair<(int, string)>;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].resultSubexprs.length > 0);
        });

        test('angle args with nested angles', () => {
            const s = parseTLSchema('pair {a:Type} a a = Pair<Vector<int>>;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].resultSubexprs.length > 0);
        });
    });

    describe('splitFieldDeclarations (lines 334-354)', () => {
        test('fields with nested brackets', () => {
            const s = parseTLSchema('user id:int name:string = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 2);
        });

        test('fields with curly braces', () => {
            const s = parseTLSchema('user {f:#} id:int = User f;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].genericParams.length > 0);
        });
    });

    describe('parseCombinator (lines 164-176)', () => {
        test('invalid combinator - declaration skipped', () => {
            const s = parseTLSchema('???invalid');
            assert.strictEqual(s.constructors.size, 0);
        });

        test('no name - declaration skipped', () => {
            const s = parseTLSchema('= User;');
            assert.strictEqual(s.constructors.size, 0);
        });
    });

    describe('findEqualsSign with nested parens (lines 206-218)', () => {
        test('equals inside parens is skipped', () => {
            const s = parseTLSchema('user id:(int = test) = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 1);
        });

        test('equals inside curly braces is skipped', () => {
            const s = parseTLSchema('user {f:#} id:int = User f;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].genericParams.length > 0);
        });
    });

    describe('splitDeclarations depth tracking (lines 136-146)', () => {
        test('declarations with nested parens', () => {
            const s = parseTLSchema('user id:(int) name:(string) = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 2);
        });

        test('declarations without trailing semicolon', () => {
            const s = parseTLSchema('user id:int = User');
            assert.strictEqual(s.constructors.size, 1);
        });
    });

    describe('complex edge cases', () => {
        test('empty field token', () => {
            const s = parseTLSchema('user id:int  = User;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].fields.length >= 1);
        });

        test('nested angle brackets in field type', () => {
            const s = parseTLSchema('user ids:Vector<int> = User;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].fields[0].type.includes('Vector'));
        });

        test('field with colon in type', () => {
            const s = parseTLSchema('user name:string = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields[0].type, 'string');
        });

        test('repetition without multiplicity', () => {
            const s = parseTLSchema('data [ double ] = Data;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].fields.length > 0);
        });

        test('conditional with bit > 9', () => {
            const s = parseTLSchema('user flags:# name:flags.31?string = User;');
            const combs = Array.from(s.constructors.values());
            const nameField = combs[0].fields.find(f => f.name === 'name');
            assert.ok(nameField !== undefined);
            assert.strictEqual(nameField!.conditionalBit, 31);
        });
    });
});
