import { getSchemaRegistry, SchemaSerializer, SchemaDeserializer } from '../src/schema-setup';
import { convertJsonSchemaToTL } from '../src/json-schema-to-tl';

function deepConvert(v: any): any {
    if (v && typeof v === 'object' && 'constructorId' in v && 'constructorName' in v && 'fields' in v) {
        const name = v.constructorName;
        const r: any = { _: name };
        for (const [k, val] of Object.entries(v.fields)) r[k] = deepConvert(val);
        return r;
    }
    if (Array.isArray(v)) return v.map(deepConvert);
    if (typeof v === 'bigint') return v.toString();
    return v;
}

test('messageMediaDice round-trips emoticon', () => {
    const registry = getSchemaRegistry();
    const obj = {
        _: 'messageMediaDice',
        value: 4,
        emoticon: '🏀',
        flags: 0,
    };
    const comb = registry.getConstructorsByName('messageMediaDice')[0];
    expect(comb).toBeTruthy();
    const body = new SchemaSerializer(registry).serializeCombinator(comb, obj as any);

    const d = new SchemaDeserializer(body, registry);
    const boxed = d.readBoxedObject();
    const plain = deepConvert(boxed);

    // eslint-disable-next-line no-console
    console.log('DECODED:', JSON.stringify(plain));
    expect(plain._).toBe('messageMediaDice');
    expect((plain as any).emoticon).toBe('🏀');
    expect((plain as any).value).toBe(4);
});

test('messageMediaDice nested inside a Message round-trips', () => {
    const registry = getSchemaRegistry();
    const msgComb = registry.getConstructorsByName('message')[0];
    expect(msgComb).toBeTruthy();
    const dice = {
        _: 'messageMediaDice',
        value: 3,
        emoticon: '🎯',
        flags: 0,
    };
    const mediaComb = registry.getConstructorsByName('messageMediaDice')[0];
    const mediaBody = new SchemaSerializer(registry).serializeCombinator(mediaComb, dice as any);

    // eslint-disable-next-line no-console
    console.log('MEDIA SERIALIZED bytes:', mediaBody.length);
});
