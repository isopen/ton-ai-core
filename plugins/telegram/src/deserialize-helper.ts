import { Buffer } from 'buffer';
import { SchemaDeserializer, type DeserializedObject } from '@ton-ai/tl-language';

function isDeserializedObject(v: unknown): v is DeserializedObject {
    return !!v && typeof v === 'object' && 'constructorId' in v && 'constructorName' in v && 'fields' in v;
}

function convertValue(v: unknown): unknown {
    if (isDeserializedObject(v)) return deserializedToPlain(v);
    if (Array.isArray(v)) return v.map(convertValue);
    if (Buffer.isBuffer(v)) return v.toString('hex');
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number' && !Number.isInteger(v)) return v;
    return v;
}

export function deserializedToPlain(obj: DeserializedObject | null): Record<string, unknown> {
    if (!obj) return { _error: 'null' };

    const result: Record<string, unknown> = { _: obj.constructorName };
    for (const [key, value] of Object.entries(obj.fields)) {
        result[key] = convertValue(value);
    }
    return result;
}

export function schemaDecode(data: Buffer, registry: import('@ton-ai/tl-language').SchemaRegistry): Record<string, unknown> {
    const d = new SchemaDeserializer(data, registry);
    const obj = d.readBoxedObject();
    return deserializedToPlain(obj);
}
