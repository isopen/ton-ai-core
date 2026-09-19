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

export interface ProgressState {
    title: string;
    directory: string;
    activity: string[];
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
    lines.push(`<code>${escapeHtml(truncate(state.directory, 80))}</code>`);
    const activity = state.activity.slice(-4);
    for (const line of activity) {
        lines.push(escapeHtml(truncate(line, 160)));
    }
    if (state.lastText) {
        lines.push(`💬 <i>${escapeHtml(truncate(state.lastText, 300))}</i>`);
    }
    const files = state.files.slice(-5).map((f) => escapeHtml(truncate(repoRelative(f, state.directory), 90)));
    const stats =
        `🧰 ${state.toolCalls} • 🪙 ${(state.tokensIn + state.tokensOut).toLocaleString('en-US')}` +
        ` • 💰 $${state.cost.toFixed(4)} • 📁 ${state.files.length}`;
    lines.push(stats);
    if (files.length > 0) {
        lines.push(`<code>${files.join('\n')}</code>`);
    }
    lines.push(`<i>updated ${formatDuration(state.startedAt, state.updatedAt)} in</i>`);
    const text = lines.join('\n');
    return text.length > RENDER_BUDGET ? `${text.slice(0, RENDER_BUDGET - 1)}…` : text;
}

export interface SummaryState {
    title: string;
    directory: string;
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
    lines.push(`<code>${escapeHtml(truncate(state.directory, 80))}</code>`);
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
