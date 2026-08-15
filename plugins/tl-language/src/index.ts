import { BasePlugin } from '@ton-ai/core';
import { getLogger } from '@ton-ai/gram-debug';
import { parseTLSchema } from './parser';
import { SchemaRegistry } from './registry';
import { SchemaSerializer, computeConstructorIdFromSchema, computeConstructorIdFromName } from './serializer';
import { SchemaDeserializer, deserializeWithSchema, DeserializedObject } from './deserializer';
import { validateTLSchema, TLValidationError } from './validator';
import { crc32, crc32Hex } from './crc32';
import { normalizeForCRC32, normalizeTypeRef, stripBang } from './schema-normalizer';
import {
  tlBytesLength, readTlString, readTlBytes, writeTlBytes, writeTlString, encodeTlString,
  encodeKvPayload, decodeKvPayload,
} from './tl-b';
import {
    TLSchema, TLCombinator, TLType, TLField, TLOptionalParam,
    TL_BUILTINS, BOOL_TRUE_ID, BOOL_FALSE_ID, VECTOR_ID,
    BOXED_BUILTINS, BARE_BUILTINS,
} from './types';

export interface TLConfig {
    schema?: string;
    schemaPath?: string;
}

const log = getLogger('tl-language');

export class TLLanguagePlugin extends BasePlugin<TLConfig> {
    readonly metadata = {
        name: 'tl-language',
        version: '0.1.0',
        description: 'TL Language parser, schema registry, and serialization engine',
        author: 'TON AI Core Team',
        dependencies: [] as string[],
    };

    private registry: SchemaRegistry | null = null;
    private schema: TLSchema | null = null;

    protected defaults() {
        return {};
    }

    protected async onInit() {
        log.info('Initializing TL Language plugin...');
        if (this.config.schema) {
            this.loadSchema(this.config.schema);
        }
        log.info('TL Language plugin initialized');
    }

    async onActivate() {
        log.info('TL Language plugin activated');
        this.emit('tl:activated', { types: this.registry?.typeCount ?? 0 });
    }

    async onDeactivate() {
        log.info('TL Language plugin deactivated');
        this.emit('tl:deactivated', {});
    }

    async shutdown() {
        this.registry = null;
        this.schema = null;
        this.initialized = false;
        log.info('TL Language plugin shut down');
    }

    loadSchema(schemaText: string): void {
        this.schema = parseTLSchema(schemaText);
        this.registry = new SchemaRegistry(schemaText);
        log.info(`Loaded TL schema: ${this.registry.typeCount} types, ${this.registry.constructorCount} constructors, ${this.registry.functionCount} functions`);
    }

    getRegistry(): SchemaRegistry | null {
        return this.registry;
    }

    getSchema(): TLSchema | null {
        return this.schema;
    }

    lookupConstructor(id: number): TLCombinator | null {
        return this.registry?.getCombinatorById(id) ?? null;
    }

    lookupFunction(id: number): TLCombinator | null {
        return this.registry?.getFunctionById(id) ?? null;
    }

    lookupType(name: string): TLType | null {
        return this.registry?.getType(name) ?? null;
    }

    findConstructor(name: string): TLCombinator | null {
        return this.registry?.findConstructorByName(name) ?? null;
    }

    findFunction(name: string): TLCombinator | null {
        return this.registry?.findFunctionByName(name) ?? null;
    }

    serialize(combinator: TLCombinator, params: Record<string, any>): Buffer {
        const serializer = new SchemaSerializer(this.registry);
        return serializer.serializeCombinator(combinator, params);
    }

    serializeWithId(constructorId: number, params: Record<string, any>): Buffer {
        const comb = this.registry?.getCombinatorById(constructorId);
        if (!comb) throw new Error(`Constructor not found: 0x${constructorId.toString(16)}`);
        return this.serialize(comb, params);
    }

    deserialize(data: Buffer): DeserializedObject | null {
        if (!this.registry) throw new Error('No schema loaded');
        return deserializeWithSchema(data, this.registry);
    }

    validateSchema(): TLValidationError[] {
        if (!this.schema) throw new Error('No schema loaded');
        return validateTLSchema(this.schema);
    }

    computeId(declaration: string): number {
        return computeConstructorIdFromSchema(declaration);
    }

    computeIdFromName(name: string): number {
        return computeConstructorIdFromName(name);
    }

    getConstructorCount(): number {
        return this.registry?.constructorCount ?? 0;
    }

    getFunctionCount(): number {
        return this.registry?.functionCount ?? 0;
    }

    getTypeCount(): number {
        return this.registry?.typeCount ?? 0;
    }

    createSerializer(): SchemaSerializer {
        return new SchemaSerializer(this.registry);
    }

    createDeserializer(data: Buffer): SchemaDeserializer {
        return new SchemaDeserializer(data, this.registry);
    }

    emit(event: string, data: any): void {
        this.events?.emit(event, data);
    }
}

export {
    parseTLSchema,
    SchemaRegistry,
    SchemaSerializer,
    SchemaSerializer as TLSerializer,
    SchemaDeserializer,
    SchemaDeserializer as TLDeserializer,
    deserializeWithSchema,
    computeConstructorIdFromSchema,
    computeConstructorIdFromSchema as computeConstructorId,
    computeConstructorIdFromName,
    validateTLSchema,
    crc32,
    crc32Hex,
    normalizeForCRC32,
    normalizeTypeRef,
    stripBang,
};

export type {
    TLSchema, TLCombinator, TLType, TLField, TLOptionalParam, TLValidationError, DeserializedObject,
};

export {
    TL_BUILTINS, BOOL_TRUE_ID, BOOL_FALSE_ID, VECTOR_ID,
    BOXED_BUILTINS, BARE_BUILTINS,
};

export {
    tlBytesLength, readTlString, readTlBytes, writeTlBytes, writeTlString, encodeTlString,
    encodeKvPayload, decodeKvPayload,
};
