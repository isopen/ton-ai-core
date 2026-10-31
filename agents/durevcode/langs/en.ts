import { InlineKeyboardMarkup } from '@ton-ai/telegram-bot-api';
import { ModelApiInfo, PermissionDecision } from '@ton-ai/opencode';
import {
    EMOJI,
    checkIcon,
    describeModelCapabilities,
    escapeHtml,
    formatModelContext,
    hourglassIcon,
    icon,
    modelVariantIds,
    rocketIcon,
    truncate,
} from '../formatter';
import { StatusCardInput, formatTokenShort, langSectionLine, opencodeSourceDisplay, settingRow, shortUptime } from './index';

export * from './index';

export const AUTO_CONTINUE_TEXT = 'Continue';
export const DIGEST_PROMPT_PREFIX = 'Background subagent task finished.';
export const COULD_NOT_LOAD_MODELS = 'Could not load models, try again.';
export const NO_MODELS_AVAILABLE = 'No models available.';
export const QUEST_DONE = 'Done';
export const NO_MODEL_YET = 'No model yet, pick one above.';
export const OUTDATED_ASK_AGAIN = 'Outdated, ask again.';
export const EFFORT_NOT_OFFERED = 'That effort is not offered for this model.';
export const ALREADY_SET = 'Already set.';
export const MODEL_SWITCH_FAILED = 'Could not switch model, try again.';
export const MODE_PLAN_LABEL = 'Plan';
export const MODE_BUILD_LABEL = 'Build';
export const SETTINGS_DEFAULTS_RESTORED = 'Defaults restored.';
export const ADMIN_ONLY_MODES = 'Only forum admins can change modes.';
export const ADMIN_ONLY_SESSION_CARDS = 'Only forum admins can pull session cards.';
export const ADMIN_ONLY_SETTINGS = 'Only forum admins can change settings.';
export const ADMIN_ONLY_MODELS = 'Only forum admins can change models.';
export const ACK_RATE_LIMITED = 'Rate limited, try again in a moment.';
export const ACK_ON_ITS_WAY = 'On its way.';
export const ANSWER_ALL_QUESTIONS = 'Answer every question first.';
export const POLL_FINISH_BUTTON = '✅ Finish vote';
export const POLL_NO_VOTES = 'Poll closed — no votes cast.';
export const POLL_AUTHOR_ONLY = 'Only the prompt author can finish this vote.';
export const THOUGHT_FULL_TEXT_BUTTON = '📄 Full text';
export const THOUGHT_DOC_FAILED = `${icon('fail')} Document upload failed — posting the full text as messages instead.`;
export const PERMISSION_DECISION_LABELS: Record<PermissionDecision, string> = {
    always: 'Always allow',
    once: 'Allow once',
    reject: 'Deny',
};
export const SUBAGENT_FINISHED = `${checkIcon()} Subagent finished the task.`;
export const SUBAGENT_HINT = 'Write the task right after the command: /subagent <task>.';
export const SUBAGENT_FALLBACK = 'No free subagent slot — the task is queued for the main session.';
export const SUBAGENT_STOPPED = `${icon('stop')} Parallel task stopped.`;
export const SUBAGENT_TAG = '#subagent';
export const FANOUT_COPIED_ELSEWHERE =
    `${hourglassIcon()} Same question is already running in another topic — I will copy the answer here too.`;
export const FANOUT_HOLD_TAGGED =
    `${hourglassIcon()} Same question is already being answered in this topic — I will tag you in the shared answer.`;
export const FANOUT_HOLD_QUIET =
    `${hourglassIcon()} Same question is already being answered in this topic — the shared answer will appear here.`;
export const PROMPT_BUSY = `${hourglassIcon()} Session is busy, your prompt is queued.`;
export const DRAIN_STALL_NOTICE =
    `${icon('fail')} The server accepted the prompt but is not processing it. ` +
    'Check the opencode serve log for "Failed to drain Session".';
export const VOICE_OFF_NOTICE =
    `${icon('warn')} Voice transcription is off (set DUREVCODE_WHISPER_ENABLED=1 and DUREVCODE_WHISPER_MODEL) — send text meanwhile.`;
export const VOICE_TRANSCRIBING = `${hourglassIcon()} Transcribing the voice...`;
export const VOICE_EMPTY = `${icon('fail')} Voice transcription came back empty.`;
export const VOICE_FAILED = `${icon('fail')} Voice transcription failed — send it as text.`;
export const MEDIA_TOO_LARGE = `${icon('denied')} Media is too large (max 20 MB), send it as text.`;
export const FILE_DOWNLOAD_FAILED = `${icon('fail')} Could not download the file.`;
export const FILE_STORE_FAILED = `${icon('fail')} Could not store the file.`;
export const FILE_TOO_LARGE = `${icon('denied')} File is too large, send it as text.`;
export const ONLY_TEXT_FILES = `${icon('denied')} Only text files are accepted.`;
export const CLI_SPAWN_FAILED = `${icon('fail')} CLI run failed to spawn, will retry.`;
export const CLI_FALLBACK_NOTICE = `${icon('warn')} Server did not take the prompt, running it via CLI fallback.`;
export const CONTINUE_NOTHING = `${icon('warn')} Nothing to continue yet — send a task first.`;
export const CONTINUE_QUEUED = `${icon('rocket')} Previous task is queued again.`;
export const PERM_DECIDE_HINT = `${icon('warn')} Say yes or no — or tap the button.`;
export const PERMISSION_NEEDED_TITLE = `${icon('question')} Permission needed`;
export const ALREADY_RESOLVED = `${icon('warn')} Already resolved.`;
export const DECISION_SEND_FAILED = `${icon('fail')} Could not send the decision, try again.`;
export const ANSWER_SEND_FAILED = `${icon('fail')} Could not send the answer, try again.`;
export const QUESTION_OUTDATED = `${icon('warn')} This question card is outdated — answer on the fresh one.`;
export const QUESTION_FREE_TEXT_ONLY =
    `${icon('warn')} Tap an option or Done — free text fits single questions only.`;
export const MODE_NO_AGENT_CONTROL = `${icon('fail')} Cannot switch mode: agent control is unavailable.`;
export const MODE_SWITCH_FAILED = `${icon('fail')} Could not switch mode, try again.`;
export const MODE_SWITCH_GONE = `${icon('fail')} Could not switch mode, session is gone.`;
export const SETTINGS_RESET_ALL = `${EMOJI.gears} Reset all`;
export const STOPPED_AGAIN = `${icon('stop')} Stopped, send the task again.`;
export const TOPIC_RESTORE_FAILED = `${icon('fail')} Could not restore the session for this topic, try again.`;
export const TOPIC_SESSION_CREATE_FAILED = `${icon('fail')} Could not create a session for this topic, try again.`;
export const ADMIN_GATE_GENERIC = `${icon('denied')} Only forum admins can change this.`;
export const THINKING_LABEL = 'Thinking';
export const THOUGHT_LABEL = 'Thought';
export const CHARS_LABEL = 'chars';
export const PLAN_LABEL = 'Plan';
export const CMD_DESC_STOP = 'Interrupt the running turn';
export const CMD_DESC_STATUS = 'Show the status card';
export const CMD_DESC_MODE = 'Running mode and watch only';
export const CMD_DESC_MODELS = 'List or switch the model';
export const CMD_DESC_SETTINGS = 'Live settings card';
export const CMD_DESC_LANGS = 'Language settings (also /lang)';
export const CMD_DESC_SUBAGENT = 'Run a parallel subagent (/subagent <task>)';
export const CMD_DESC_SESSIONS = 'List watched sessions';
export const CMD_DESC_HELP = 'What the bot can do';

export function helpCardText(): string {
    return [
        `${icon('bot')} <b>Durevcode</b>`,
        '',
        `/stop — ${CMD_DESC_STOP}`,
        `/status — ${CMD_DESC_STATUS}`,
        `/mode — ${CMD_DESC_MODE}`,
        `/models — ${CMD_DESC_MODELS}`,
        `/settings — ${CMD_DESC_SETTINGS}`,
        `/langs — ${CMD_DESC_LANGS}`,
        `/subagent — ${CMD_DESC_SUBAGENT}`,
        `/sessions — ${CMD_DESC_SESSIONS}`,
        `/help — ${CMD_DESC_HELP}`,
        '',
        'Everything else you type goes to the agent as a prompt. Reply to a message to keep the quote, @mention to address the answer.',
    ].join('\n');
}

export function promptLangDirective(): string {
    return 'Think and answer in English regardless of the user\'s language; English is the only language for your reasoning, intermediate messages and the final answer.';
}
export const SETTINGS_LABELS: Record<string, string> = {
    lang: 'Bot language',
    chatLang: 'Chat language',
    watchOnly: 'Watch only',
    leadMention: '@mention leads',
    quoteReplies: 'Reply quotes',
    autoFinish: 'Finish notices',
    answerFanout: 'Shared answers',
    subagentUsers: 'Subagent users',
    newTopics: 'New topics',
    voice: 'Voice transcription',
    voiceLang: 'Voice language',
    voiceServer: 'Resident whisper server',
    voiceThreads: 'Whisper threads',
    twoColumns: 'Two columns',
};

export function shortAgo(now: number, at: number): string {
    if (at === 0) return 'never';
    const sec = Math.max(1, Math.round((now - at) / 1000));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
    if (sec < 172800) return `${Math.round(sec / 3600)}h ago`;
    return `${Math.round(sec / 86400)}d ago`;
}

export function subagentDispatched(parallel: number): string {
    const tail = parallel > 1 ? ` ${parallel} tasks are running in parallel.` : '';
    return `${icon('bot')} The task went to a parallel subagent — the answer will appear here.${tail}`;
}

export function switchedTo(title: string, tag: string): string {
    return `${checkIcon()} Switched to <b>${escapeHtml(title)}</b> · ${escapeHtml(tag)}`;
}

export function rateLimitedRetry(waitSec: number | string): string {
    return `${hourglassIcon()} Rate limited, retry in ~${waitSec}s — your prompt stays queued.`;
}

export function promptFailed(errText: string): string {
    return `${icon('fail')} Prompt failed: ${errText}`;
}

export function opencodeRetry(errText: string): string {
    return `${icon('warn')} opencode error: ${escapeHtml(errText)} — retrying, your prompt stays queued.`;
}

export function turnStoppedByServer(reason: string): string {
    return `${icon('warn')} opencode stopped the turn: ${escapeHtml(reason)}\n\nWrite again to continue.`;
}

export function opencodeModelError(text: string): string {
    return `${icon('warn')} opencode error: ${escapeHtml(text)}`;
}

export function explainModelError(text: string): string {
    const raw = text.trim();
    const has = (pattern: RegExp): boolean => pattern.test(raw);
    if (has(/FreeTierError|free tier can only be used/i)) {
        return 'the provider refuses free-tier models for requests that do not come from the OpenCode client itself. '
            + 'The agent drives a local opencode server, so those models answer with HTTP 403 here. '
            + 'Pick a model with your own API key, or run the task from the OpenCode app where the free tier is allowed.';
    }
    if (has(/VariantUnavailableError|Variant unavailable/i)) {
        return 'the session is pinned to a model variant the model does not offer, so the turn cannot start. '
            + 'Switch the model in the topic if it repeats.';
    }
    if (has(/429|rate.?limit|too many requests/i)) {
        return 'the provider is rate limiting this model. The task is kept; write again in a minute.';
    }
    if (has(/401|unauthor|forbidden|api key/i)) {
        return 'the provider rejected the credentials for this model. Fix the API key for the session model.';
    }
    if (has(/context length|context_length|maximum context|too many tokens/i)) {
        return 'the request no longer fits the model context window. Start a fresh session for this topic.';
    }
    if (has(/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|network/i)) {
        return 'the provider endpoint could not be reached. Check the network and the opencode server.';
    }
    if (!raw) return 'opencode did not report why the turn stopped.';
    return 'the model call failed for an unclear reason.';
}

export function modelErrorNotice(text: string): string {
    const raw = text.trim();
    const explanation = explainModelError(raw);
    if (!raw) return explanation;
    return `${explanation}\n\nopencode said: ${truncate(raw, 400)}`;
}

export function mediaUnparsed(label: string): string {
    return `${icon('warn')} ${label} can't be parsed yet — send a photo, a video, a document, or text.`;
}

export function cliFailed(code: number): string {
    return `${icon('fail')} CLI run failed (exit ${code}).`;
}

export function permissionDecisionText(decision: PermissionDecision): string {
    if (decision === 'reject') return `${icon('denied')} Denied.`;
    return `${checkIcon()} ${decision === 'always' ? 'Allowed always.' : 'Allowed once.'}`;
}

export function questDoneLabel(answered: number, total: number): string {
    return `Done ${answered}/${total}`;
}

export function modelSwitched(id: string): string {
    return `${icon('check')} Model switched to <b>${escapeHtml(id)}</b>.`;
}

export function effortSet(variant: string, modelId: string): string {
    return `Effort: <b>${escapeHtml(variant)}</b> for <b>${escapeHtml(modelId)}</b>.`;
}

export function modeSwitched(build: boolean, agentId: string): string {
    return (
        `Mode: <b>${build ? 'Build' : 'Plan'}</b> — the model now runs as <b>${escapeHtml(agentId)}</b> and ` +
        `${build ? 'may edit files' : 'will not edit anything'}.`
    );
}

export function watchOnlyToggleLabel(plain: boolean): string {
    return `Watch only · ${settingOnOff(plain)}`;
}

export function settingOnOff(on: boolean): string {
    return on ? 'on' : 'off';
}

export function settingsLabel(key: string): string {
    return SETTINGS_LABELS[key] ?? key;
}

export function modeMarkup(build: boolean, plain: boolean): InlineKeyboardMarkup {
    const label = (text: string, active: boolean) => (active ? `${EMOJI.check} ${text}` : text);
    return {
        inline_keyboard: [
            [
                { text: label(MODE_PLAN_LABEL, !build), callback_data: 'mode:plan' },
                { text: label(MODE_BUILD_LABEL, build), callback_data: 'mode:build' },
            ],
            [
                { text: watchOnlyToggleLabel(plain), callback_data: 'mode:observer' },
            ],
        ],
    };
}

export function modeCardText(input: { build: boolean; current: string; plain: boolean }): string {
    const current = input.current ? ` (${escapeHtml(input.current)})` : '';
    return (
        `Mode: <b>${input.build ? 'Build' : 'Plan'}</b>` +
        `${current}` +
        ' — tap to switch.\n' +
        '<b>Build</b> — the model may edit files.\n' +
        '<b>Plan</b> — the model reads and answers only, no edits.\n' +
        (input.plain
            ? 'Watch only is on — typed prompts are ignored; tap the bottom row to resume prompting.'
            : 'Watch only is off — the bottom row turns the bot into a spectator that submits nothing.')
    );
}

export function modelCardText(currentId: string, currentVariant: string, models?: ModelApiInfo[]): string {
    const current = (models ?? []).find((m) => m.id === currentId);
    const context = formatModelContext(current?.limit);
    const caps = current ? describeModelCapabilities(current) : [];
    const lines = [`Model: <b>${escapeHtml(currentId || 'default')}</b> — tap to switch.`];
    if (current) {
        lines.push(`Context: <b>${escapeHtml(context || '—')}</b>${caps.length > 0 ? ` | ${escapeHtml(caps.join(', '))}` : ''}`);
    }
    const variants = current ? modelVariantIds(current) : [];
    lines.push(
        `Effort: <b>${escapeHtml(currentVariant || 'default')}</b>` +
            (variants.length > 0 ? ` — options: ${escapeHtml(variants.join(', '))}` : ' — no variants.'),
    );
    return lines.join('\n');
}

export function statusCardText(input: StatusCardInput): string {
    const limit = input.contextLimit;
    const limitText = limit !== null && limit > 0 ? formatTokenShort(limit) : '';
    let contextLine: string;
    if (input.snapshot) {
        const occupancy = input.snapshot.input + input.snapshot.cacheRead + input.snapshot.cacheWrite;
        const occupancyText = formatTokenShort(occupancy);
        const percent = limit !== null && limit > 0 ? Math.min(100, Math.max(0, Math.round((occupancy / limit) * 100))) : null;
        contextLine = `${icon('inbox')} Context <b>${occupancyText}${limitText ? `/${limitText} (${percent}%)` : ''}</b>`;
    } else {
        contextLine = `${icon('inbox')} Context <b>—</b>${limitText ? ` · window ${limitText} (no turn tokens yet)` : ''}`;
    }
    const whisper = input.whisper;
    const whisperLine = whisper?.enabled === true
        ? whisper.autoServe === false
            ? 'CLI transcriber'
            : `resident server ${whisper.serverUrl ?? ''}`
        : 'off';
    const lines = [
        `${icon('gears')} <b>Status</b> · ${escapeHtml(input.title)} · <code>${escapeHtml(input.sessionTag)}</code>`,
        `${icon('bot')} OpenCode ${escapeHtml(opencodeSourceDisplay(input.opencodeBaseUrl))}`,
        `${icon('brain')} Model <b>${escapeHtml(input.modelRefText)}</b>${input.variantText ? ` (${escapeHtml(input.variantText)})` : ''} · ${input.buildMode ? 'Build' : 'Plan'} · ${escapeHtml(input.sessionAgent)}`,
        contextLine,
        `${icon('active')} ${input.turnComplete ? 'Idle' : 'Running'} · last event ${shortAgo(input.now, input.lastEventAt)} · up ${shortUptime(input.now - input.bootAt)}`,
    ];
    if (input.promptQueueLength > 0) lines.push(`${icon('queued')} Queue: ${input.promptQueueLength}`);
    if (input.cost > 0) lines.push(`${icon('coin')} $${input.cost.toFixed(2)}`);
    if (input.now < input.rateLimitedUntil) {
        lines.push(`${icon('hourglass')} Rate limit until ${new Date(input.rateLimitedUntil).toLocaleTimeString('en-GB')}`);
    }
    lines.push(`${icon('toolbox')} Whisper: ${whisperLine} (${whisper?.threads ?? 0} threads, ${whisper?.language ?? 'auto'})`);
    if (input.voice) {
        lines.push(`${icon('timer')} Last voice ${input.voice.audioSec.toFixed(0)}s → ${(input.voice.processingMs / 1000).toFixed(1)}s (${shortAgo(input.now, input.voice.at)})`);
    }
    return `${lines.join('\n')}\n`;
}

export function statusCardMarkup(sessionId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[{ text: `${EMOJI.active} Refresh`, callback_data: `status:${sessionId}` }]] };
}

export function sessionRowLabel(title: string, running: boolean, occupancy: number, cost: number): string {
    const stateMark = running ? `${EMOJI.active} running` : `${EMOJI.soon} idle`;
    return `${title} · ${stateMark} · ${formatTokenShort(occupancy)} tok · $${cost.toFixed(3)}`;
}

export function sessionsCardText(rows: string[], count: number, plain: boolean): string {
    const header = `${icon('cache')} <b>Sessions</b> · ${count} ${plain ? 'available' : 'watched'}`;
    if (rows.length === 0) {
        return `${header}\n${plain ? 'No sessions are available yet.' : 'No sessions are watched yet.'}`;
    }
    return `${header}\n${rows.join('\n')}\n\nTap a row to ${plain ? 'switch the chat to that session' : 'pull its status card'}.\n`;
}

export function settingsCardText(rows: Array<{ label: string; display: string }>, where?: 'topic' | 'chat'): string {
    const lines = rows.map((row) => settingRow(row.label, row.display));
    const scope = where === 'topic'
        ? 'Values apply to this topic only; Whisper server/threads stay bot-wide.'
        : where === 'chat'
            ? 'Values apply to this chat only; Whisper server/threads stay bot-wide.'
            : 'Overrides survive restarts.';
    return `${icon('gears')} <b>Settings</b>\n${lines.join('\n')}\n\nTap a row to switch it. ${scope}\n`;
}

export function langsCardText(rows: Array<{ label: string; display: string }>, where?: 'topic' | 'chat'): string {
    const [bot, chat] = rows;
    const lines = [
        langSectionLine('bot', bot?.label ?? 'lang', bot?.display ?? '', 'top row'),
        langSectionLine('chat', chat?.label ?? 'chatLang', chat?.display ?? '', 'bottom row'),
    ];
    const scope = where === 'topic'
        ? 'Bot language applies to the whole bot; Chat language applies to this topic only.'
        : where === 'chat'
            ? 'Bot language applies to the whole bot; Chat language applies to this chat only.'
            : 'Bot language applies to the whole bot; Chat language is per topic or chat.';
    return `${icon('globe')} <b>Languages</b>\n\n${lines.join('\n')}\n\nPick a language in the matching row below. ${scope}\n`;
}

export function stopControlText(build: boolean): string {
    const mode = build ? 'Build' : 'Plan';
    return `${rocketIcon()} Running · ${mode} — tap Stop to interrupt and rewrite the task.`;
}

export function stopMarkup(sessionId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[
        { text: `${EMOJI.coffee} Stop`, callback_data: `stop:${sessionId}` },
    ]] };
}

export function subagentStopMarkup(sessionId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[
        { text: `${EMOJI.coffee} Stop`, callback_data: `substop:${sessionId}` },
    ]] };
}
