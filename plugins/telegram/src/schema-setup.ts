import { SchemaRegistry, SchemaSerializer, SchemaDeserializer } from '@ton-ai/tl-language';
import { convertJsonSchemaToTL } from './json-schema-to-tl';
import type { TelegramSchema } from './json-schema-to-tl';
import schemaJson from './schema/telegram-schema.json';

let registry: SchemaRegistry | null = null;

export function getSchemaRegistry(): SchemaRegistry {
    if (registry) return registry;
    const tlText = convertJsonSchemaToTL(schemaJson as unknown as TelegramSchema);
    registry = SchemaRegistry.fromText(tlText);
    return registry;
}

export { SchemaSerializer, SchemaDeserializer };
