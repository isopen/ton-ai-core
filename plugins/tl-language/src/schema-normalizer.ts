export function normalizeForCRC32(declaration: string): string {
    let s = declaration.trim();
    if (s.endsWith(';')) {
        s = s.slice(0, -1).trim();
    }
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
    s = s.replace(/\/\/.*$/gm, '');
    s = s.replace(/[(){}]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

export function computeConstructorId(declaration: string): number {
    const normalized = normalizeForCRC32(declaration);
    const { crc32 } = require('./crc32');
    return crc32(normalized);
}

export function normalizeTypeRef(typeRef: string): string {
    let s = typeRef.trim();
    if (s.startsWith('%')) {
        s = s.slice(1);
    }
    while (s.startsWith('(') && s.endsWith(')')) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

export function stripBang(typeRef: string): { type: string; bang: boolean } {
    const trimmed = typeRef.trim();
    if (trimmed.startsWith('!')) {
        return { type: trimmed.slice(1).trim(), bang: true };
    }
    return { type: trimmed, bang: false };
}
