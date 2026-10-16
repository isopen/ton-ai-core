import { getSchemaRegistry, SchemaSerializer, SchemaDeserializer } from '../src/schema-setup';

const registry = getSchemaRegistry();

function combinator(name: string) {
  const c = registry.findConstructorByName(name);
  if (!c) throw new Error('constructor not found: ' + name);
  return c;
}

function combinatorById(id: number) {
  const c = registry.findConstructorById(id);
  if (!c) throw new Error('constructor not found: ' + id);
  return c;
}

function bytes(name: string, params: Record<string, any>): Buffer {
  return new SchemaSerializer(registry).serializeCombinator(combinator(name), params);
}

function readBoxed(buf: Buffer): { name: string; fields: Record<string, any> } {
  const d = new SchemaDeserializer(buf, registry);
  const boxed: any = d.readBoxedObject();
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(boxed.fields ?? {})) {
    fields[k] = typeof v === 'bigint' ? v.toString() : v;
  }
  return { name: boxed.constructorName, fields };
}

describe('forum topic reply_to wire format', () => {
  test('messages.sendMessage carries reply_to behind flags bit 0', () => {
    const m = registry.findFunctionByName('messages.sendMessage');
    expect(m).not.toBeNull();
    const replyTo = (m as any).fields.find((f: any) => f.name === 'reply_to');
    expect(replyTo).toBeDefined();
    expect(replyTo.conditionalBit).toBe(0);
    expect(replyTo.conditionalFlagsField).toBe('flags');
  });

  test('inputReplyToMessage has top_msg_id behind flags bit 0', () => {
    const c = combinator('inputReplyToMessage');
    const names = c.fields.map((f: any) => f.name);
    expect(names).toContain('flags');
    expect(names).toContain('reply_to_msg_id');
    expect(names).toContain('top_msg_id');
    const top = c.fields.find((f: any) => f.name === 'top_msg_id');
    expect(top.conditionalBit).toBe(0);
  });

  test('a topic send sets top_msg_id and leaves reply_to_msg_id empty', () => {
    const topicId = 4211;
    const buf = bytes('inputReplyToMessage', {
      _: 'inputReplyToMessage',
      flags: 0b1,
      reply_to_msg_id: 0,
      top_msg_id: topicId,
    });
    const back = readBoxed(buf);
    expect(back.name).toBe('inputReplyToMessage');
    expect(back.fields.top_msg_id).toBe(topicId);
    expect(back.fields.reply_to_msg_id).toBe(0);
  });

  test('a plain reply does not carry top_msg_id', () => {
    const buf = bytes('inputReplyToMessage', { _: 'inputReplyToMessage', flags: 0, reply_to_msg_id: 777 });
    const back = readBoxed(buf);
    expect(back.fields.top_msg_id).toBeUndefined();
    expect(back.fields.reply_to_msg_id).toBe(777);
  });

  test('the serialized topic body starts with the known constructor id', () => {
    const c = combinator('inputReplyToMessage');
    const buf = bytes('inputReplyToMessage', {
      _: 'inputReplyToMessage', flags: 0b1, reply_to_msg_id: 0, top_msg_id: 5,
    });
    expect(buf.readUInt32LE(0)).toBe(Number(c.id));
    expect(buf.readInt32LE(4)).toBe(1);
    expect(buf.readInt32LE(8)).toBe(0);
    expect(buf.readInt32LE(12)).toBe(5);
  });
});
