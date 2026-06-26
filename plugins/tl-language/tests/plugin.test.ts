import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { TLLanguagePlugin } from '../src/index';
import { SchemaRegistry } from '../src/registry';
import { VECTOR_ID } from '../src/types';

function createTestContext() {
    return {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        events: { emit: () => {}, on: () => {}, off: () => {} },
        config: {},
    } as any;
}

const TEST_SCHEMA = `
int ? = Int;
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
vector {t:Type} # [ t ] = Vector t;
user#d23c81a3 id:int first_name:string last_name:string = User;
no_user#c67599d1 id:int = User;
group id:int title:string = Group;
---functions---
getUser#b0f732d5 id:int = User;
getConfig#e7a0ed2c = Config;
`;

describe('TLLanguagePlugin', () => {
    test('plugin metadata', () => {
        const plugin = new TLLanguagePlugin();
        assert.strictEqual(plugin.metadata.name, 'tl-language');
        assert.strictEqual(plugin.metadata.version, '0.1.0');
    });

    test('initialize and activate', async () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        await plugin.onActivate();
        await plugin.onDeactivate();
    });

    test('shutdown clears state', async () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);
        await plugin.onActivate();
        await plugin.shutdown();
        assert.strictEqual(plugin.getRegistry(), null);
        assert.strictEqual(plugin.getSchema(), null);
    });

    test('loadSchema populates registry', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const registry = plugin.getRegistry();
        assert.ok(registry !== null);
        assert.ok(registry!.typeCount > 0);
        assert.ok(registry!.constructorCount > 0);
        assert.ok(registry!.functionCount > 0);
    });

    test('getSchema returns parsed schema', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const schema = plugin.getSchema();
        assert.ok(schema !== null);
        assert.ok(schema!.types.size > 0);
    });

    test('lookupConstructor', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const ctor = plugin.lookupConstructor(0xd23c81a3);
        assert.ok(ctor !== null);
        assert.strictEqual(ctor!.name, 'user');

        assert.strictEqual(plugin.lookupConstructor(0xdeadbeef), null);
    });

    test('lookupFunction', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const fn = plugin.lookupFunction(0xb0f732d5);
        assert.ok(fn !== null);
        assert.strictEqual(fn!.name, 'getUser');

        assert.strictEqual(plugin.lookupFunction(0xdeadbeef), null);
    });

    test('lookupType', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const type = plugin.lookupType('User');
        assert.ok(type !== null);

        assert.strictEqual(plugin.lookupType('NonExistent'), null);
    });

    test('findConstructor', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const ctor = plugin.findConstructor('user');
        assert.ok(ctor !== null);
        assert.strictEqual(ctor!.name, 'user');

        assert.strictEqual(plugin.findConstructor('nonexistent'), null);
    });

    test('findFunction', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const fn = plugin.findFunction('getUser');
        assert.ok(fn !== null);
        assert.strictEqual(fn!.name, 'getUser');

        assert.strictEqual(plugin.findFunction('nonexistent'), null);
    });

    test('serialize', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const ctor = plugin.findConstructor('no_user')!;
        const buf = plugin.serialize(ctor, { id: 42 });
        assert.ok(buf.length > 0);
    });

    test('serializeWithId', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const buf = plugin.serializeWithId(0xc67599d1, { id: 42 });
        assert.ok(buf.length > 0);
    });

    test('serializeWithId throws for unknown constructor', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        assert.throws(() => plugin.serializeWithId(0xdeadbeef, {}), /Constructor not found/);
    });

    test('deserialize', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const ctor = plugin.findConstructor('no_user')!;
        const buf = plugin.serialize(ctor, { id: 42 });
        const result = plugin.deserialize(buf);
        assert.ok(result !== null);
        assert.strictEqual(result!.fields.id, 42);
    });

    test('deserialize throws without schema', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        assert.throws(() => plugin.deserialize(Buffer.alloc(4)), /No schema loaded/);
    });

    test('validateSchema', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const errors = plugin.validateSchema();
        assert.ok(Array.isArray(errors));
    });

    test('validateSchema throws without schema', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        assert.throws(() => plugin.validateSchema(), /No schema loaded/);
    });

    test('computeId', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        const id = plugin.computeId('user id:int first_name:string last_name:string = User');
        assert.strictEqual(id, 0xd23c81a3);
    });

    test('computeIdFromName', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        const id = plugin.computeIdFromName('boolTrue');
        assert.ok(typeof id === 'number');
    });

    test('getConstructorCount', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        assert.ok(plugin.getConstructorCount() > 0);
    });

    test('getConstructorCount without schema', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        assert.strictEqual(plugin.getConstructorCount(), 0);
    });

    test('getFunctionCount', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        assert.ok(plugin.getFunctionCount() > 0);
    });

    test('getFunctionCount without schema', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        assert.strictEqual(plugin.getFunctionCount(), 0);
    });

    test('getTypeCount', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        assert.ok(plugin.getTypeCount() > 0);
    });

    test('getTypeCount without schema', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        assert.strictEqual(plugin.getTypeCount(), 0);
    });

    test('createSerializer', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const serializer = plugin.createSerializer();
        assert.ok(serializer !== null);
    });

    test('createDeserializer', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);
        plugin.loadSchema(TEST_SCHEMA);

        const deserializer = plugin.createDeserializer(Buffer.alloc(4));
        assert.ok(deserializer !== null);
    });

    test('lookupConstructor without schema returns null', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        assert.strictEqual(plugin.lookupConstructor(0xd23c81a3), null);
    });

    test('lookupFunction without schema returns null', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        assert.strictEqual(plugin.lookupFunction(0xb0f732d5), null);
    });

    test('lookupType without schema returns null', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        assert.strictEqual(plugin.lookupType('User'), null);
    });

    test('findConstructor without schema returns null', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        assert.strictEqual(plugin.findConstructor('user'), null);
    });

    test('findFunction without schema returns null', () => {
        const plugin = new TLLanguagePlugin();
        const ctx = createTestContext();
        plugin.initialize(ctx);

        assert.strictEqual(plugin.findFunction('getUser'), null);
    });
});
