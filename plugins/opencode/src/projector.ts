import {
    ApiMessage,
    ContextSnapshot,
    RadarEvent,
    SessionApiInfo,
    SessionRow,
} from './types';

const SUMMARY_KEYS = [
    'filePath',
    'file',
    'path',
    'command',
    'query',
    'pattern',
    'prompt',
    'question',
    'url',
    'text',
    'content',
] as const;

export function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function asNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function parsePartData(data: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return null;
    } catch {
        return null;
    }
}

export function summarizeToolInput(tool: string, input: unknown): string {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return tool;
    }
    const record = input as Record<string, unknown>;
    for (const key of SUMMARY_KEYS) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) {
            const oneLine = value.split('\n')[0] as string;
            return `${tool} ${oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine}`;
        }
    }
    if (Array.isArray(record.todos)) {
        const done = record.todos.filter(
            (t): boolean =>
                typeof t === 'object' && t !== null && (t as Record<string, unknown>).status === 'completed',
        ).length;
        return `${tool} ${done}/${record.todos.length} done`;
    }
    return tool;
}

export function contentBlocksText(value: unknown): string {
    if (!Array.isArray(value)) return '';
    const texts: string[] = [];
    for (const block of value) {
        if (block && typeof block === 'object' && !Array.isArray(block)) {
            const text = (block as Record<string, unknown>).text;
            if (typeof text === 'string' && text.length > 0) texts.push(text);
        }
    }
    return texts.join('\n');
}

export function toolResultText(tool: string, state: { input?: unknown; output?: unknown; content?: unknown } | undefined): string {
    const changeText = toolChangeText(tool, state?.input);
    if (changeText) return changeText;
    if (state && typeof state === 'object') {
        const blocks = contentBlocksText((state as Record<string, unknown>).content);
        if (blocks) return blocks;
        const raw = (state as Record<string, unknown>).output;
        if (typeof raw === 'string') return raw;
    }
    return '';
}

export function toolChangeText(tool: string, input: unknown): string {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
    const record = input as Record<string, unknown>;
    const field = (keys: string[]): string => {
        for (const key of keys) {
            const value = record[key];
            if (typeof value === 'string' && value.length > 0) return value;
        }
        return '';
    };
    if (tool === 'edit') {
        const lines: string[] = [];
        const oldText = field(['oldString', 'oldText']);
        const nextText = field(['newString', 'newText']);
        if (!oldText && !nextText) return '';
        if (oldText) {
            for (const line of oldText.split('\n')) lines.push(`- ${line}`);
        }
        if (nextText) {
            for (const line of nextText.split('\n')) lines.push(`+ ${line}`);
        }
        return lines.join('\n');
    }
    if (tool === 'write') {
        return field(['content']);
    }
    return '';
}

export function parseAssistantTokens(data: string): ContextSnapshot | null {
    const parsed = parsePartData(data);
    if (!parsed || parsed.role !== 'assistant') return null;
    const tokens = parsed.tokens;
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
    const record = tokens as Record<string, unknown>;
    const cache = record.cache;
    const cacheRecord = cache && typeof cache === 'object' && !Array.isArray(cache)
        ? (cache as Record<string, unknown>)
        : {};
    const snapshot = {
        input: asNumber(record.input),
        output: asNumber(record.output),
        reasoning: asNumber(record.reasoning),
        cacheRead: asNumber(cacheRecord.read),
        cacheWrite: asNumber(cacheRecord.write),
    };
    if (snapshotTotal(snapshot) <= 0) return null;
    return snapshot;
}

export function snapshotTotal(snapshot: ContextSnapshot): number {
    return snapshot.input + snapshot.output + snapshot.reasoning + snapshot.cacheRead + snapshot.cacheWrite;
}

export function mapPart(row: { id: string; time_updated: number; data: string }): RadarEvent | null {
    const data = parsePartData(row.data);
    if (!data) return null;
    const type = data.type;

    if (type === 'text') {
        const text = asString(data.text).trim();
        if (!text) return null;
        return { kind: 'text', text, time: row.time_updated };
    }

    if (type === 'tool') {
        const tool = asString(data.tool) || 'tool';
        const state = data.state as Record<string, unknown> | undefined;
        const status = typeof state?.status === 'string' ? (state.status as string) : 'running';
        const summary = summarizeToolInput(tool, state?.input);
        return { kind: 'tool', tool, status, summary, output: toolResultText(tool, state), time: row.time_updated };
    }

    if (type === 'step-finish') {
        const tokens = data.tokens as Record<string, unknown> | undefined;
        const total = asNumber(tokens?.total);
        const cost = asNumber(data.cost);
        const finish = asString(data.reason) || asString(data.finish);
        return { kind: 'step', tokens: total, cost, finish, time: row.time_updated };
    }

    if (type === 'patch') {
        const files = Array.isArray(data.files)
            ? (data.files as unknown[]).filter((f): f is string => typeof f === 'string')
            : [];
        if (files.length === 0) return null;
        return { kind: 'files', files, time: row.time_updated };
    }

    return null;
}

export function mapApiMessages(messages: ApiMessage[]): RadarEvent[] {
    const events: RadarEvent[] = [];
    for (const message of messages) {
        const time = asNumber(message.time?.created);
        if (message.type === 'user' || message.type === 'synthetic') {
            const text = asString(message.text).trim();
            if (text) events.push({ kind: 'text', text, time });
            continue;
        }
        if (message.type !== 'assistant' || !Array.isArray(message.content)) continue;
        for (const part of message.content) {
            if (!part || typeof part !== 'object') continue;
            if (part.type === 'text') {
                const text = asString(part.text).trim();
                if (text) events.push({ kind: 'text', text, time });
            } else if (part.type === 'tool') {
                const tool = asString(part.name) || 'tool';
                const status = asString(part.state?.status) || 'running';
                events.push({
                    kind: 'tool',
                    tool,
                    status,
                    summary: summarizeToolInput(tool, part.state?.input),
                    output: toolResultText(tool, part.state),
                    time,
                });
            }
        }
    }
    return events;
}

export function normalizeSessionApi(info: SessionApiInfo): SessionRow {
    return {
        id: asString(info.id),
        title: asString(info.title),
        directory: asString(info.location?.directory),
        agent: asString(info.agent),
        model: info.model ? JSON.stringify(info.model) : '',
        time_created: asNumber(info.time?.created),
        time_updated: asNumber(info.time?.updated),
        cost: asNumber(info.cost),
        tokens_input: asNumber(info.tokens?.input),
        tokens_output: asNumber(info.tokens?.output),
        tokens_reasoning: asNumber(info.tokens?.reasoning),
    };
}
