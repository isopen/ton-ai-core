import { strict as assert } from 'assert';
import { SchemaRegistry } from '../src/registry';
import { VECTOR_ID } from '../src/types';

const TEST_SCHEMA = `
int#a8509bda ? = Int;
long ? = Long;
double ? = Double;
string ? = String;
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
null = Null;

vector {t:Type} # [ t ] = Vector t;

user#d23c81a3 id:int first_name:string last_name:string = User;
no_user#c67599d1 id:int = User;
group id:int title:string description:string = Group;
no_group = Group;

point2d x:int y:int = Point2d;
point3d x:int y:int z:int = Point2d;

pair x:Object y:Object = Pair;

message msg_id:long seq_no:int bytes:int = Message;
msg_container#73f1f8dc messages:vector<Message> = MessageContainer;

---functions---

getUser#b0f732d5 id:int = User;
getUsers#2d84d5f5 id:Vector<int> = Vector<User>;
getConfig#e7a0ed2c = Config;
`;

describe('SchemaRegistry', () => {
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry(TEST_SCHEMA);
    });

    test('fromText static method', () => {
        const reg = SchemaRegistry.fromText(TEST_SCHEMA);
        assert.ok(reg instanceof SchemaRegistry);
    });

    test('getConstructorById', () => {
        const comb = registry.getConstructorById(0xd23c81a3);
        assert.ok(comb !== undefined);
        assert.strictEqual(comb.name, 'user');
    });

    test('getConstructorById returns undefined for unknown', () => {
        assert.strictEqual(registry.getConstructorById(0xdeadbeef), undefined);
    });

    test('getFunctionById', () => {
        const fn = registry.getFunctionById(0xb0f732d5);
        assert.ok(fn !== undefined);
        assert.strictEqual(fn.name, 'getUser');
    });

    test('getFunctionById returns undefined for unknown', () => {
        assert.strictEqual(registry.getFunctionById(0xdeadbeef), undefined);
    });

    test('getCombinatorById checks both constructors and functions', () => {
        const ctor = registry.getCombinatorById(0xd23c81a3);
        assert.ok(ctor !== undefined);
        assert.strictEqual(ctor.name, 'user');

        const fn = registry.getCombinatorById(0xb0f732d5);
        assert.ok(fn !== undefined);
        assert.strictEqual(fn.name, 'getUser');

        assert.strictEqual(registry.getCombinatorById(0xdeadbeef), undefined);
    });

    test('getConstructorsByName returns array', () => {
        const userCtors = registry.getConstructorsByName('user');
        assert.ok(userCtors.length >= 1);
        assert.ok(userCtors.some(c => c.name === 'user'));
    });

    test('getConstructorsByName returns empty array for unknown', () => {
        assert.deepStrictEqual(registry.getConstructorsByName('nonexistent'), []);
    });

    test('getFunctionsByName returns array', () => {
        const getUserFns = registry.getFunctionsByName('getUser');
        assert.strictEqual(getUserFns.length, 1);
        assert.strictEqual(getUserFns[0].name, 'getUser');
    });

    test('getFunctionsByName returns empty array for unknown', () => {
        assert.deepStrictEqual(registry.getFunctionsByName('nonexistent'), []);
    });

    test('getType returns type', () => {
        const userType = registry.getType('User');
        assert.ok(userType !== undefined);
        assert.strictEqual(userType.name, 'User');
        assert.strictEqual(userType.constructors.length, 2);
    });

    test('getType returns undefined for unknown', () => {
        assert.strictEqual(registry.getType('NonExistent'), undefined);
    });

    test('getAllTypes returns all types', () => {
        const types = registry.getAllTypes();
        assert.ok(types.length > 0);
        assert.ok(types.some(t => t.name === 'User'));
        assert.ok(types.some(t => t.name === 'Group'));
    });

    test('getAllConstructors returns all constructors', () => {
        const ctors = registry.getAllConstructors();
        assert.ok(ctors.length > 0);
        assert.ok(ctors.some(c => c.name === 'user'));
    });

    test('getAllFunctions returns all functions', () => {
        const fns = registry.getAllFunctions();
        assert.ok(fns.length > 0);
        assert.ok(fns.some(f => f.name === 'getUser'));
    });

    test('getConstructorsForType returns constructors for type', () => {
        const userCtors = registry.getConstructorsForType('User');
        assert.strictEqual(userCtors.length, 2);
    });

    test('getConstructorsForType returns empty for unknown type', () => {
        assert.deepStrictEqual(registry.getConstructorsForType('NonExistent'), []);
    });

    test('findConstructorByName returns first match', () => {
        const ctor = registry.findConstructorByName('user');
        assert.ok(ctor !== undefined);
        assert.strictEqual(ctor.name, 'user');
    });

    test('findConstructorByName returns undefined for unknown', () => {
        assert.strictEqual(registry.findConstructorByName('nonexistent'), undefined);
    });

    test('findFunctionByName returns first match', () => {
        const fn = registry.findFunctionByName('getUser');
        assert.ok(fn !== undefined);
        assert.strictEqual(fn.name, 'getUser');
    });

    test('findFunctionByName returns undefined for unknown', () => {
        assert.strictEqual(registry.findFunctionByName('nonexistent'), undefined);
    });

    test('hasConstructor', () => {
        assert.ok(registry.hasConstructor(0xd23c81a3));
        assert.ok(!registry.hasConstructor(0xdeadbeef));
    });

    test('hasFunction', () => {
        assert.ok(registry.hasFunction(0xb0f732d5));
        assert.ok(!registry.hasFunction(0xdeadbeef));
    });

    test('raw getter returns schema text', () => {
        assert.ok(registry.raw.length > 0);
    });

    test('constructorCount', () => {
        assert.ok(registry.constructorCount > 0);
    });

    test('functionCount', () => {
        assert.ok(registry.functionCount > 0);
    });

    test('typeCount', () => {
        assert.ok(registry.typeCount > 0);
    });

    test('empty schema', () => {
        const empty = new SchemaRegistry('');
        assert.strictEqual(empty.typeCount, 0);
        assert.strictEqual(empty.constructorCount, 0);
        assert.strictEqual(empty.functionCount, 0);
        assert.deepStrictEqual(empty.getAllTypes(), []);
        assert.deepStrictEqual(empty.getAllConstructors(), []);
        assert.deepStrictEqual(empty.getAllFunctions(), []);
    });
});
