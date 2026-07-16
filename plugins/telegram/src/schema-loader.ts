import { readFileSync } from 'fs';
import { join } from 'path';
import { SchemaRegistry } from '@ton-ai/tl-language';
import { convertJsonSchemaToTL } from './json-schema-to-tl';

let registryInstance: SchemaRegistry | null = null;

function findSchemaPath(): string {
    const candidates = [
        join(__dirname, '..', 'schema', 'telegram-schema.json'),
        join(process.cwd(), 'agents', 'gram-browser', 'src', 'schema', 'telegram-schema.json'),
        join(process.cwd(), 'src', 'schema', 'telegram-schema.json'),
        join(process.cwd(), 'schema', 'telegram-schema.json'),
    ];
    for (const p of candidates) {
        try {
            readFileSync(p);
            return p;
        } catch {}
    }
    throw new Error('Cannot find telegram-schema.json at any known path');
}

export function getSchemaRegistry(): SchemaRegistry {
    if (registryInstance) return registryInstance;

    const schemaPath = findSchemaPath();
    const raw = readFileSync(schemaPath, 'utf-8');
    const json = JSON.parse(raw);
    const tlText = convertJsonSchemaToTL(json);
    registryInstance = SchemaRegistry.fromText(tlText);
    return registryInstance;
}
