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
import {
    StatusCardInput,
    formatTokenShort,
    langSectionLine,
    opencodeSourceDisplay,
    settingRow,
    shortUptime,
} from './index';

export * from './index';

export const AUTO_CONTINUE_TEXT = '继续';
export const DIGEST_PROMPT_PREFIX = '后台子代理任务已完成。';
export const COULD_NOT_LOAD_MODELS = '无法加载模型，请重试。';
export const NO_MODELS_AVAILABLE = '暂无可用模型。';
export const QUEST_DONE = '完成';
export const NO_MODEL_YET = '尚未选择模型 — 请从上方列表中选择。';
export const OUTDATED_ASK_AGAIN = '已过期，请重新提问。';
export const EFFORT_NOT_OFFERED = '该模型不提供此推理力度选项。';
export const ALREADY_SET = '已设置。';
export const MODEL_SWITCH_FAILED = '无法切换模型，请重试。';
export const MODE_PLAN_LABEL = '计划';
export const MODE_BUILD_LABEL = '构建';
export const SETTINGS_DEFAULTS_RESTORED = '已恢复默认设置。';
export const ADMIN_ONLY_MODES = '只有论坛管理员可以更改模式。';
export const ADMIN_ONLY_SESSION_CARDS = '只有论坛管理员可以调取会话卡片。';
export const ADMIN_ONLY_SETTINGS = '只有论坛管理员可以更改设置。';
export const ADMIN_ONLY_MODELS = '只有论坛管理员可以更改模型。';
export const ACK_RATE_LIMITED = '请求受限，请稍后再试。';
export const ACK_ON_ITS_WAY = '已收到，马上处理。';
export const ANSWER_ALL_QUESTIONS = '请先回答所有问题。';
export const POLL_FINISH_BUTTON = '✅ 结束投票';
export const POLL_NO_VOTES = '投票已关闭 — 没有收到任何投票。';
export const POLL_AUTHOR_ONLY = '只有提问的作者才能结束此投票。';
export const THOUGHT_FULL_TEXT_BUTTON = '📄 完整文本';
export const THOUGHT_DOC_FAILED = `${icon('fail')} 文档上传失败 — 改用消息发布完整文本。`;
export const PERMISSION_DECISION_LABELS: Record<PermissionDecision, string> = {
    always: '始终允许',
    once: '允许一次',
    reject: '拒绝',
};
export const SUBAGENT_FINISHED = `${checkIcon()} 子代理已完成任务。`;
export const SUBAGENT_STOPPED = `${icon('stop')} 并行任务已停止。`;
export const FANOUT_COPIED_ELSEWHERE =
    `${hourglassIcon()} 同样的问题已在另一个主题中运行 — 我也会把答案复制到这里。`;
export const FANOUT_HOLD_TAGGED =
    `${hourglassIcon()} 同样的问题正在本主题中回答 — 我会在共享答案中提及你。`;
export const FANOUT_HOLD_QUIET =
    `${hourglassIcon()} 同样的问题正在本主题中回答 — 共享答案会显示在这里。`;
export const PROMPT_BUSY = `${hourglassIcon()} 会话正忙，你的请求已排队。`;
export const DRAIN_STALL_NOTICE =
    `${icon('fail')} 服务器已接受请求，但没有处理它。 ` +
    '请检查 opencode serve 日志中的“Failed to drain Session”。';
export const VOICE_OFF_NOTICE =
    `${icon('warn')} 语音转写已关闭（请设置 DUREVCODE_WHISPER_ENABLED=1 和 DUREVCODE_WHISPER_MODEL） — 暂时请发送文本。`;
export const VOICE_TRANSCRIBING = `${hourglassIcon()} 正在转写语音...`;
export const VOICE_EMPTY = `${icon('fail')} 语音转写结果为空。`;
export const VOICE_FAILED = `${icon('fail')} 语音转写失败 — 请以文本形式发送。`;
export const MEDIA_TOO_LARGE = `${icon('denied')} 媒体文件过大（最大 20 MB），请以文本形式发送。`;
export const FILE_DOWNLOAD_FAILED = `${icon('fail')} 无法下载文件。`;
export const FILE_STORE_FAILED = `${icon('fail')} 无法保存文件。`;
export const FILE_TOO_LARGE = `${icon('denied')} 文件过大，请以文本形式发送。`;
export const ONLY_TEXT_FILES = `${icon('denied')} 仅接受文本文件。`;
export const CLI_SPAWN_FAILED = `${icon('fail')} CLI 进程启动失败，将重试。`;
export const CLI_FALLBACK_NOTICE = `${icon('warn')} 服务器未接受该请求，改用 CLI 回退方式运行。`;
export const CONTINUE_NOTHING = `${icon('warn')} 暂无可继续的内容 — 请先发送任务。`;
export const CONTINUE_QUEUED = `${icon('rocket')} 上一个任务已重新排队。`;
export const PERM_DECIDE_HINT = `${icon('warn')} 请回复同意或拒绝 — 或点击按钮。`;
export const PERMISSION_NEEDED_TITLE = `${icon('question')} 需要授权`;
export const ALREADY_RESOLVED = `${icon('warn')} 已经处理过了。`;
export const DECISION_SEND_FAILED = `${icon('fail')} 无法发送决定，请重试。`;
export const ANSWER_SEND_FAILED = `${icon('fail')} 无法发送答案，请重试。`;
export const QUESTION_OUTDATED = `${icon('warn')} 该问题卡片已过期 — 请在最新的卡片上回答。`;
export const QUESTION_FREE_TEXT_ONLY =
    `${icon('warn')} 请点击选项或“完成” — 只有单选问题才支持自由文本。`;
export const MODE_NO_AGENT_CONTROL = `${icon('fail')} 无法切换模式：代理控制不可用。`;
export const MODE_SWITCH_FAILED = `${icon('fail')} 无法切换模式，请重试。`;
export const MODE_SWITCH_GONE = `${icon('fail')} 无法切换模式，会话已消失。`;
export const SETTINGS_RESET_ALL = `${EMOJI.gears} 全部重置`;
export const STOPPED_AGAIN = `${icon('stop')} 已停止，请重新发送任务。`;
export const TOPIC_RESTORE_FAILED = `${icon('fail')} 无法为该主题恢复会话，请重试。`;
export const TOPIC_SESSION_CREATE_FAILED = `${icon('fail')} 无法为该主题创建会话，请重试。`;
export const ADMIN_GATE_GENERIC = `${icon('denied')} 只有论坛管理员可以更改此项。`;
export const THINKING_LABEL = '思考中';
export const THOUGHT_LABEL = '思考';
export const CHARS_LABEL = '字符';
export const PLAN_LABEL = '计划';
export const CMD_DESC_STOP = '中断当前回合';
export const CMD_DESC_STATUS = '显示状态卡片';
export const CMD_DESC_MODE = '运行模式与仅观察';
export const CMD_DESC_MODELS = '列出或切换模型';
export const CMD_DESC_SETTINGS = '实时设置卡片';
export const CMD_DESC_LANGS = '语言设置（也可用 /lang）';
export const CMD_DESC_SESSIONS = '已监视会话列表';
export const CMD_DESC_HELP = '机器人的功能';

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
        `/sessions — ${CMD_DESC_SESSIONS}`,
        `/help — ${CMD_DESC_HELP}`,
        '',
        '其余输入都会作为提示词发送给代理。回复消息可保留引用，@用户名可指定答复对象。',
    ].join('\n');
}

export function promptLangDirective(): string {
    return '无论用户使用什么语言，请始终用中文思考和回答。';
}
export const SETTINGS_LABELS: Record<string, string> = {
    lang: '机器人语言',
    chatLang: '聊天语言',
    watchOnly: '只读模式',
    leadMention: '@提及作者',
    quoteReplies: '回复引用',
    autoFinish: '完成通知',
    answerFanout: '共享答案',
    subagentUsers: '子代理用户',
    newTopics: '新主题',
    voice: '语音转写',
    voiceLang: '语音识别语言',
    voiceServer: '常驻 Whisper 服务器',
    voiceThreads: 'Whisper 线程数',
    twoColumns: '双列按钮',
};

export function shortAgo(now: number, at: number): string {
    if (at === 0) return '从未';
    const sec = Math.max(1, Math.round((now - at) / 1000));
    if (sec < 60) return `${sec} 秒前`;
    if (sec < 3600) return `${Math.round(sec / 60)} 分钟前`;
    if (sec < 172800) return `${Math.round(sec / 3600)} 小时前`;
    return `${Math.round(sec / 86400)} 天前`;
}

export function subagentDigestNote(task: string, lastText: string): string {
    return (
        `${DIGEST_PROMPT_PREFIX} 任务：${task.slice(0, 120)}。 ` +
        `结果摘要：${(lastText || '（无文本）').slice(0, 400)}。 ` +
        '请在会话上下文中记录此结果。请勿回复任何内容。'
    );
}

export function subagentDispatched(parallel: number): string {
    const tail = parallel > 1 ? ` ${parallel} 个任务正在并行运行。` : '';
    return `${icon('bot')} 任务已交给并行子代理 — 答案将显示在这里。${tail}`;
}

export function switchedTo(title: string, tag: string): string {
    return `${checkIcon()} 已切换到 <b>${escapeHtml(title)}</b> · ${escapeHtml(tag)}`;
}

export function rateLimitedRetry(waitSec: number | string): string {
    return `${hourglassIcon()} 请求受限，约 ${waitSec} 秒后重试 — 你的请求仍在队列中。`;
}

export function promptFailed(errText: string): string {
    return `${icon('fail')} 请求失败：${errText}`;
}

export function opencodeRetry(errText: string): string {
    return `${icon('warn')} opencode 错误：${escapeHtml(errText)} — 正在重试，你的请求仍在队列中。`;
}

export function turnStoppedByServer(reason: string): string {
    return `${icon('warn')} opencode 停止了本轮：${escapeHtml(reason)}\n\n请再次输入以继续。`;
}

export function opencodeModelError(text: string): string {
    return `${icon('warn')} opencode 错误：${escapeHtml(text)}`;
}

export function explainModelError(text: string): string {
    const raw = text.trim();
    const has = (pattern: RegExp): boolean => pattern.test(raw);
    if (has(/FreeTierError|free tier can only be used/i)) {
        return '提供商不接受来自 OpenCode 客户端之外的请求使用免费套餐模型。 '
            + '代理运行的是本地 opencode 服务器，因此这些模型在这里返回 HTTP 403。 '
            + '请选择使用自己 API 密钥的模型，或在允许免费套餐的 OpenCode 应用中运行任务。';
    }
    if (has(/VariantUnavailableError|Variant unavailable/i)) {
        return '会话绑定的模型变体该模型并不提供，因此本轮无法开始。 '
            + '如果重复出现，请在主题中切换模型。';
    }
    if (has(/429|rate.?limit|too many requests/i)) {
        return '提供商正在限制该模型的请求频率。任务已保留；请稍后再发。';
    }
    if (has(/401|unauthor|forbidden|api key/i)) {
        return '提供商拒绝了该模型的凭据。请修复会话模型的 API 密钥。';
    }
    if (has(/context length|context_length|maximum context|too many tokens/i)) {
        return '请求已超出模型的上下文窗口。请为该主题开启新会话。';
    }
    if (has(/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|network/i)) {
        return '无法连接到提供商端点。请检查网络和 opencode 服务器。';
    }
    if (!raw) return 'opencode 未报告本轮停止的原因。';
    return '模型调用因不明原因失败。';
}

export function modelErrorNotice(text: string): string {
    const raw = text.trim();
    const explanation = explainModelError(raw);
    if (!raw) return explanation;
    return `${explanation}\n\nopencode 的回复：${truncate(raw, 400)}`;
}

export function mediaUnparsed(label: string): string {
    return `${icon('warn')} 暂时无法解析${label} — 请发送照片、视频、文档或文本。`;
}

export function cliFailed(code: number): string {
    return `${icon('fail')} CLI 进程运行失败（退出码 ${code}）。`;
}

export function permissionDecisionText(decision: PermissionDecision): string {
    if (decision === 'reject') return `${icon('denied')} 已拒绝。`;
    return `${checkIcon()} ${decision === 'always' ? '已始终允许。' : '已允许一次。'}`;
}

export function questDoneLabel(answered: number, total: number): string {
    return `已完成 ${answered}/${total}`;
}

export function modelSwitched(id: string): string {
    return `${icon('check')} 模型已切换为 <b>${escapeHtml(id)}</b>。`;
}

export function effortSet(variant: string, modelId: string): string {
    return `推理力度：<b>${escapeHtml(variant)}</b>（模型 <b>${escapeHtml(modelId)}</b>）。`;
}

export function modeSwitched(build: boolean, agentId: string): string {
    return (
        `模式：<b>${build ? MODE_BUILD_LABEL : MODE_PLAN_LABEL}</b> — 模型现在以 <b>${escapeHtml(agentId)}</b> 运行，` +
        `${build ? '可以编辑文件' : '不会编辑任何内容'}。`
    );
}

export function settingOnOff(on: boolean): string {
    return on ? '开' : '关';
}

export function settingsLabel(key: string): string {
    return SETTINGS_LABELS[key] ?? key;
}

export function watchOnlyToggleLabel(plain: boolean): string {
    return `只读模式 · ${settingOnOff(plain)}`;
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
        `模式：<b>${input.build ? MODE_BUILD_LABEL : MODE_PLAN_LABEL}</b>` +
        `${current}` +
        ' — 点击切换。\n' +
        `<b>${MODE_BUILD_LABEL}</b> — 模型可以编辑文件。\n` +
        `<b>${MODE_PLAN_LABEL}</b> — 模型只读取并回答，不做修改。\n` +
        (input.plain
            ? '“只读模式”已开启 — 文本请求会被忽略；点击底部一行恢复输入。'
            : '“只读模式”已关闭 — 底部一行可让机器人变成只旁观的观众，不提交任何内容。')
    );
}

export function modelCardText(currentId: string, currentVariant: string, models?: ModelApiInfo[]): string {
    const current = (models ?? []).find((m) => m.id === currentId);
    const context = formatModelContext(current?.limit);
    const caps = current ? describeModelCapabilities(current) : [];
    const lines = [`模型：<b>${escapeHtml(currentId || '默认')}</b> — 点击切换。`];
    if (current) {
        lines.push(`上下文：<b>${escapeHtml(context || '—')}</b>${caps.length > 0 ? ` | ${escapeHtml(caps.join('、'))}` : ''}`);
    }
    const variants = current ? modelVariantIds(current) : [];
    lines.push(
        `推理力度：<b>${escapeHtml(currentVariant || '默认')}</b>` +
            (variants.length > 0 ? ` — 选项：${escapeHtml(variants.join('、'))}` : ' — 没有变体。'),
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
        contextLine = `${icon('inbox')} 上下文 <b>${occupancyText}${limitText ? `/${limitText} (${percent}%)` : ''}</b>`;
    } else {
        contextLine = `${icon('inbox')} 上下文 <b>—</b>${limitText ? ` · 窗口 ${limitText}（本轮还没有 token）` : ''}`;
    }
    const whisper = input.whisper;
    const whisperLine = whisper?.enabled === true
        ? whisper.autoServe === false
            ? 'CLI 转写器'
            : `常驻服务器 ${whisper.serverUrl ?? ''}`
        : '关闭';
    const lines = [
        `${icon('gears')} <b>状态</b> · ${escapeHtml(input.title)} · <code>${escapeHtml(input.sessionTag)}</code>`,
        `${icon('bot')} OpenCode ${escapeHtml(opencodeSourceDisplay(input.opencodeBaseUrl))}`,
        `${icon('brain')} 模型 <b>${escapeHtml(input.modelRefText)}</b>${input.variantText ? ` (${escapeHtml(input.variantText)})` : ''} · ${input.buildMode ? MODE_BUILD_LABEL : MODE_PLAN_LABEL} · ${escapeHtml(input.sessionAgent)}`,
        contextLine,
        `${icon('active')} ${input.turnComplete ? '空闲' : '运行中'} · 最后事件 ${shortAgo(input.now, input.lastEventAt)} · 已运行 ${shortUptime(input.now - input.bootAt)}`,
    ];
    if (input.promptQueueLength > 0) lines.push(`${icon('queued')} 队列：${input.promptQueueLength}`);
    if (input.cost > 0) lines.push(`${icon('coin')} $${input.cost.toFixed(2)}`);
    if (input.now < input.rateLimitedUntil) {
        lines.push(`${icon('hourglass')} 请求受限至 ${new Date(input.rateLimitedUntil).toLocaleTimeString('zh-CN')}`);
    }
    lines.push(`${icon('toolbox')} Whisper：${whisperLine}（${whisper?.threads ?? 0} 线程，${whisper?.language ?? '自动'}）`);
    if (input.voice) {
        lines.push(`${icon('timer')} 上次语音 ${input.voice.audioSec.toFixed(0)} 秒 → ${(input.voice.processingMs / 1000).toFixed(1)} 秒（${shortAgo(input.now, input.voice.at)}）`);
    }
    return `${lines.join('\n')}\n`;
}

export function statusCardMarkup(sessionId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[{ text: `${EMOJI.active} 刷新`, callback_data: `status:${sessionId}` }]] };
}

export function sessionRowLabel(title: string, running: boolean, occupancy: number, cost: number): string {
    const stateMark = running ? `${EMOJI.active} 运行中` : `${EMOJI.soon} 空闲`;
    return `${title} · ${stateMark} · ${formatTokenShort(occupancy)} tok · $${cost.toFixed(3)}`;
}

export function sessionsCardText(rows: string[], count: number, plain: boolean): string {
    const header = `${icon('cache')} <b>会话</b> · ${count} ${plain ? '个可用' : '个受监视'}`;
    if (rows.length === 0) {
        return `${header}\n${plain ? '暂无可用会话。' : '暂无受监视的会话。'}`;
    }
    return `${header}\n${rows.join('\n')}\n\n点击一行以${plain ? '将聊天切换到该会话' : '打开它的状态卡片'}。\n`;
}

export function settingsCardText(rows: Array<{ label: string; display: string }>, where?: 'topic' | 'chat'): string {
    const lines = rows.map((row) => settingRow(row.label, row.display));
    const scope = where === 'topic'
        ? '这些设置仅适用于本主题；Whisper 服务器/线程数对整个机器人生效。'
        : where === 'chat'
            ? '这些设置仅适用于本聊天；Whisper 服务器/线程数对整个机器人生效。'
            : '设置会在重启后保留。';
    return `${icon('gears')} <b>设置</b>\n${lines.join('\n')}\n\n点击一行进行切换。${scope}\n`;
}

export function langsCardText(rows: Array<{ label: string; display: string }>, where?: 'topic' | 'chat'): string {
    const [bot, chat] = rows;
    const lines = [
        langSectionLine('bot', bot?.label ?? 'lang', bot?.display ?? '', '第一行按钮'),
        langSectionLine('chat', chat?.label ?? 'chatLang', chat?.display ?? '', '第二行按钮'),
    ];
    const scope = where === 'topic'
        ? '机器人语言对整个机器人生效；聊天语言仅适用于本主题。'
        : where === 'chat'
            ? '机器人语言对整个机器人生效；聊天语言仅适用于本聊天。'
            : '机器人语言对整个机器人生效；聊天语言按主题或聊天各自生效。';
    return `${icon('globe')} <b>语言</b>\n\n${lines.join('\n')}\n\n请在下方对应的行中选择语言。${scope}\n`;
}

export function stopControlText(build: boolean): string {
    const mode = build ? MODE_BUILD_LABEL : MODE_PLAN_LABEL;
    return `${rocketIcon()} 运行中 · ${mode} — 点击“停止”可中断并重写任务。`;
}

export function stopMarkup(sessionId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[
        { text: `${EMOJI.coffee} 停止`, callback_data: `stop:${sessionId}` },
    ]] };
}
