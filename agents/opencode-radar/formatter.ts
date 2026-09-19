export const TELEGRAM_TEXT_LIMIT = 4096;
export const RENDER_BUDGET = 3900;
export const FORUM_TOPIC_NAME_LIMIT = 128;

export function formatTopicName(title: string, sessionId: string): string {
    const prefix = '📡 ';
    const tag = sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'session';
    const suffix = ` · ${tag}`;
    const cleanTitle = title.replace(/\s+/g, ' ').trim() || 'Untitled session';
    const budget = FORUM_TOPIC_NAME_LIMIT - prefix.length - suffix.length - 8;
    const head = cleanTitle.length > budget ? `${cleanTitle.slice(0, Math.max(0, budget))}…` : cleanTitle;
    return `${prefix}${head}${suffix}`;
}

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    if (max <= 1) return '…';
    return `${text.slice(0, max - 1)}…`;
}

export function repoRelative(filePath: string, directory: string): string {
    const prefix = directory.endsWith('/') ? directory : `${directory}/`;
    return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

export function formatDuration(startedAt: number, finishedAt: number): string {
    const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function displayModel(model: string): string {
    const trimmed = model.trim();
    if (!trimmed) return '';
    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const id = (parsed as Record<string, unknown>).id;
            if (typeof id === 'string' && id.length > 0) return id;
        }
    } catch {
        /* not JSON — use raw value */
    }
    return trimmed;
}

export type TodoState = 'done' | 'active' | 'queued';

export interface TodoItem {
    content: string;
    state: TodoState;
}

export function toTodoState(status: string): TodoState {
    if (status === 'completed') return 'done';
    if (status === 'in_progress') return 'active';
    return 'queued';
}

export function todoIcon(state: TodoState): string {
    if (state === 'done') return '✅';
    if (state === 'active') return '🔄';
    return '⬜';
}

export type ToolState = 'ok' | 'fail' | 'running';

export interface ToolItem {
    text: string;
    state: ToolState;
}

export function toToolState(status: string): ToolState {
    if (status === 'completed') return 'ok';
    if (status === 'error' || status === 'failed') return 'fail';
    return 'running';
}

export function toolIcon(state: ToolState): string {
    if (state === 'ok') return '✅';
    if (state === 'fail') return '❌';
    return '⚙️';
}

export interface ResultSnippet {
    tool: string;
    ok: boolean;
    text: string;
}

export interface ProgressState {
    title: string;
    directory: string;
    model: string;
    todos: TodoItem[];
    tools: ToolItem[];
    result: ResultSnippet | null;
    lastText: string;
    toolCalls: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    files: string[];
    startedAt: number;
    updatedAt: number;
}

export function formatProgress(state: ProgressState): string {
    const lines: string[] = [];
    lines.push(`🔄 <b>${escapeHtml(truncate(state.title, 80))}</b>`);
    const model = displayModel(state.model);
    lines.push(`📁 <code>${escapeHtml(truncate(state.directory, 60))}</code>${model ? ` · 🤖 ${escapeHtml(truncate(model, 40))}` : ''}`);
    const todos = state.todos.slice(0, 8);
    if (todos.length > 0) {
        const done = todos.filter((t) => t.state === 'done').length;
        lines.push(`📋 План ${done}/${todos.length}`);
        for (const todo of todos) {
            lines.push(`${todoIcon(todo.state)} ${escapeHtml(truncate(todo.content, 120))}`);
        }
    }
    for (const tool of state.tools.slice(-4)) {
        lines.push(`${toolIcon(tool.state)} ${escapeHtml(truncate(tool.text, 140))}`);
    }
    if (state.result && state.result.text) {
        const mark = state.result.ok ? '✅' : '❌';
        lines.push(`📄 ${escapeHtml(truncate(state.result.tool, 40))} ${mark}`);
        lines.push(
            `<tg-spoiler><code>${escapeHtml(truncate(state.result.text, 400))}</code></tg-spoiler>`,
        );
    }
    const footer =
        `🧰 ${state.toolCalls} • 🪙 ${(state.tokensIn + state.tokensOut).toLocaleString('en-US')}` +
            ` • 💰 $${state.cost.toFixed(4)} • 📁 ${state.files.length}` +
            ` • ⏱ ${formatDuration(state.startedAt, state.updatedAt)} in`;
    if (state.lastText) {
        const top = lines.join('\n');
        const room = RENDER_BUDGET - top.length - footer.length - 12;
        if (room >= 2) {
            lines.push(`💬 <i>${escapeHtml(truncate(state.lastText, room))}</i>`);
        }
    }
    lines.push(footer);
    const text = lines.join('\n');
    return text.length > RENDER_BUDGET ? `${text.slice(0, RENDER_BUDGET - 1)}…` : text;
}

export interface SummaryState {
    title: string;
    directory: string;
    model: string;
    todos: TodoItem[];
    toolCalls: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    files: string[];
    lastText: string;
    startedAt: number;
    finishedAt: number;
}

export function formatSummary(state: SummaryState): string {
    const lines: string[] = [];
    lines.push(`✅ <b>${escapeHtml(truncate(state.title, 80))}</b> — done in ${formatDuration(state.startedAt, state.finishedAt)}`);
    const model = displayModel(state.model);
    lines.push(`📁 <code>${escapeHtml(truncate(state.directory, 60))}</code>${model ? ` · 🤖 ${escapeHtml(truncate(model, 40))}` : ''}`);
    if (state.todos.length > 0) {
        const done = state.todos.filter((t) => t.state === 'done').length;
        lines.push(`📋 План ${done}/${state.todos.length}`);
    }
    lines.push(
        `🧰 tools: ${state.toolCalls} • 🪙 ${(state.tokensIn + state.tokensOut).toLocaleString('en-US')} ` +
            `(in ${state.tokensIn.toLocaleString('en-US')} / out ${state.tokensOut.toLocaleString('en-US')}) • 💰 $${state.cost.toFixed(4)}`,
    );
    if (state.files.length > 0) {
        const files = state.files
            .slice(-10)
            .map((f) => escapeHtml(truncate(repoRelative(f, state.directory), 90)));
        lines.push(`📁 files (${state.files.length}):\n<code>${files.join('\n')}</code>`);
    }
    if (state.lastText) {
        lines.push(`💬 <i>${escapeHtml(truncate(state.lastText, 500))}</i>`);
    }
    const text = lines.join('\n');
    return text.length > TELEGRAM_TEXT_LIMIT ? `${text.slice(0, TELEGRAM_TEXT_LIMIT - 1)}…` : text;
}
