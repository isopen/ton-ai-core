import { Buffer } from 'buffer';
import { TLCombinator, TLField } from './types';
import { SchemaRegistry } from './registry';
import { crc32 } from './crc32';
import { normalizeForCRC32 } from './schema-normalizer';

const MAX_BUFFER_SIZE = 64 * 1024 * 1024;

export class SchemaSerializer {
    private buffer: Buffer;
    private offset: number;
    private registry: SchemaRegistry | null;

    constructor(registry: SchemaRegistry | null = null, initialSize: number = 256) {
        this.buffer = Buffer.alloc(initialSize);
        this.offset = 0;
        this.registry = registry;
    }

    private ensureSpace(bytes: number): void {
        while (this.offset + bytes > this.buffer.length) {
            if (this.buffer.length * 2 > MAX_BUFFER_SIZE) {
                throw new Error('Buffer exceeds maximum size');
            }
            const newBuffer = Buffer.alloc(this.buffer.length * 2);
            this.buffer.copy(newBuffer);
            this.buffer = newBuffer;
        }
    }

    writeConstructorId(id: number): void {
        this.ensureSpace(4);
        this.buffer.writeUInt32LE(id >>> 0, this.offset);
        this.offset += 4;
    }

    writeConstructorByName(name: string): void {
        const normalized = name.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
        const id = crc32(normalized);
        this.writeConstructorId(id);
    }

    writeInt32(value: number): void {
        this.ensureSpace(4);
        this.buffer.writeInt32LE(value, this.offset);
        this.offset += 4;
    }

    writeUint32(value: number): void {
        this.ensureSpace(4);
        this.buffer.writeUInt32LE(value >>> 0, this.offset);
        this.offset += 4;
    }

    writeInt64(value: bigint): void {
        this.ensureSpace(8);
        this.buffer.writeBigInt64LE(value, this.offset);
        this.offset += 8;
    }

    writeInt128(value: bigint): void {
        this.ensureSpace(16);
        this.buffer.writeBigUInt64LE(value & 0xFFFFFFFFFFFFFFFFn, this.offset);
        this.buffer.writeBigUInt64LE((value >> 64n) & 0xFFFFFFFFFFFFFFFFn, this.offset + 8);
        this.offset += 16;
    }

    writeInt256(value: Buffer): void {
        if (value.length !== 32) throw new Error('int256 requires exactly 32 bytes');
        this.ensureSpace(32);
        value.copy(this.buffer, this.offset);
        this.offset += 32;
    }

    writeBoolTrue(): void {
        this.writeUint32(0x997275b5);
    }

    writeBoolFalse(): void {
        this.writeUint32(0xbc799737);
    }

    writeBool(value: boolean): void {
        if (value) this.writeBoolTrue();
        else this.writeBoolFalse();
    }

    writeString(value: string): void {
        const data = Buffer.from(value, 'utf-8');
        this.writeBytes(data);
    }

    writeBytes(data: Buffer): void {
        const len = data.length;
        if (len > 0xFFFFFF) throw new Error(`Length ${len} exceeds TL bytes maximum`);
        if (len < 254) {
            const padding = (4 - ((1 + len) % 4)) % 4;
            this.ensureSpace(1 + len + padding);
            this.buffer.writeUInt8(len, this.offset);
            this.offset += 1;
            data.copy(this.buffer, this.offset);
            this.offset += len;
            if (padding > 0) {
                this.buffer.fill(0, this.offset, this.offset + padding);
                this.offset += padding;
            }
        } else {
            const padding = (4 - ((4 + len) % 4)) % 4;
            this.ensureSpace(4 + len + padding);
            this.buffer.writeUInt8(254, this.offset);
            this.buffer.writeUInt8(len & 0xFF, this.offset + 1);
            this.buffer.writeUInt8((len >> 8) & 0xFF, this.offset + 2);
            this.buffer.writeUInt8((len >> 16) & 0xFF, this.offset + 3);
            this.offset += 4;
            data.copy(this.buffer, this.offset);
            this.offset += len;
            if (padding > 0) {
                this.buffer.fill(0, this.offset, this.offset + padding);
                this.offset += padding;
            }
        }
    }

    writeVectorInt32(values: number[]): void {
        this.writeUint32(0x1cb5c415);
        this.writeInt32(values.length);
        for (const v of values) {
            this.writeInt32(v);
        }
    }

    writeVectorInt64(values: bigint[]): void {
        this.writeUint32(0x1cb5c415);
        this.writeInt32(values.length);
        for (const v of values) {
            this.writeInt64(v);
        }
    }

    writeVectorString(values: string[]): void {
        this.writeUint32(0x1cb5c415);
        this.writeInt32(values.length);
        for (const v of values) {
            this.writeString(v);
        }
    }

    writeVectorBytes(values: Buffer[]): void {
        this.writeUint32(0x1cb5c415);
        this.writeInt32(values.length);
        for (const v of values) {
            this.writeBytes(v);
        }
    }

    writeGenericVector(elementWriteFn: (item: any) => void, values: any[]): void {
        this.writeUint32(0x1cb5c415);
        this.writeInt32(values.length);
        for (const v of values) {
            elementWriteFn(v);
        }
    }

    serializeCombinator(combinator: TLCombinator, params: Record<string, any>): Buffer {
        this.writeConstructorId(combinator.id);

        for (const field of combinator.fields) {
            const value = params[field.name];

            if (field.conditionalFlagsField !== undefined) {
                const flags = params[field.conditionalFlagsField] ?? 0;
                const bit = field.conditionalBit ?? 0;
                if (!(flags & (1 << bit))) continue;
            }

            this.writeFieldValue(field.type, value);
        }

        return this.toBuffer();
    }

    private writeFieldValue(type: string, value: any): void {
        let rawType = type;
        let bang = false;
        if (rawType.startsWith('!')) {
            bang = true;
            rawType = rawType.substring(1).trim();
        }

        if (rawType.startsWith('repetition:')) {
            const repStr = rawType.substring('repetition:'.length);
            const starIdx = repStr.indexOf('*');
            const multiplicity = starIdx !== -1 ? repStr.substring(0, starIdx) : '0';
            const innerType = starIdx !== -1 ? repStr.substring(starIdx + 1) : repStr;
            if (Array.isArray(value)) {
                for (const item of value) {
                    this.writeFieldValue(innerType, item);
                }
            }
            return;
        }

        const bareType = rawType.replace(/^%/, '').replace(/^\(/, '').replace(/\)$/, '').trim();

        if (bareType === 'int' || bareType === 'Int') {
            this.writeInt32(value);
        } else if (bareType === 'long' || bareType === 'Long') {
            this.writeInt64(value);
        } else if (bareType === 'double' || bareType === 'Double') {
            this.ensureSpace(8);
            this.buffer.writeDoubleLE(value, this.offset);
            this.offset += 8;
        } else if (bareType === 'string' || bareType === 'String') {
            if (typeof value === 'string') {
                this.writeString(value);
            } else {
                this.writeBytes(value);
            }
        } else if (bareType === 'bool' || bareType === 'Bool') {
            this.writeBool(value);
        } else if (bareType.startsWith('vector') || bareType.startsWith('Vector')) {
            this.writeUint32(0x1cb5c415);
            if (Array.isArray(value)) {
                this.writeInt32(value.length);
                for (const item of value) {
                    if (typeof item === 'number') this.writeInt32(item);
                    else if (typeof item === 'bigint') this.writeInt64(item);
                    else if (Buffer.isBuffer(item)) this.writeBytes(item);
                }
            }
        } else if (bareType === 'int128') {
            this.writeInt128(value);
        } else if (bareType === 'int256') {
            this.writeInt256(value);
        } else if (bareType === 'bytes') {
            this.writeBytes(value);
        } else if (bareType === 'true') {
            this.writeBoolTrue();
        } else if (bareType === 'false') {
            this.writeBoolFalse();
        } else {
            if (typeof value === 'number') this.writeInt32(value);
            else if (typeof value === 'bigint') this.writeInt64(value);
            else if (Buffer.isBuffer(value)) this.writeBytes(value);
            else if (typeof value === 'string') this.writeString(value);
        }
    }

    toBuffer(): Buffer {
        return this.buffer.subarray(0, this.offset);
    }

    reset(): void {
        this.offset = 0;
    }

    get length(): number {
        return this.offset;
    }
}

export function computeConstructorIdFromSchema(declaration: string): number {
    const normalized = normalizeForCRC32(declaration);
    return crc32(normalized);
}

export function computeConstructorIdFromName(name: string): number {
    return crc32(name);
}
