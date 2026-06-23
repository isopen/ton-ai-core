import { Buffer } from 'buffer';
import { TLCombinator, TLField } from './types';
import { SchemaRegistry } from './registry';

const VECTOR_ID = 0x1cb5c415;
const BOOL_TRUE_ID = 0x997275b5;
const BOOL_FALSE_ID = 0xbc799737;

export interface DeserializedObject {
    constructorId: number;
    constructorName: string;
    typeName: string;
    fields: Record<string, any>;
}

export class SchemaDeserializer {
    private buffer: Buffer;
    private offset: number;
    private registry: SchemaRegistry | null;

    constructor(data: Buffer, registry: SchemaRegistry | null = null) {
        this.buffer = data;
        this.offset = 0;
        this.registry = registry;
    }

    private checkBounds(needed: number): void {
        if (this.offset + needed > this.buffer.length) {
            throw new Error(`Buffer underflow: need ${needed} bytes at offset ${this.offset}`);
        }
    }

    readInt32(): number {
        this.checkBounds(4);
        const value = this.buffer.readInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    readUint32(): number {
        this.checkBounds(4);
        const value = this.buffer.readUInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    readInt64(): bigint {
        this.checkBounds(8);
        const value = this.buffer.readBigInt64LE(this.offset);
        this.offset += 8;
        return value;
    }

    readUint64(): bigint {
        this.checkBounds(8);
        const value = this.buffer.readBigUInt64LE(this.offset);
        this.offset += 8;
        return value;
    }

    readInt128(): bigint {
        this.checkBounds(16);
        const low = this.buffer.readBigUInt64LE(this.offset);
        const high = this.buffer.readBigUInt64LE(this.offset + 8);
        this.offset += 16;
        return (high << 64n) | low;
    }

    readInt256(): Buffer {
        this.checkBounds(32);
        const value = Buffer.from(this.buffer.subarray(this.offset, this.offset + 32));
        this.offset += 32;
        return value;
    }

    readBool(): boolean {
        const id = this.readUint32();
        if (id === BOOL_TRUE_ID) return true;
        if (id === BOOL_FALSE_ID) return false;
        throw new Error(`Invalid bool constructor: 0x${id.toString(16)}`);
    }

    readBytes(): Buffer {
        this.checkBounds(1);
        const firstByte = this.buffer.readUInt8(this.offset);
        this.offset += 1;

        let len: number;
        let prefixLen: number;
        if (firstByte < 254) {
            len = firstByte;
            prefixLen = 1;
        } else {
            this.checkBounds(3);
            len = this.buffer.readUInt8(this.offset) |
                  (this.buffer.readUInt8(this.offset + 1) << 8) |
                  (this.buffer.readUInt8(this.offset + 2) << 16);
            this.offset += 3;
            prefixLen = 4;
        }

        this.checkBounds(len);
        const data = this.buffer.subarray(this.offset, this.offset + len);
        this.offset += len;
        const padding = (4 - ((prefixLen + len) % 4)) % 4;
        if (padding > 0) this.checkBounds(padding);
        this.offset += padding;
        return Buffer.from(data);
    }

    readString(): string {
        return this.readBytes().toString('utf-8');
    }

    readVectorInt32(): number[] {
        const constructorId = this.readUint32();
        if (constructorId !== VECTOR_ID) throw new Error(`Invalid vector constructor: 0x${constructorId.toString(16)}`);
        const count = this.readInt32();
        if (count < 0 || count * 4 > this.remaining) throw new Error(`Invalid vector count: ${count}`);
        const result: number[] = [];
        for (let i = 0; i < count; i++) result.push(this.readInt32());
        return result;
    }

    readInt32Raw(): number {
        this.checkBounds(4);
        const value = this.buffer.readInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    readInt64Raw(): bigint {
        this.checkBounds(8);
        const value = this.buffer.readBigInt64LE(this.offset);
        this.offset += 8;
        return value;
    }

    readUint32Raw(): number {
        this.checkBounds(4);
        const value = this.buffer.readUInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    readDouble(): number {
        this.checkBounds(8);
        const value = this.buffer.readDoubleLE(this.offset);
        this.offset += 8;
        return value;
    }

    readRawBytes(len: number): Buffer {
        this.checkBounds(len);
        const data = this.buffer.subarray(this.offset, this.offset + len);
        this.offset += len;
        return Buffer.from(data);
    }

    readVectorInt64(): bigint[] {
        const constructorId = this.readUint32();
        if (constructorId !== VECTOR_ID) throw new Error(`Invalid vector constructor: 0x${constructorId.toString(16)}`);
        const count = this.readInt32();
        if (count < 0 || count * 8 > this.remaining) throw new Error(`Invalid vector count: ${count}`);
        const result: bigint[] = [];
        for (let i = 0; i < count; i++) result.push(this.readInt64());
        return result;
    }

    readVectorLong(): bigint[] {
        return this.readVectorInt64();
    }

    readVectorString(): string[] {
        const constructorId = this.readUint32();
        if (constructorId !== VECTOR_ID) throw new Error(`Invalid vector constructor: 0x${constructorId.toString(16)}`);
        const count = this.readInt32();
        if (count < 0 || count > this.remaining / 2) throw new Error(`Invalid vector count: ${count}`);
        const result: string[] = [];
        for (let i = 0; i < count; i++) result.push(this.readString());
        return result;
    }

    readVectorBytes(): Buffer[] {
        const constructorId = this.readUint32();
        if (constructorId !== VECTOR_ID) throw new Error(`Invalid vector constructor: 0x${constructorId.toString(16)}`);
        const count = this.readInt32();
        if (count < 0 || count > this.remaining / 2) throw new Error(`Invalid vector count: ${count}`);
        const result: Buffer[] = [];
        for (let i = 0; i < count; i++) result.push(this.readBytes());
        return result;
    }

    readGenericVector(elementReadFn: () => any): any[] {
        const constructorId = this.readUint32();
        if (constructorId !== VECTOR_ID) throw new Error(`Invalid vector constructor: 0x${constructorId.toString(16)}`);
        const count = this.readInt32();
        if (count < 0) throw new Error(`Invalid vector count: ${count}`);
        const result: any[] = [];
        for (let i = 0; i < count; i++) result.push(elementReadFn());
        return result;
    }

    readFieldValue(type: string, flags?: number, conditionalBit?: number, conditionalFlagsField?: string): any {
        if (conditionalFlagsField !== undefined && flags !== undefined) {
            const bit = conditionalBit ?? 0;
            if (!(flags & (1 << bit))) return undefined;
        }

        let rawType = type;
        let bang = false;
        if (rawType.startsWith('!')) {
            bang = true;
            rawType = rawType.substring(1).trim();
        }

        if (rawType.startsWith('repetition:')) {
            const repStr = rawType.substring('repetition:'.length);
            const starIdx = repStr.indexOf('*');
            const innerType = starIdx !== -1 ? repStr.substring(starIdx + 1) : repStr;
            return this.readFieldValue(innerType, flags, conditionalBit, conditionalFlagsField);
        }

        const bareType = rawType.replace(/^%/, '').replace(/^\(/, '').replace(/\)$/, '').trim();

        if (bareType === 'int') return this.readInt32();
        if (bareType === 'long') return this.readInt64();
        if (bareType === 'double') {
            this.checkBounds(8);
            const v = this.buffer.readDoubleLE(this.offset);
            this.offset += 8;
            return v;
        }
        if (bareType === 'string') return this.readString();
        if (bareType === 'bool') return this.readBool();
        if (bareType === 'true') return true;
        if (bareType === 'false') return false;
        if (bareType === 'int128') return this.readInt128();
        if (bareType === 'int256') return this.readInt256();
        if (bareType === 'bytes') return this.readBytes();
        if (bareType === 'Object') return this.readBoxedObject();
        if (bareType === 'null') return null;

        if (/^(vector|Vector)/i.test(bareType)) {
            return this.readGenericVector(() => this.readBoxedObject());
        }

        return this.readBoxedObject();
    }

    readBoxedObject(): DeserializedObject | null {
        if (this.remaining < 4) return null;

        const constructorId = this.readUint32();
        if (constructorId === VECTOR_ID) {
            const count = this.readInt32();
            const items: any[] = [];
            for (let i = 0; i < count; i++) {
                items.push(this.readBoxedObject());
            }
            return {
                constructorId: VECTOR_ID,
                constructorName: 'vector',
                typeName: 'Vector',
                fields: { items, count },
            };
        }

        const comb = this.registry?.getCombinatorById(constructorId);
        if (!comb) {
            return { constructorId, constructorName: `unknown_0x${constructorId.toString(16)}`, typeName: 'Unknown', fields: {} };
        }

        const fields: Record<string, any> = {};
        let flags = 0;

        for (const field of comb.fields) {
            if (field.name === 'flags' && field.type === '#') {
                flags = this.readUint32();
                fields['flags'] = flags;
                continue;
            }

            if (field.conditionalFlagsField !== undefined && field.conditionalBit !== undefined) {
                const bit = field.conditionalBit;
                if (!(flags & (1 << bit))) continue;
            }

            fields[field.name] = this.readFieldValue(field.type, flags, field.conditionalBit, field.conditionalFlagsField);
        }

        return {
            constructorId,
            constructorName: comb.name,
            typeName: comb.resultType,
            fields,
        };
    }

    readUnencryptedMessage(): { authKeyId: bigint; messageId: bigint; dataLength: number; body: Buffer } {
        const authKeyId = this.readInt64() as unknown as bigint;
        this.offset -= 8;
        const authKeyBig = this.buffer.readBigUInt64LE(this.offset);
        this.offset += 8;
        const messageId = this.readInt64();
        const dataLength = this.readInt32();
        const body = Buffer.from(this.buffer.subarray(this.offset, this.offset + dataLength));
        this.offset += dataLength;
        return { authKeyId: authKeyBig, messageId, dataLength, body };
    }

    get remaining(): number {
        return this.buffer.length - this.offset;
    }

    get position(): number {
        return this.offset;
    }

    get totalLength(): number {
        return this.buffer.length;
    }
}

export function deserializeWithSchema(data: Buffer, registry: SchemaRegistry): DeserializedObject | null {
    const deserializer = new SchemaDeserializer(data, registry);
    return deserializer.readBoxedObject();
}
