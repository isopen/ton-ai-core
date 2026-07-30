import { strict as assert } from 'assert';
import { convertJsonSchemaToTL } from '../src/json-schema-to-tl';
import type { TelegramSchema } from '../src/json-schema-to-tl';

test('convertJsonSchemaToTL produces correct types section', () => {
  const schema: TelegramSchema = {
    constructors: [
      { id: '0', predicate: 'messageEmpty', params: [{ name: 'id', type: 'int' }], type: 'Message' },
    ],
    methods: [],
  };
  const result = convertJsonSchemaToTL(schema);
  assert.ok(result.includes('---types---'));
  assert.ok(result.includes('messageEmpty#00000000 id:int = Message;'));
  assert.ok(result.includes('---functions---'));
  assert.ok(!result.includes('messages.'));
});

test('convertJsonSchemaToTL produces correct functions section', () => {
  const schema: TelegramSchema = {
    constructors: [],
    methods: [
      { id: '0', method: 'messages.getMessages', params: [{ name: 'id', type: 'Vector<int>' }], type: 'messages.Messages' },
    ],
  };
  const result = convertJsonSchemaToTL(schema);
  assert.ok(result.includes('---functions---'));
  assert.ok(result.includes('messages.getMessages#00000000 id:Vector<int> = messages.Messages;'));
});

test('convertJsonSchemaToTL handles constructor without params', () => {
  const schema: TelegramSchema = {
    constructors: [
      { id: '0', predicate: 'testEmpty', params: [], type: 'Test' },
    ],
    methods: [],
  };
  const result = convertJsonSchemaToTL(schema);
  assert.ok(result.includes('testEmpty#00000000 = Test;'));
});

test('convertJsonSchemaToTL handles method without params', () => {
  const schema: TelegramSchema = {
    constructors: [],
    methods: [
      { id: '0', method: 'help.getConfig', params: [], type: 'Config' },
    ],
  };
  const result = convertJsonSchemaToTL(schema);
  assert.ok(result.includes('help.getConfig#00000000 = Config;'));
});

test('convertJsonSchemaToTL uses repr when available', () => {
  const schema: TelegramSchema = {
    constructors: [
      { id: '12345', predicate: 'testRepr', params: [{ name: 'data', type: 'bytes', repr: 'bytes' }], type: 'Test' },
    ],
    methods: [],
  };
  const result = convertJsonSchemaToTL(schema);
  assert.ok(result.includes('testRepr#00003039 data:bytes = Test;'));
});

test('convertJsonSchemaToTL negative decimal id converts to hex', () => {
  const schema: TelegramSchema = {
    constructors: [
      { id: '-2037395499', predicate: 'negativeId', params: [], type: 'Test' },
    ],
    methods: [],
  };
  const result = convertJsonSchemaToTL(schema);
  assert.ok(result.includes('negativeId#868fcfd5 = Test;'));
});
