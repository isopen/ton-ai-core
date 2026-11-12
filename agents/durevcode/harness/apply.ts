import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

export type CandidateEdit =
    | { path: string; content: string }
    | { path: string; search: string; replacement: string };

export interface CandidateSpec {
    name: string;
    rationale?: string;
    edits: CandidateEdit[];
}

export const HARNESS_ALLOWED_FILES = ['.opencode/opencode.json'];
export const HARNESS_ALLOWED_PREFIXES = ['.opencode/skills/', '.opencode/scripts/'];

export function pathAllowed(path: string): boolean {
    const normalized = String(path ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalized.length === 0) return false;
    if (isAbsolute(normalized)) return false;
    if (normalized.split('/').includes('..')) return false;
    if (HARNESS_ALLOWED_FILES.includes(normalized)) return true;
    return HARNESS_ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function validateCandidate(candidate: unknown): CandidateSpec {
    const spec = candidate as CandidateSpec;
    if (!spec || typeof spec !== 'object') throw new Error('candidate must be an object');
    if (typeof spec.name !== 'string' || spec.name.trim().length === 0) throw new Error('candidate.name is required');
    if (!Array.isArray(spec.edits) || spec.edits.length === 0) throw new Error(`candidate ${spec.name}: edits must be a non-empty array`);
    for (const edit of spec.edits) {
        if (!edit || typeof edit.path !== 'string' || !pathAllowed(edit.path)) {
            throw new Error(`candidate ${spec.name}: path not allowed: ${JSON.stringify(edit?.path)}`);
        }
        const hasContent = typeof (edit as { content?: unknown }).content === 'string';
        const hasSearch =
            typeof (edit as { search?: unknown }).search === 'string' &&
            typeof (edit as { replacement?: unknown }).replacement === 'string';
        if (!hasContent && !hasSearch) {
            throw new Error(`candidate ${spec.name}: edit for ${edit.path} needs content or search+replacement`);
        }
    }
    return spec;
}

export function applyEdits(root: string, edits: CandidateEdit[]): string[] {
    const repoRoot = resolve(root);
    const written: string[] = [];
    for (const edit of edits) {
        const target = resolve(root, edit.path);
        if (!target.startsWith(repoRoot + sep)) throw new Error(`edit escapes root: ${edit.path}`);
        let text: string;
        if (typeof (edit as { content?: string }).content === 'string') {
            text = (edit as { content: string }).content;
        } else {
            const search = edit as { path: string; search: string; replacement: string };
            text = readFileSync(target, 'utf8');
            const parts = text.split(search.search);
            if (parts.length !== 2) {
                throw new Error(`search must match exactly once in ${search.path} (matches=${parts.length - 1})`);
            }
            text = parts.join(search.replacement);
        }
        mkdirSync(target.slice(0, target.lastIndexOf(sep)), { recursive: true });
        writeFileSync(target, text);
        written.push(edit.path);
    }
    return written;
}

export function editsToDiffText(spec: CandidateSpec): string {
    const lines = [`# candidate: ${spec.name}`, spec.rationale ?? ''];
    for (const edit of spec.edits) {
        lines.push(`## ${edit.path}`, '```json', JSON.stringify(edit, null, 2), '```');
    }
    return lines.join('\n');
}
