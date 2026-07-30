import { strict as assert } from 'assert';
import { deserializedToPlain } from '../src/deserialize-helper';
import type { DeserializedObject } from '@ton-ai/tl-language';

test('deserializedToPlain returns error for null', () => {
  const result = deserializedToPlain(null);
  assert.deepStrictEqual(result, { _error: 'null' });
});

test('deserializedToPlain converts basic object', () => {
  const obj: DeserializedObject = {
    constructorId: 123,
    constructorName: 'testObj',
    typeName: 'Test',
    fields: { id: 42, name: 'hello' },
  };
  const result = deserializedToPlain(obj);
  assert.strictEqual(result._, 'testObj');
  assert.strictEqual(result.id, 42);
  assert.strictEqual(result.name, 'hello');
});

test('deserializedToPlain converts Buffer fields to hex', () => {
  const obj: DeserializedObject = {
    constructorId: 456,
    constructorName: 'withBuffer',
    typeName: 'Test',
    fields: { data: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]) },
  };
  const result = deserializedToPlain(obj);
  assert.strictEqual(result.data, 'deadbeef');
});

test('deserializedToPlain converts BigInt fields to string', () => {
  const obj: DeserializedObject = {
    constructorId: 789,
    constructorName: 'withBigInt',
    typeName: 'Test',
    fields: { value: 999999999999999n },
  };
  const result = deserializedToPlain(obj);
  assert.strictEqual(result.value, '999999999999999');
});

test('deserializedToPlain converts nested DeserializedObject', () => {
  const nested: DeserializedObject = {
    constructorId: 1,
    constructorName: 'inner',
    typeName: 'Inner',
    fields: { x: 10 },
  };
  const obj: DeserializedObject = {
    constructorId: 2,
    constructorName: 'outer',
    typeName: 'Outer',
    fields: { child: nested },
  };
  const result = deserializedToPlain(obj);
  assert.deepStrictEqual(result.child, { _: 'inner', x: 10 });
});

test('deserializedToPlain converts arrays recursively', () => {
  const obj: DeserializedObject = {
    constructorId: 3,
    constructorName: 'withArray',
    typeName: 'Test',
    fields: {
      items: [
        { constructorId: 4, constructorName: 'item', typeName: 'Item', fields: { val: 1 } },
        { constructorId: 5, constructorName: 'item', typeName: 'Item', fields: { val: 2 } },
      ],
    },
  };
  const result = deserializedToPlain(obj);
  assert.deepStrictEqual(result.items, [
    { _: 'item', val: 1 },
    { _: 'item', val: 2 },
  ]);
});

test('deserializedToPlain passes through numbers and booleans', () => {
  const obj: DeserializedObject = {
    constructorId: 6,
    constructorName: 'primitives',
    typeName: 'Test',
    fields: { a: true, b: false, c: 3.14, d: 100 },
  };
  const result = deserializedToPlain(obj);
  assert.strictEqual(result.a, true);
  assert.strictEqual(result.b, false);
  assert.strictEqual(result.c, 3.14);
  assert.strictEqual(result.d, 100);
});
