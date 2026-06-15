import { Buffer } from 'buffer';

const CRC32_TABLE: Uint32Array = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
        }
        table[i] = crc >>> 0;
    }
    return table;
})();

function crc32(data: Buffer): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

export class TLSerializer {
    private buffer: Buffer;
    private offset: number;

    constructor(initialSize: number = 256) {
        this.buffer = Buffer.alloc(initialSize);
        this.offset = 0;
    }

    private ensureSpace(bytes: number): void {
        while (this.offset + bytes > this.buffer.length) {
            const newBuffer = Buffer.alloc(this.buffer.length * 2);
            this.buffer.copy(newBuffer);
            this.buffer = newBuffer;
        }
    }

    writeInt32(value: number): void {
        this.ensureSpace(4);
        this.buffer.writeInt32LE(value, this.offset);
        this.offset += 4;
    }

    writeInt64(value: bigint): void {
        this.ensureSpace(8);
        this.buffer.writeBigInt64LE(value, this.offset);
        this.offset += 8;
    }

    writeUint32(value: number): void {
        this.ensureSpace(4);
        this.buffer.writeUInt32LE(value >>> 0, this.offset);
        this.offset += 4;
    }

    writeBoolTrue(): void {
        this.writeInt32(0x997275b5);
    }

    writeBoolFalse(): void {
        this.writeInt32(0xbc799737);
    }

    writeBytes(data: Buffer): void {
        const len = data.length;
        if (len < 254) {
            this.ensureSpace(1 + len + (4 - (len % 4)) % 4);
            this.buffer.writeUInt8(len, this.offset);
            this.offset += 1;
        } else {
            this.ensureSpace(4 + len + (4 - (len % 4)) % 4);
            this.buffer.writeUInt8(254, this.offset);
            this.buffer.writeUInt8(len & 0xFF, this.offset + 1);
            this.buffer.writeUInt8((len >> 8) & 0xFF, this.offset + 2);
            this.buffer.writeUInt8((len >> 16) & 0xFF, this.offset + 3);
            this.offset += 4;
        }
        data.copy(this.buffer, this.offset);
        this.offset += len;
        const padding = (4 - (len % 4)) % 4;
        if (padding > 0) {
            this.buffer.fill(0, this.offset, this.offset + padding);
            this.offset += padding;
        }
    }

    writeString(value: string): void {
        const data = Buffer.from(value, 'utf-8');
        this.writeBytes(data);
    }

    writeBytesRaw(data: Buffer): void {
        this.ensureSpace(data.length);
        data.copy(this.buffer, this.offset);
        this.offset += data.length;
    }

    writeInt32Raw(value: number): void {
        this.ensureSpace(4);
        this.buffer.writeInt32LE(value, this.offset);
        this.offset += 4;
    }

    writeInt64Raw(value: bigint): void {
        this.ensureSpace(8);
        this.buffer.writeBigInt64LE(value, this.offset);
        this.offset += 8;
    }

    writeUint32Raw(value: number): void {
        this.ensureSpace(4);
        this.buffer.writeUInt32LE(value >>> 0, this.offset);
        this.offset += 4;
    }

    toBuffer(): Buffer {
        return this.buffer.subarray(0, this.offset);
    }

    get length(): number {
        return this.offset;
    }
}

export class TLDeserializer {
    private buffer: Buffer;
    private offset: number;

    constructor(data: Buffer) {
        this.buffer = data;
        this.offset = 0;
    }

    readInt32(): number {
        const value = this.buffer.readInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    readInt64(): bigint {
        const value = this.buffer.readBigInt64LE(this.offset);
        this.offset += 8;
        return value;
    }

    readUint32(): number {
        const value = this.buffer.readUInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    readBool(): boolean {
        const value = this.readInt32();
        if (value === 0x997275b5) return true;
        if (value === 0xbc799737) return false;
        throw new Error(`Invalid bool value: 0x${value.toString(16)}`);
    }

    readBytes(): Buffer {
        const firstByte = this.buffer.readUInt8(this.offset);
        this.offset += 1;

        let len: number;
        if (firstByte < 254) {
            len = firstByte;
        } else {
            len = this.buffer.readUInt8(this.offset) |
                  (this.buffer.readUInt8(this.offset + 1) << 8) |
                  (this.buffer.readUInt8(this.offset + 2) << 16);
            this.offset += 3;
        }

        const data = this.buffer.subarray(this.offset, this.offset + len);
        this.offset += len;
        const padding = (4 - (len % 4)) % 4;
        this.offset += padding;
        return Buffer.from(data);
    }

    readString(): string {
        return this.readBytes().toString('utf-8');
    }

    readInt32Raw(): number {
        const value = this.buffer.readInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    readInt64Raw(): bigint {
        const value = this.buffer.readBigInt64LE(this.offset);
        this.offset += 8;
        return value;
    }

    readUint32Raw(): number {
        const value = this.buffer.readUInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    readDouble(): number {
        const value = this.buffer.readDoubleLE(this.offset);
        this.offset += 8;
        return value;
    }

    readRawBytes(len: number): Buffer {
        const data = this.buffer.subarray(this.offset, this.offset + len);
        this.offset += len;
        return Buffer.from(data);
    }

    readVectorInt32(): number[] {
        const constructor = this.readInt32();
        if (constructor !== 0x7092e7ba) throw new Error(`Invalid vector<int> constructor: 0x${constructor.toString(16)}`);
        const count = this.readInt32();
        const result: number[] = [];
        for (let i = 0; i < count; i++) {
            result.push(this.readInt32());
        }
        return result;
    }

    readVectorLong(): bigint[] {
        const constructor = this.readInt32();
        if (constructor !== 0x1cb5c415) throw new Error(`Invalid vector<long> constructor: 0x${constructor.toString(16)}`);
        const count = this.readInt32();
        const result: bigint[] = [];
        for (let i = 0; i < count; i++) {
            result.push(this.readInt64());
        }
        return result;
    }

    readVectorBytes(): Buffer[] {
        const constructor = this.readInt32();
        if (constructor !== 0x1cb5c415) throw new Error(`Invalid vector constructor: 0x${constructor.toString(16)}`);
        const count = this.readInt32();
        const result: Buffer[] = [];
        for (let i = 0; i < count; i++) {
            result.push(this.readBytes());
        }
        return result;
    }

    get remaining(): number {
        return this.buffer.length - this.offset;
    }

    get position(): number {
        return this.offset;
    }
}

export function serializeObject(obj: { constructor: number; params: any[] }): Buffer {
    const serializer = new TLSerializer();
    serializer.writeInt32(obj.constructor);
    for (const param of obj.params) {
        if (typeof param === 'number') {
            serializer.writeInt32(param);
        } else if (typeof param === 'bigint') {
            serializer.writeInt64(param);
        } else if (Buffer.isBuffer(param)) {
            serializer.writeBytes(param);
        } else if (typeof param === 'string') {
            serializer.writeString(param);
        } else if (typeof param === 'boolean') {
            serializer.writeBoolTrue();
        } else if (Array.isArray(param)) {
            for (const item of param) {
                if (typeof item === 'number') {
                    serializer.writeInt32(item);
                } else if (typeof item === 'bigint') {
                    serializer.writeInt64(item);
                } else if (Buffer.isBuffer(item)) {
                    serializer.writeBytes(item);
                }
            }
        }
    }
    return serializer.toBuffer();
}

export function computeConstructor(data: Buffer): number {
    if (data.length < 4) throw new Error('Data too short');
    return data.readUInt32LE(0);
}

export function computeChecksum(data: Buffer): number {
    return crc32(data);
}
