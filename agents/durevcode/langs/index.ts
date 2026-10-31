import { InlineKeyboardMarkup } from '@ton-ai/telegram-bot-api';
import { ContextSnapshot, ModelApiInfo, PermissionDecision } from '@ton-ai/opencode';
import {
    EMOJI,
    escapeHtml,
    formatModelContext,
    icon,
    modelVariantIds,
    truncate,
} from '../formatter';

export const PERMISSION_DECISION_ICONS: Record<PermissionDecision, string> = {
    always: '♾️',
    once: EMOJI.check,
    reject: EMOJI.denied,
};

export function sessionTagOf(sessionId: string): string {
    return sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'session';
}

export function formatTokenShort(value: number): string {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return String(value);
}

export function shortUptime(ms: number): string {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return minutes % 60 > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    return `${mins}m`;
}

export function opencodeSourceDisplay(baseUrl: string): string {
    const trimmed = baseUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return trimmed || 'unknown';
}

export function answerLeadHtml(mention: string, uid?: number): string {
    return uid !== undefined && uid > 0
        ? `<a href="tg://user?id=${uid}">${escapeHtml(mention)}</a>`
        : `<b>${escapeHtml(mention)}</b>`;
}

export function transcriptEcho(text: string): string {
    return `${icon('chat')} ${escapeHtml(text)}`;
}

export function modelCardEntries(models: ModelApiInfo[], currentId: string): ModelApiInfo[] {
    const cappedModels = models.slice(0, 19);
    if (currentId && !cappedModels.some((m) => m.id === currentId)) {
        const currentModel = models.find((m) => m.id === currentId);
        if (currentModel) cappedModels.push(currentModel);
    }
    return cappedModels;
}

export function modelCardMarkup(
    models: ModelApiInfo[],
    currentId: string,
    currentVariant: string,
): InlineKeyboardMarkup {
    const label = (m: ModelApiInfo) => {
        const prefix = m.id === currentId ? `${EMOJI.check} ` : '';
        const context = formatModelContext(m.limit);
        const base = truncate(m.name || m.id, context ? 28 : 40);
        return context ? `${prefix}${base} · ${context}` : `${prefix}${base}`;
    };
    const cappedModels = modelCardEntries(models, currentId);
    const rows: InlineKeyboardMarkup['inline_keyboard'] = cappedModels.map((m) => [{
        text: label(m),
        callback_data: `model:${m.id}`,
    }]);
    const current = cappedModels.find((m) => m.id === currentId);
    const variants = current ? modelVariantIds(current) : [];
    if (variants.length > 0) {
        rows.push(variants.map((variant) => ({
            text: variant === currentVariant ? `${EMOJI.check} ${variant}` : variant,
            callback_data: `modelvariant:${variant}`,
        })));
    }
    return { inline_keyboard: rows };
}

export interface StatusCardVoiceStats {
    audioSec: number;
    processingMs: number;
    at: number;
}

export interface StatusCardInput {
    now: number;
    bootAt: number;
    rateLimitedUntil: number;
    opencodeBaseUrl: string;
    whisper: {
        enabled?: boolean;
        autoServe?: boolean;
        serverUrl?: string;
        threads?: number;
        language?: string;
    } | null | undefined;
    voice: StatusCardVoiceStats | null;
    title: string;
    sessionTag: string;
    modelRefText: string;
    variantText: string;
    buildMode: boolean;
    sessionAgent: string;
    turnComplete: boolean;
    lastEventAt: number;
    promptQueueLength: number;
    cost: number;
    snapshot: ContextSnapshot | null;
    contextLimit: number | null;
}

export function settingRow(label: string, display: string): string {
    return `⚙️ ${escapeHtml(label)}: <b>${escapeHtml(display)}</b>`;
}

// Short codes of the supported interface languages — the /langs card option
// buttons show these so every language is selectable in one tap.
export const LANG_NAMES: Record<string, string> = {
    en: 'EN',
    ru: 'RU',
    zh: 'ZH',
    hi: 'HI',
};

// A /langs section line: the section label lives in the card text (above the
// keyboard, not clickable), with an explicit hint which button row belongs to it.
export function langSectionLine(iconKey: 'bot' | 'chat', label: string, display: string, rowHint: string): string {
    return `${icon(iconKey)} <b>${escapeHtml(label)}</b>: <b>${escapeHtml(display)}</b> · ${escapeHtml(rowHint)}`;
}

export function settingEcho(label: string, display: string): string {
    return `${label}: ${display}`;
}
