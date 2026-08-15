import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { LANGUAGES, EXTENSION_TO_LANG, TS_LIKE, LanguageConfig } from './languages';
import { scanComments, ScanRange } from './scanner';
import { StripOptions, StripTextResult, StripFileResult, StripBatchResult, UnusedTextResult, UnusedFileResult, UnusedBatchResult } from './types';
import { scriptKindFor, stripUnusedVars, collapseBlanks } from './unused';

function dedupe(ranges: ScanRange[]): ScanRange[] {
    ranges.sort((a, b) => a.start - b.start);
    const out: ScanRange[] = [];
    for (const r of ranges) {
        const last = out[out.length - 1];
        if (last && r.start <= last.end) continue;
        out.push(r);
    }
    return out;
}

function cleanBlanks(text: string): string {
    const lines = text.split('\n').map((l) => l.replace(/[ \t]+$/, ''));
    const cleaned: string[] = [];
    let pendingBlank = false;
    for (const l of lines) {
        if (l.trim() === '') {
            pendingBlank = true;
            continue;
        }
        if (pendingBlank && cleaned.length > 0) cleaned.push('');
        cleaned.push(l);
        pendingBlank = false;
    }
    const final: string[] = [];
    const endsOpen = (s: string) => /[{(\[:]\s*$/.test(s);
    const startsClose = (s: string) => /^\s*[})]/.test(s);
    for (let i = 0; i < cleaned.length; i++) {
        const l = cleaned[i];
        const prev = final.length ? final[final.length - 1] : '';
        const next = cleaned[i + 1] ?? '';
        if (l.trim() === '' && (endsOpen(prev) || startsClose(next))) continue;
        final.push(l);
    }
    return final.join('\n') + '\n';
}

function collectTsComments(text: string, kind: 'TS' | 'JS'): ScanRange[] {
    const ts = require('typescript') as typeof import('typescript');
    const sourceFile = ts.createSourceFile('f.' + (kind === 'TS' ? 'ts' : 'js'), text, ts.ScriptTarget.Latest, true, kind === 'TS' ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const ranges: ScanRange[] = [];
    let lastEnd = 0;
    const visit = (node: any) => {
        if (ts.isSourceFile(node)) return;
        const lead = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart());
        if (lead) for (const r of lead) ranges.push({ start: r.pos, end: r.end });
        const trail = ts.getTrailingCommentRanges(sourceFile.text, node.getEnd());
        if (trail) for (const r of trail) ranges.push({ start: r.pos, end: r.end });
        lastEnd = Math.max(lastEnd, node.getEnd());
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    const eof = ts.getTrailingCommentRanges(sourceFile.text, lastEnd);
    if (eof) for (const r of eof) ranges.push({ start: r.pos, end: r.end });
    return dedupe(ranges);
}

function nextContentLine(text: string, from: number): { line: string; hasBlank: boolean } {
    let idx = from;
    let sawBlank = false;
    while (idx < text.length) {
        const nl = text.indexOf('\n', idx);
        const end = nl < 0 ? text.length : nl;
        const line = text.slice(idx, end);
        if (line.trim() === '') {
            sawBlank = true;
            idx = end + 1;
            continue;
        }
        return { line, hasBlank: sawBlank };
    }
    return { line: '', hasBlank: true };
}

function commentRunEnd(text: string, rangeEnd: number, marker: string): number {
    let pos = rangeEnd;
    if (text[pos] === '\r') pos++;
    if (text[pos] === '\n') pos++;
    for (;;) {
        const le = text.indexOf('\n', pos);
        const end = le < 0 ? text.length : le;
        if (!text.slice(pos, end).trimStart().startsWith(marker)) return pos;
        pos = end;
        if (text[pos] === '\r') pos++;
        if (text[pos] === '\n') pos++;
    }
}

function isGoDoc(text: string, r: ScanRange): boolean {
    const runEnd = commentRunEnd(text, r.end, '//');
    const next = nextContentLine(text, runEnd);
    if (next.hasBlank) return false;
    return /^(package|func|type|var|const|import)\b/.test(next.line.trimStart());
}

function isRubyDoc(text: string, r: ScanRange): boolean {
    const content = text.slice(r.start + 1, r.end).trimStart();
    if (/^(frozen_string_literal|encoding|coding|typed|warn_indent)\s*:/.test(content)) return true;
    const runEnd = commentRunEnd(text, r.end, '#');
    const next = nextContentLine(text, runEnd);
    if (next.hasBlank) return false;
    return /^(class|module|def)\b/.test(next.line.trimStart());
}

function isMatlabDoc(text: string, r: ScanRange): boolean {
    const own = text.lastIndexOf('\n', r.start - 1) + 1;
    let onlyHeader = true;
    let k = 0;
    while (k < own) {
        const nl = text.indexOf('\n', k);
        const end = nl < 0 ? own : nl;
        const line = text.slice(k, end).trim();
        if (line !== '' && !line.startsWith('%')) { onlyHeader = false; break; }
        k = end + 1;
    }
    if (onlyHeader) return true;
    const prev = prevContentLine(text, own);
    return /^function\b/.test(prev.line.trimStart());
}

function prevContentLine(text: string, before: number): { line: string; hasBlank: boolean } {
    let idx = before - 1;
    let sawBlank = false;
    while (idx >= 0) {
        const ls = text.lastIndexOf('\n', idx - 1) + 1;
        const line = text.slice(ls, idx + 1);
        if (line.trim() === '') { sawBlank = true; idx = ls - 1; continue; }
        return { line, hasBlank: sawBlank };
    }
    return { line: '', hasBlank: true };
}

function isDocblock(text: string, r: ScanRange, cfg?: LanguageConfig, lang?: string): boolean {
    const head = text.slice(r.start, r.start + 4);
    if (head.startsWith('/**') && !head.startsWith('/**/')) return true;
    if (head.startsWith('/*!')) return true;
    if (lang === 'go' && isGoDoc(text, r)) return true;
    if (lang === 'ruby' && isRubyDoc(text, r)) return true;
    if (lang === 'matlab' && isMatlabDoc(text, r)) return true;
    if (!cfg?.docMarkers) return false;
    for (const m of cfg.docMarkers) {
        if (text.startsWith(m, r.start)) return true;
    }
    return false;
}

function stripTextOnce(text: string, lang: string, preserveHeader = false, preserveDocblocks = true): { text: string; count: number } {
    const cfg: LanguageConfig | undefined = LANGUAGES[lang];
    if (!cfg) return { text, count: 0 };
    let ranges = TS_LIKE.has(lang)
        ? collectTsComments(text, lang === 'typescript' ? 'TS' : 'JS')
        : scanComments(text, cfg);
    if (preserveDocblocks) {
        ranges = ranges.filter((r) => !isDocblock(text, r, cfg, lang));
    }
    if (ranges.length === 0) return { text, count: 0 };
    let kept = 0;
    if (preserveHeader) {
        let gapStart = 0;
        while (kept < ranges.length) {
            const r = ranges[kept];
            const gap = text.slice(gapStart, r.start);
            if (!/^[\uFEFF\s]*$/.test(gap)) break;
            gapStart = r.end;
            kept++;
        }
        if (kept > 0) ranges = ranges.slice(kept);
    }
    let out = '';
    let prev = 0;
    for (const r of ranges) {
        out += text.slice(prev, r.start);
        prev = r.end;
    }
    out += text.slice(prev);
    return { text: out, count: ranges.length };
}

function collectFiles(paths: string[]): string[] {
    const files: string[] = [];
    for (const p of paths) {
        const abs = path.resolve(p);
        let stat: fs.Stats;
        try {
            stat = fs.statSync(abs);
        } catch {
            continue;
        }
        if (stat.isDirectory()) {
            const walk = (dir: string) => {
                for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'out' || ent.name === 'coverage' || ent.name === '.git') continue;
                    const full = path.join(dir, ent.name);
                    if (ent.isDirectory()) walk(full);
                    else files.push(full);
                }
            };
            walk(abs);
        } else {
            files.push(abs);
        }
    }
    return files;
}

export class CommentStripperEngine {
    constructor(private options: StripOptions = {}) {}

    detectLanguage(filename: string): string | null {
        const base = path.basename(filename);
        const ext = path.extname(base).toLowerCase();
        if (EXTENSION_TO_LANG[ext]) return EXTENSION_TO_LANG[ext];
        if (EXTENSION_TO_LANG[base]) return EXTENSION_TO_LANG[base];
        if (/\.d\.ts$/.test(base)) return 'typescript';
        return null;
    }

    stripText(text: string, lang: string, opts?: StripOptions): StripTextResult {
        const keepSingleBlank = opts?.keepSingleBlank ?? this.options.keepSingleBlank ?? true;
        const preserveHeader = opts?.preserveHeader ?? this.options.preserveHeader ?? false;
        const preserveDocblocks = opts?.preserveDocblocks ?? this.options.preserveDocblocks ?? true;
        const bom = text.charCodeAt(0) === 0xfeff ? '\uFEFF' : '';
        const body = bom ? text.slice(1) : text;
        const crlf = body.includes('\r\n');
        const normalized = body.replace(/\r\n/g, '\n');
        const first = stripTextOnce(normalized, lang, preserveHeader, preserveDocblocks);
        const verify = stripTextOnce(first.text, lang, preserveHeader, preserveDocblocks);
        if (verify.text !== first.text) {
            throw new Error('leftover comments after strip for ' + lang);
        }
        const cleaned = keepSingleBlank ? cleanBlanks(first.text) : first.text;
        const final = crlf ? cleaned.replace(/\n/g, '\r\n') : cleaned;
        return { text: bom + final, comments: first.count };
    }

    stripFile(file: string, opts?: StripOptions): StripFileResult {
        const lang = this.detectLanguage(file);
        if (!lang) {
            return { file, lang: 'unknown', comments: 0, bytes: 0, changed: false };
        }
        const original = fs.readFileSync(file, 'utf8');
        const res = this.stripText(original, lang, opts);
        const changed = res.text !== original;
        if (changed) {
            fs.writeFileSync(file, res.text);
        }
        return { file, lang, comments: res.comments, bytes: Buffer.byteLength(res.text, 'utf8'), changed };
    }

    stripPaths(paths: string[], opts?: StripOptions): StripBatchResult {
        const files = collectFiles(paths);
        const results: StripFileResult[] = [];
        const errors: string[] = [];
        let totalComments = 0;
        for (const f of files) {
            try {
                const r = this.stripFile(f, opts);
                results.push(r);
                totalComments += r.comments;
            } catch (e) {
                errors.push(f + ': ' + (e instanceof Error ? e.message : String(e)));
            }
        }
        return { files: results, errors, totalComments };
    }

    stripUnusedText(text: string, lang: string, opts?: StripOptions): UnusedTextResult {
        const keepSingleBlank = opts?.keepSingleBlank ?? this.options.keepSingleBlank ?? true;
        const bom = text.charCodeAt(0) === 0xfeff ? '\uFEFF' : '';
        const body = bom ? text.slice(1) : text;
        const crlf = body.includes('\r\n');
        const normalized = body.replace(/\r\n/g, '\n');
        const kind: 'TS' | 'JS' = TS_LIKE.has(lang) ? (lang === 'typescript' ? 'TS' : 'JS') : 'JS';
        const res = stripUnusedVars(normalized, kind);
        const cleaned = keepSingleBlank ? collapseBlanks(res.text) : res.text;
        const final = crlf ? cleaned.replace(/\n/g, '\r\n') : cleaned;
        return { text: bom + final, removed: res.removed };
    }

    stripUnusedFile(file: string, opts?: StripOptions): UnusedFileResult {
        const lang = this.detectLanguage(file);
        if (!lang || !TS_LIKE.has(lang)) {
            return { file, lang: lang || 'unknown', removed: 0, bytes: 0, changed: false };
        }
        const original = fs.readFileSync(file, 'utf8');
        const kind: 'TS' | 'JS' = lang === 'typescript' ? 'TS' : 'JS';
        const res = stripUnusedVars(original, kind, scriptKindFor(lang, file));
        const final = (opts?.keepSingleBlank ?? this.options.keepSingleBlank ?? true) ? collapseBlanks(res.text) : res.text;
        const changed = final !== original;
        if (changed) {
            fs.writeFileSync(file, final);
        }
        return { file, lang, removed: res.removed, bytes: Buffer.byteLength(final, 'utf8'), changed };
    }

    stripUnusedPaths(paths: string[], opts?: StripOptions): UnusedBatchResult {
        const files = collectFiles(paths);
        const results: UnusedFileResult[] = [];
        const errors: string[] = [];
        let totalRemoved = 0;
        for (const f of files) {
            try {
                const r = this.stripUnusedFile(f, opts);
                results.push(r);
                totalRemoved += r.removed;
            } catch (e) {
                errors.push(f + ': ' + (e instanceof Error ? e.message : String(e)));
            }
        }
        return { files: results, errors, totalRemoved };
    }

    gitChangedFiles(cwd?: string): string[] {
        const root = cwd || process.cwd();
        const out = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', '*.ts', '*.tsx', '*.js', '*.jsx', '*.py', '*.rb', '*.php', '*.c', '*.cpp', '*.h', '*.hpp', '*.java', '*.kt', '*.cs', '*.go', '*.rs', '*.swift', '*.lua', '*.hs', '*.sql', '*.sh', '*.yaml', '*.yml', '*.css', '*.html', '*.xml', '*.jsonc'], { cwd: root, encoding: 'utf8' });
        return out.split('\n').map((s) => s.trim()).filter(Boolean);
    }
}
