import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { SchemaRegistry } from '../src/registry';
import { SchemaSerializer } from '../src/serializer';
import { SchemaDeserializer } from '../src/deserializer';

const TEST_SCHEMA = `
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
null = Null;
sendBox#11223344 flags:# ordered:flags.15?true value:int = SendBox;
---functions---
`;

describe('flags true-type encoding', () => {
  test('set true flag emits zero bytes', () => {
    const registry = new SchemaRegistry(TEST_SCHEMA);
    const comb = registry.findConstructorByName('sendBox');
    assert.ok(comb);
    const buf = new SchemaSerializer(registry).serializeCombinator(comb!, { flags: 1 << 15, ordered: true, value: 7 });
    assert.strictEqual(buf.length, 12);
    assert.strictEqual(buf.readUInt32LE(4), 1 << 15);
    assert.strictEqual(buf.readInt32LE(8), 7);
  });

  test('absent true flag emits zero bytes', () => {
    const registry = new SchemaRegistry(TEST_SCHEMA);
    const comb = registry.findConstructorByName('sendBox');
    assert.ok(comb);
    const buf = new SchemaSerializer(registry).serializeCombinator(comb!, { flags: 0, value: 7 });
    assert.strictEqual(buf.length, 12);
    assert.strictEqual(buf.readUInt32LE(4), 0);
    assert.strictEqual(buf.readInt32LE(8), 7);
  });

  test('true flag roundtrips through deserializer', () => {
    const registry = new SchemaRegistry(TEST_SCHEMA);
    const comb = registry.findConstructorByName('sendBox');
    assert.ok(comb);
    const buf = new SchemaSerializer(registry).serializeCombinator(comb!, { flags: 1 << 15, ordered: true, value: 7 });
    const boxed: any = new SchemaDeserializer(Buffer.from(buf), registry).readBoxedObject();
    assert.strictEqual(boxed?.fields?.ordered, true);
    assert.strictEqual(boxed?.fields?.value, 7);
  });
});
