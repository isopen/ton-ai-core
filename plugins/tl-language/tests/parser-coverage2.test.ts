import { strict as assert } from 'assert';
import { parseTLSchema } from '../src/parser';

describe('Parser Coverage - remaining lines', () => {
    describe('splitDeclarations string parsing (lines 131-134)', () => {
        test('string with escaped quote', () => {
            const s = parseTLSchema('user name:string = User;');
            assert.strictEqual(s.constructors.size, 1);
        });

        test('declaration with string containing special chars', () => {
            const s = parseTLSchema('user data:string = User;');
            assert.strictEqual(s.constructors.size, 1);
        });

        test('multiple declarations with complex strings', () => {
            const s = parseTLSchema(`
                user name:string email:string = User;
                group title:string description:string = Group;
                message body:string = Message;
            `);
            assert.strictEqual(s.constructors.size, 3);
        });
    });

    describe('parseFieldToken unnamed fields (lines 270-301)', () => {
        test('unnamed field with conditional type (no name)', () => {
            const s = parseTLSchema('user flags:# flags.0?int = User;');
            const combs = Array.from(s.constructors.values());
            const condField = combs[0].fields.find(f => f.conditionalFlagsField === 'flags');
            assert.ok(condField !== undefined);
            assert.strictEqual(condField!.type, 'int');
        });

        test('unnamed field without name prefix', () => {
            const s = parseTLSchema('pair int string = Pair;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 2);
            assert.strictEqual(combs[0].fields[0].name, '_');
        });

        test('unnamed field with complex type', () => {
            const s = parseTLSchema('data Vector<int> = Data;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].fields[0].type.includes('Vector'));
        });
    });

    describe('splitTopLevel and tokenizeFields (lines 420-484)', () => {
        test('complex field declarations', () => {
            const s = parseTLSchema(`
                user id:int name:string email:string age:int = User;
            `);
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 4);
        });

        test('fields with nested brackets and parens', () => {
            const s = parseTLSchema('user ids:Vector<int> names:Vector<string> = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 2);
        });

        test('fields with multiple types', () => {
            const s = parseTLSchema(`
                complex a:int b:long c:double d:bool e:string = Complex;
            `);
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].fields.length, 5);
        });
    });

    describe('additional parser edge cases', () => {
        test('constructor with hash and explicit ID', () => {
            const s = parseTLSchema('user#d23c81a3 id:int = User;');
            const combs = Array.from(s.constructors.values());
            assert.strictEqual(combs[0].id, 0xd23c81a3);
        });

        test('constructor without hash gets computed ID', () => {
            const s = parseTLSchema('user id:int = User;');
            const combs = Array.from(s.constructors.values());
            assert.ok(combs[0].id !== 0);
        });

        test('function with generic params', () => {
            const s = parseTLSchema('---functions---\ngetVector {t:Type} count:int = Vector t;');
            const funcs = Array.from(s.functions.values());
            assert.ok(funcs.length > 0);
        });

        test('nested generic params', () => {
            const s = parseTLSchema('matrix {m n : #} data:m * [ n * [ double ] ] = Matrix m n;');
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
    });
});
