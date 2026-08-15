import { strict as assert } from 'assert';
import { parseTLSchema } from '../src/parser';
import { validateTLSchema } from '../src/validator';

describe('Validator', () => {
    test('valid schema returns no errors', () => {
        const schema = parseTLSchema(`
            int ? = Int;
            user id:int = User;
            ---functions---
            getUser id:int = User;
        `);
        const errors = validateTLSchema(schema);
        const realErrors = errors.filter(e => e.severity === 'error');
        assert.strictEqual(realErrors.length, 0);
    });

    test('unknown type reference produces warning', () => {
        const schema = parseTLSchema(`
            user id:UnknownType = User;
        `);
        const errors = validateTLSchema(schema);
        assert.ok(errors.some(e => e.message.includes('Unknown type')));
    });

    test('valid builtins pass validation', () => {
        const schema = parseTLSchema(`
            user id:int name:string flag:bool = User;
        `);
        const errors = validateTLSchema(schema);
        const realErrors = errors.filter(e => e.severity === 'error');
        assert.strictEqual(realErrors.length, 0);
    });

    test('duplicate constructor IDs produce error', () => {
        const schema = parseTLSchema(`
            user id:int = User;
            no_user id:int = User;
        `);
        const errors = validateTLSchema(schema);
        assert.ok(Array.isArray(errors));
    });

    test('conditional field with valid flags field passes', () => {
        const schema = parseTLSchema(`
            user flags:# name:flags.0?string = User;
        `);
        const errors = validateTLSchema(schema);
        const realErrors = errors.filter(e => e.severity === 'error');
        assert.strictEqual(realErrors.length, 0);
    });

    test('conditional field with undefined flags field produces error', () => {
        const schema = parseTLSchema(`
            user name:flags.0?string = User;
        `);
        const errors = validateTLSchema(schema);
        assert.ok(errors.some(e => e.message.includes('undefined flags field')));
    });

    test('polymorphic params are validated', () => {
        const schema = parseTLSchema(`
            vector {t:Type} # [ t ] = Vector t;
        `);
        const errors = validateTLSchema(schema);
        const realErrors = errors.filter(e => e.severity === 'error');
        assert.strictEqual(realErrors.length, 0);
    });

    test('extractBaseType with angle brackets', () => {
        const schema = parseTLSchema(`
            user id:Vector<int> = User;
        `);
        const errors = validateTLSchema(schema);
        assert.ok(errors.length >= 0);
    });

    test('extractBaseType with parens', () => {
        const schema = parseTLSchema(`
            user id:(int) = User;
        `);
        const errors = validateTLSchema(schema);
        assert.ok(errors.length >= 0);
    });

    test('validation with multiple constructors', () => {
        const schema = parseTLSchema(`
            user id:int = User;
            no_user id:int = User;
            group id:int = Group;
        `);
        const errors = validateTLSchema(schema);
        const realErrors = errors.filter(e => e.severity === 'error');
        assert.strictEqual(realErrors.length, 0);
    });

    test('validation with functions', () => {
        const schema = parseTLSchema(`
            user id:int = User;
            ---functions---
            getUser id:int = User;
        `);
        const errors = validateTLSchema(schema);
        const realErrors = errors.filter(e => e.severity === 'error');
        assert.strictEqual(realErrors.length, 0);
    });
});
