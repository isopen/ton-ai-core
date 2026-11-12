import { TuneTask } from './tasks';

export interface ProposalParseResult {
    candidates: unknown[];
    parseError?: string;
}

const EDIT_RULES = [
    'Edit ONLY paths under .opencode/skills/, .opencode/scripts/ or the file .opencode/opencode.json.',
    'When editing opencode.json, the replacement must itself be valid JSON text: never put a literal newline or tab inside a JSON string value; escape as \\n / \\t. Prefer editing a single instruction string in place over inserting new array elements.',
    'For opencode.json use "search"+"replacement" with the smallest unique snippet; verify the result is valid JSON before answering.',
    'For skills (SKILL.md) you may use full "content" rewrites; keep frontmatter (name/description) intact.',
    'Keep every edit minimal and behavior-driven: no renaming, no reformatting, no comments, no new MCP servers, no env vars, no network calls.',
    'Target the behavioral gaps you saw in evidence, not the wording of a single task.',
    'You are tuning the harness of an OpenCode project (system prompt lines, skills, scripts) for a live Telegram-host coding agent.',
    'The harness decides HOW the agent behaves: when to ask clarifying questions (question tool with forms), how strictly it verifies findings before edits, how it investigates before changing code.',
    'Optimize for: root-cause isolation first, complete question forms (never auto-submitting unfilled questions), minimal diffs, mandatory test runs before claiming success, honest reporting.',
].join('\n');

export function declareProposePrompt(
    tasks: TuneTask[],
    evidence: string,
    k: number,
    lessons: string,
): string {
    const taskLines = tasks
        .map((task) => `- id=${task.id}: ${task.title}\n  prompt (user ask): ${task.prompt.slice(0, 800)}\n  reference behavior: ${task.lessonsHint ?? 'n/a'}`)
        .join('\n');
    return [
        'Read the current harness first: .opencode/opencode.json (instructions array) and .opencode/skills/*/SKILL.md frontmatter are the editable surface. Full inventory:',
        '<tasks>',
        taskLines,
        '</tasks>',
        '<evidence>',
        evidence.slice(0, 18000),
        '</evidence>',
        lessons.length > 0 ? `<lessons>\n${lessons.slice(0, 4000)}\n</lessons>` : '',
        `Propose up to ${k} distinct candidate harnesses. Each candidate targets a different lever (e.g. stricter verification checklist, better question-form protocol, investigation-before-edit requirement).`,
        'Answer with ONE fenced json block and nothing else:',
        '```json',
        '{"candidates":[{"name":"short-kebab-name","rationale":"2-3 sentences","edits":[{"path":".opencode/opencode.json","search":"exact existing text","replacement":"new text"}]}]}',
        '```',
        'Use "content" instead of search/replacement only for a full-file rewrite of a small file. The JSON must be valid and complete.',
    ].join('\n');
}

export function composePrompt(
    tasks: TuneTask[],
    evidence: string,
    lessons: string,
): string {
    return [
        'You now see probe results for the candidate harnesses. Compose the single best final harness:',
        '- keep edits that correlate with passing checks;',
        '- drop or fix edits that correlate with failures;',
        '- the result must be one candidate named "composed".',
        EDIT_RULES,
        '<tasks>',
        tasks.map((task) => `- id=${task.id}: ${task.title}`).join('\n'),
        '</tasks>',
        '<evidence>',
        evidence.slice(0, 18000),
        '</evidence>',
        lessons.length > 0 ? `<lessons>\n${lessons.slice(0, 4000)}\n</lessons>` : '',
        'Answer with ONE fenced json block:',
        '```json',
        '{"candidates":[{"name":"composed","rationale":"3-6 sentences with evidence references","edits":[...]}],"lessons":["short evidence-backed lesson", "..."]}',
        '```',
        '2-6 lessons, each one actionable for future harness tuning. Reference candidate/task ids.',
    ].join('\n');
}

function jsonSources(text: string): string[] {
    const sources: string[] = [];
    for (const match of text.matchAll(/```(?:json)?\s*\r?\n?([\s\S]*?)```/gi)) sources.push(match[1]);
    sources.push(text);
    return sources;
}

function balancedObjects(text: string): string[] {
    const found: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{') {
            if (depth === 0) start = index;
            depth += 1;
            continue;
        }
        if (char === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0 && start !== -1) {
                found.push(text.slice(start, index + 1));
                start = -1;
            }
        }
    }
    return found;
}

export interface ComposeParseResult {
    candidates: unknown[];
    lessons: string[];
    parseError?: string;
}

export function parseCandidates(text: string): ProposalParseResult {
    for (const source of jsonSources(text)) {
        try {
            const parsed = JSON.parse(source) as { candidates?: unknown[] };
            if (Array.isArray(parsed.candidates)) return { candidates: parsed.candidates };
        } catch {
            continue;
        }
    }
    for (const source of balancedObjects(text)) {
        try {
            const parsed = JSON.parse(source) as { candidates?: unknown[] };
            if (Array.isArray(parsed.candidates)) return { candidates: parsed.candidates };
        } catch {
            continue;
        }
    }
    return { candidates: [], parseError: 'no parseable candidates json in reply' };
}

export function parseComposeReply(text: string): ComposeParseResult {
    const sources = [...jsonSources(text), ...balancedObjects(text)];
    for (const source of sources) {
        try {
            const parsed = JSON.parse(source) as { candidates?: unknown[]; lessons?: unknown[] };
            const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
            const lessons = Array.isArray(parsed.lessons)
                ? parsed.lessons.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
                : [];
            if (candidates.length > 0 || lessons.length > 0) return { candidates, lessons };
        } catch {
            continue;
        }
    }
    return { candidates: [], lessons: [], parseError: 'no parseable compose json in reply' };
}
