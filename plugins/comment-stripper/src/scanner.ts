import { LanguageConfig, StringSpec, BlockSpec } from './languages';

export interface ScanRange {
    start: number;
    end: number;
}

function findStringOpen(text: string, i: number, specs: StringSpec[]): { spec: StringSpec; len: number } | null {
    for (const spec of specs) {
        const ch = text[i];
        if (spec.kind === 'single' && ch === "'") return { spec, len: 1 };
        if (spec.kind === 'double' && ch === '"') return { spec, len: 1 };
        if (spec.kind === 'backtick' && ch === '`') return { spec, len: 1 };
        if (spec.kind === 'triple-single' && text.startsWith("'''", i)) return { spec, len: 3 };
        if (spec.kind === 'triple-double' && text.startsWith('"""', i)) return { spec, len: 3 };
        if (spec.kind === 'verbatim-double' && text.startsWith('@"', i)) return { spec, len: 2 };
        if (spec.kind === 'rust-raw' && ch === 'r') {
            let hashes = 0;
            let j = i + 1;
            while (text[j] === '#') { hashes++; j++; }
            if (hashes <= 8 && text[j] === '"') return { spec, len: 1 + hashes + 1 };
        }
    }
    return null;
}

function stringCloseLen(text: string, i: number, spec: StringSpec, openLen: number): number | null {
    switch (spec.kind) {
        case 'single':
        case 'double':
        case 'backtick': {
            const close = spec.kind === 'single' ? "'" : spec.kind === 'double' ? '"' : '`';
            if (text[i] === '\\') return -2;
            return text[i] === close ? 1 : null;
        }
        case 'triple-single':
            if (text[i] === '\\') return -2;
            return text.startsWith("'''", i) ? 3 : null;
        case 'triple-double':
            if (text[i] === '\\') return -2;
            return text.startsWith('"""', i) ? 3 : null;
        case 'verbatim-double':
            if (text[i] === '"' && text[i + 1] === '"') return -1;
            return text[i] === '"' ? 1 : null;
        case 'rust-raw': {
            const hashes = openLen - 2;
            const close = '"' + '#'.repeat(hashes);
            return text.startsWith(close, i) ? close.length : null;
        }
    }
}

function isLineStart(text: string, i: number): boolean {
    let j = i - 1;
    while (j >= 0 && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r')) j--;
    return j < 0 || text[j] === '\n';
}

export function scanComments(text: string, cfg: LanguageConfig): ScanRange[] {
    const ranges: ScanRange[] = [];
    const blockByOpen = new Map<string, BlockSpec>();
    const lineByMark = new Map<string, string>();
    for (const b of cfg.block) blockByOpen.set(b.open, b);
    for (const l of cfg.line) lineByMark.set(l, l);

    const blockOpens = cfg.block.map((b) => b.open).sort((a, b) => b.length - a.length);
    const lineMarks = cfg.line.slice().sort((a, b) => b.length - a.length);
    const stringSpecs = cfg.strings.slice().sort((a, b) => {
        const la = a.kind.startsWith('triple') || a.kind === 'verbatim-double' || a.kind === 'rust-raw' ? 2 : 1;
        const lb = b.kind.startsWith('triple') || b.kind === 'verbatim-double' || b.kind === 'rust-raw' ? 2 : 1;
        return lb - la;
    });

    let i = 0;
    const n = text.length;
    while (i < n) {
        const ch = text[i];
        if (ch === '\n') { i++; continue; }
        if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
        if (ch === "'" || ch === '"' || ch === '`' || ch === '@' || ch === 'r') {
            const open = findStringOpen(text, i, stringSpecs);
            if (open) {
                i += open.len;
                let esc = false;
                while (i < n) {
                    const len = stringCloseLen(text, i, open.spec, open.len);
                    if (len === -2) { i += 2; continue; }
                    if (len === -1) { i += 2; continue; }
                    if (len) { i += len; break; }
                    i++;
                }
                continue;
            }
        }
        let matched = false;
        for (const open of blockOpens) {
            if (text.startsWith(open, i)) {
                const spec = blockByOpen.get(open)!;
                if (spec.lineStartOnly && !isLineStart(text, i)) break;
                let depth = 1;
                let j = i + open.length;
                while (j < n) {
                    if (spec.nested && text.startsWith(open, j)) { depth++; j += open.length; continue; }
                    if (text.startsWith(spec.close, j)) { depth--; j += spec.close.length; if (depth === 0) break; continue; }
                    j++;
                }
                ranges.push({ start: i, end: j });
                i = j;
                matched = true;
                break;
            }
        }
        if (matched) continue;
        for (const mark of lineMarks) {
            if (!text.startsWith(mark, i)) continue;
            if (mark === '#' && text[i + 1] === '!') continue;
            if (cfg.hashNotBracket && mark === '#' && text[i + 1] === '[') continue;
            if (cfg.hashNotAfterDollar && mark === '#' && i > 0 && text[i - 1] === '$') continue;
            if (cfg.hashLineStartOnly && !isLineStart(text, i)) break;
            let j = i + mark.length;
            while (j < n && text[j] !== '\n') j++;
            ranges.push({ start: i, end: j });
            i = j;
            matched = true;
            break;
        }
        if (matched) continue;
        i++;
    }
    return ranges;
}
