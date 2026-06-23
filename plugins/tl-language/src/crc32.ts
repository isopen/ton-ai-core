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

export function crc32(data: string | Buffer): number {
    let crc = 0xFFFFFFFF;
    const input = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    for (let i = 0; i < input.length; i++) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ input[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function crc32Hex(data: string | Buffer): string {
    return '0x' + crc32(data).toString(16).padStart(8, '0');
}
