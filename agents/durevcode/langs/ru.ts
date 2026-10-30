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
    opencodeSourceDisplay,
    settingRow,
    shortUptime,
} from './index';

export * from './index';

export const AUTO_CONTINUE_TEXT = 'Продолжить';
export const DIGEST_PROMPT_PREFIX = 'Фоновая подзадача сабагента завершена.';
export const COULD_NOT_LOAD_MODELS = 'Не удалось загрузить модели, попробуйте ещё раз.';
export const NO_MODELS_AVAILABLE = 'Доступных моделей нет.';
export const QUEST_DONE = 'Готово';
export const NO_MODEL_YET = 'Модель ещё не выбрана — выберите из списка выше.';
export const OUTDATED_ASK_AGAIN = 'Устарело, спросите заново.';
export const EFFORT_NOT_OFFERED = 'Такой уровень усилий не предлагается этой моделью.';
export const ALREADY_SET = 'Уже установлено.';
export const MODEL_SWITCH_FAILED = 'Не удалось переключить модель, попробуйте ещё раз.';
export const MODE_PLAN_LABEL = 'План';
export const MODE_BUILD_LABEL = 'Билд';
export const SETTINGS_DEFAULTS_RESTORED = 'Настройки по умолчанию восстановлены.';
export const ADMIN_ONLY_MODES = 'Только админы форума могут менять режимы.';
export const ADMIN_ONLY_SESSION_CARDS = 'Только админы форума могут получать карточки сессий.';
export const ADMIN_ONLY_SETTINGS = 'Только админы форума могут менять настройки.';
export const ADMIN_ONLY_MODELS = 'Только админы форума могут менять модели.';
export const ACK_RATE_LIMITED = 'Лимит запросов, попробуйте чуть позже.';
export const ACK_ON_ITS_WAY = 'Принято, выполняю.';
export const ANSWER_ALL_QUESTIONS = 'Сначала ответьте на все вопросы.';
export const POLL_FINISH_BUTTON = '✅ Завершить голосование';
export const POLL_NO_VOTES = 'Опрос закрыт — голосов не было.';
export const POLL_AUTHOR_ONLY = 'Завершить голосование может только автор вопроса.';
export const THOUGHT_FULL_TEXT_BUTTON = '📄 Полный текст';
export const THOUGHT_DOC_FAILED = `${icon('fail')} Не удалось загрузить документ — публикую полный текст сообщениями.`;
export const PERMISSION_DECISION_LABELS: Record<PermissionDecision, string> = {
    always: 'Разрешить всегда',
    once: 'Разрешить один раз',
    reject: 'Запретить',
};
export const SUBAGENT_FINISHED = `${checkIcon()} Сабагент завершил задачу.`;
export const SUBAGENT_STOPPED = `${icon('stop')} Параллельная задача остановлена.`;
export const FANOUT_COPIED_ELSEWHERE =
    `${hourglassIcon()} Тот же вопрос уже выполняется в другом топике — скопирую ответ и сюда.`;
export const FANOUT_HOLD_TAGGED =
    `${hourglassIcon()} Тот же вопрос уже отвечается в этом топике — отмечу вас в общем ответе.`;
export const FANOUT_HOLD_QUIET =
    `${hourglassIcon()} Тот же вопрос уже отвечается в этом топике — общий ответ появится здесь.`;
export const PROMPT_BUSY = `${hourglassIcon()} Сессия занята, ваш запрос в очереди.`;
export const DRAIN_STALL_NOTICE =
    `${icon('fail')} Сервер принял запрос, но не обрабатывает его. ` +
    'Проверьте лог opencode serve на «Failed to drain Session».';
export const VOICE_OFF_NOTICE =
    `${icon('warn')} Расшифровка голосовых выключена (задайте DUREVCODE_WHISPER_ENABLED=1 и DUREVCODE_WHISPER_MODEL) — пока отправляйте текстом.`;
export const VOICE_TRANSCRIBING = `${hourglassIcon()} Расшифровываю голосовое...`;
export const VOICE_EMPTY = `${icon('fail')} Расшифровка голосового оказалась пустой.`;
export const VOICE_FAILED = `${icon('fail')} Не удалось расшифровать голосовое — отправьте текстом.`;
export const MEDIA_TOO_LARGE = `${icon('denied')} Медиа слишком большое (макс. 20 МБ), отправьте текстом.`;
export const FILE_DOWNLOAD_FAILED = `${icon('fail')} Не удалось скачать файл.`;
export const FILE_STORE_FAILED = `${icon('fail')} Не удалось сохранить файл.`;
export const FILE_TOO_LARGE = `${icon('denied')} Файл слишком большой, отправьте текстом.`;
export const ONLY_TEXT_FILES = `${icon('denied')} Принимаются только текстовые файлы.`;
export const CLI_SPAWN_FAILED = `${icon('fail')} Не удалось запустить CLI-процесс, повторю попытку.`;
export const CLI_FALLBACK_NOTICE = `${icon('warn')} Сервер не принял запрос, запускаю через CLI-fallback.`;
export const CONTINUE_NOTHING = `${icon('warn')} Продолжать пока нечего — сначала отправьте задачу.`;
export const CONTINUE_QUEUED = `${icon('rocket')} Предыдущая задача снова в очереди.`;
export const PERM_DECIDE_HINT = `${icon('warn')} Скажите да или нет — или нажмите кнопку.`;
export const PERMISSION_NEEDED_TITLE = `${icon('question')} Требуется разрешение`;
export const ALREADY_RESOLVED = `${icon('warn')} Уже обработано.`;
export const DECISION_SEND_FAILED = `${icon('fail')} Не удалось отправить решение, попробуйте ещё раз.`;
export const ANSWER_SEND_FAILED = `${icon('fail')} Не удалось отправить ответ, попробуйте ещё раз.`;
export const QUESTION_OUTDATED = `${icon('warn')} Эта карточка вопроса устарела — отвечайте на свежую.`;
export const QUESTION_FREE_TEXT_ONLY =
    `${icon('warn')} Нажмите вариант или «Готово» — свободный текст подходит только для одиночных вопросов.`;
export const MODE_NO_AGENT_CONTROL = `${icon('fail')} Не удалось сменить режим: управление агентом недоступно.`;
export const MODE_SWITCH_FAILED = `${icon('fail')} Не удалось сменить режим, попробуйте ещё раз.`;
export const MODE_SWITCH_GONE = `${icon('fail')} Не удалось сменить режим, сессия исчезла.`;
export const SETTINGS_RESET_ALL = `${EMOJI.gears} Сбросить всё`;
export const STOPPED_AGAIN = `${icon('stop')} Остановлено, отправьте задачу заново.`;
export const TOPIC_RESTORE_FAILED = `${icon('fail')} Не удалось восстановить сессию для этого топика, попробуйте ещё раз.`;
export const TOPIC_SESSION_CREATE_FAILED = `${icon('fail')} Не удалось создать сессию для этого топика, попробуйте ещё раз.`;
export const ADMIN_GATE_GENERIC = `${icon('denied')} Менять это могут только админы форума.`;
export const SETTINGS_LABELS: Record<string, string> = {
    lang: 'Язык бота',
    chatLang: 'Язык чата',
    watchOnly: 'Только просмотр',
    leadMention: 'Упоминание автора',
    quoteReplies: 'Цитаты ответов',
    autoFinish: 'Уведомления о завершении',
    answerFanout: 'Общие ответы',
    subagentUsers: 'Пользователи сабагентов',
    newTopics: 'Новые топики',
    voice: 'Расшифровка голосовых',
    voiceLang: 'Язык голосовых',
    voiceServer: 'Резидентный whisper-сервер',
    voiceThreads: 'Потоки Whisper',
    twoColumns: 'Две колонки',
};


export function shortAgo(now: number, at: number): string {
    if (at === 0) return 'никогда';
    const sec = Math.max(1, Math.round((now - at) / 1000));
    if (sec < 60) return `${sec} с назад`;
    if (sec < 3600) return `${Math.round(sec / 60)} мин назад`;
    if (sec < 172800) return `${Math.round(sec / 3600)} ч назад`;
    return `${Math.round(sec / 86400)} д назад`;
}

export function subagentDigestNote(task: string, lastText: string): string {
    return (
        `${DIGEST_PROMPT_PREFIX} Задача: ${task.slice(0, 120)}. ` +
        `Кратко о результате: ${(lastText || '(нет текста)').slice(0, 400)}. ` +
        'Отметьте этот результат в контексте сессии. Ничего не отвечайте.'
    );
}

export function subagentDispatched(parallel: number): string {
    const tail = parallel > 1 ? ` Параллельно идут ещё ${parallel} задач.` : '';
    return `${icon('bot')} Задача ушла параллельному сабагенту — ответ появится здесь.${tail}`;
}

export function switchedTo(title: string, tag: string): string {
    return `${checkIcon()} Переключено на <b>${escapeHtml(title)}</b> · ${escapeHtml(tag)}`;
}

export function rateLimitedRetry(waitSec: number | string): string {
    return `${hourglassIcon()} Лимит запросов, повтор примерно через ${waitSec} с — ваш запрос остаётся в очереди.`;
}

export function promptFailed(errText: string): string {
    return `${icon('fail')} Запрос не удался: ${errText}`;
}

export function opencodeRetry(errText: string): string {
    return `${icon('warn')} Ошибка opencode: ${escapeHtml(errText)} — повторяю, ваш запрос остаётся в очереди.`;
}

export function turnStoppedByServer(reason: string): string {
    return `${icon('warn')} opencode остановил ход: ${escapeHtml(reason)}\n\nНапишите снова, чтобы продолжить.`;
}

export function opencodeModelError(text: string): string {
    return `${icon('warn')} Ошибка opencode: ${escapeHtml(text)}`;
}

export function explainModelError(text: string): string {
    const raw = text.trim();
    const has = (pattern: RegExp): boolean => pattern.test(raw);
    if (has(/FreeTierError|free tier can only be used/i)) {
        return 'провайдер не принимает модели бесплатного тарифа для запросов вне клиента OpenCode. '
            + 'Агент управляет локальным сервером opencode, поэтому такие модели отвечают здесь ошибкой HTTP 403. '
            + 'Выберите модель со своим API-ключом или запустите задачу из приложения OpenCode, где free tier разрешён.';
    }
    if (has(/VariantUnavailableError|Variant unavailable/i)) {
        return 'сессия закреплена за вариантом модели, которого у модели нет, поэтому ход не может начаться. '
            + 'Переключите модель в топике, если это повторяется.';
    }
    if (has(/429|rate.?limit|too many requests/i)) {
        return 'провайдер ограничивает частоту запросов к этой модели. Задача сохранена; напишите снова через минуту.';
    }
    if (has(/401|unauthor|forbidden|api key/i)) {
        return 'провайдер отклонил учётные данные этой модели. Исправьте API-ключ модели сессии.';
    }
    if (has(/context length|context_length|maximum context|too many tokens/i)) {
        return 'запрос больше не помещается в контекстное окно модели. Начните для этого топика новую сессию.';
    }
    if (has(/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|network/i)) {
        return 'не удалось связаться с эндпоинтом провайдера. Проверьте сеть и сервер opencode.';
    }
    if (!raw) return 'opencode не сообщил причину остановки хода.';
    return 'вызов модели не удался по неясной причине.';
}

export function modelErrorNotice(text: string): string {
    const raw = text.trim();
    const explanation = explainModelError(raw);
    if (!raw) return explanation;
    return `${explanation}\n\nopencode сказал: ${truncate(raw, 400)}`;
}

export function mediaUnparsed(label: string): string {
    return `${icon('warn')} ${label} пока не разобрать — отправьте фото, видео, документ или текст.`;
}

export function cliFailed(code: number): string {
    return `${icon('fail')} CLI-процесс завершился с ошибкой (код ${code}).`;
}

export function permissionDecisionText(decision: PermissionDecision): string {
    if (decision === 'reject') return `${icon('denied')} Запрещено.`;
    return `${checkIcon()} ${decision === 'always' ? 'Разрешено всегда.' : 'Разрешено один раз.'}`;
}

export function questDoneLabel(answered: number, total: number): string {
    return `Готово ${answered}/${total}`;
}

export function modelSwitched(id: string): string {
    return `${icon('check')} Модель переключена на <b>${escapeHtml(id)}</b>.`;
}

export function effortSet(variant: string, modelId: string): string {
    return `Усилие: <b>${escapeHtml(variant)}</b> для <b>${escapeHtml(modelId)}</b>.`;
}

export function modeSwitched(build: boolean, agentId: string): string {
    return (
        `Режим: <b>${build ? MODE_BUILD_LABEL : MODE_PLAN_LABEL}</b> — модель теперь работает как <b>${escapeHtml(agentId)}</b> и ` +
        `${build ? 'может редактировать файлы' : 'ничего не редактирует'}.`
    );
}

export function settingOnOff(on: boolean): string {
    return on ? 'вкл' : 'выкл';
}

export function settingsLabel(key: string): string {
    return SETTINGS_LABELS[key] ?? key;
}

export function watchOnlyToggleLabel(plain: boolean): string {
    return `Только просмотр · ${settingOnOff(plain)}`;
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
        `Режим: <b>${input.build ? MODE_BUILD_LABEL : MODE_PLAN_LABEL}</b>` +
        `${current}` +
        ' — нажмите, чтобы переключить.\n' +
        `<b>${MODE_BUILD_LABEL}</b> — модель может редактировать файлы.\n` +
        `<b>${MODE_PLAN_LABEL}</b> — модель только читает и отвечает, без правок.\n` +
        (input.plain
            ? '«Только просмотр» включён — текстовые запросы игнорируются; нажмите нижний ряд, чтобы вернуть ввод.'
            : '«Только просмотр» выключен — нижний ряд превращает бота в наблюдателя, который ничего не отправляет.')
    );
}

export function modelCardText(currentId: string, currentVariant: string, models?: ModelApiInfo[]): string {
    const current = (models ?? []).find((m) => m.id === currentId);
    const context = formatModelContext(current?.limit);
    const caps = current ? describeModelCapabilities(current) : [];
    const lines = [`Модель: <b>${escapeHtml(currentId || 'по умолчанию')}</b> — нажмите, чтобы переключить.`];
    if (current) {
        lines.push(`Контекст: <b>${escapeHtml(context || '—')}</b>${caps.length > 0 ? ` | ${escapeHtml(caps.join(', '))}` : ''}`);
    }
    const variants = current ? modelVariantIds(current) : [];
    lines.push(
        `Усилие: <b>${escapeHtml(currentVariant || 'по умолчанию')}</b>` +
            (variants.length > 0 ? ` — варианты: ${escapeHtml(variants.join(', '))}` : ' — вариантов нет.'),
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
        contextLine = `${icon('inbox')} Контекст <b>${occupancyText}${limitText ? `/${limitText} (${percent}%)` : ''}</b>`;
    } else {
        contextLine = `${icon('inbox')} Контекст <b>—</b>${limitText ? ` · окно ${limitText} (токенов хода ещё нет)` : ''}`;
    }
    const whisper = input.whisper;
    const whisperLine = whisper?.enabled === true
        ? whisper.autoServe === false
            ? 'CLI-транскрибатор'
            : `резидентный сервер ${whisper.serverUrl ?? ''}`
        : 'выкл';
    const lines = [
        `${icon('gears')} <b>Статус</b> · ${escapeHtml(input.title)} · <code>${escapeHtml(input.sessionTag)}</code>`,
        `${icon('bot')} OpenCode ${escapeHtml(opencodeSourceDisplay(input.opencodeBaseUrl))}`,
        `${icon('brain')} Модель <b>${escapeHtml(input.modelRefText)}</b>${input.variantText ? ` (${escapeHtml(input.variantText)})` : ''} · ${input.buildMode ? MODE_BUILD_LABEL : MODE_PLAN_LABEL} · ${escapeHtml(input.sessionAgent)}`,
        contextLine,
        `${icon('active')} ${input.turnComplete ? 'Ожидание' : 'Работа'} · последнее событие ${shortAgo(input.now, input.lastEventAt)} · аптайм ${shortUptime(input.now - input.bootAt)}`,
    ];
    if (input.promptQueueLength > 0) lines.push(`${icon('queued')} Очередь: ${input.promptQueueLength}`);
    if (input.cost > 0) lines.push(`${icon('coin')} $${input.cost.toFixed(2)}`);
    if (input.now < input.rateLimitedUntil) {
        lines.push(`${icon('hourglass')} Лимит запросов до ${new Date(input.rateLimitedUntil).toLocaleTimeString('ru-RU')}`);
    }
    lines.push(`${icon('toolbox')} Whisper: ${whisperLine} (${whisper?.threads ?? 0} потоков, ${whisper?.language ?? 'авто'})`);
    if (input.voice) {
        lines.push(`${icon('timer')} Последнее голосовое ${input.voice.audioSec.toFixed(0)} с → ${(input.voice.processingMs / 1000).toFixed(1)} с (${shortAgo(input.now, input.voice.at)})`);
    }
    return `${lines.join('\n')}\n`;
}

export function statusCardMarkup(sessionId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[{ text: `${EMOJI.active} Обновить`, callback_data: `status:${sessionId}` }]] };
}

export function sessionRowLabel(title: string, running: boolean, occupancy: number, cost: number): string {
    const stateMark = running ? `${EMOJI.active} работает` : `${EMOJI.soon} ожидание`;
    return `${title} · ${stateMark} · ${formatTokenShort(occupancy)} ток · $${cost.toFixed(3)}`;
}

export function sessionsCardText(rows: string[], count: number, plain: boolean): string {
    const header = `${icon('cache')} <b>Сессии</b> · ${count} ${plain ? 'доступно' : 'под наблюдением'}`;
    if (rows.length === 0) {
        return `${header}\n${plain ? 'Доступных сессий пока нет.' : 'Отслеживаемых сессий пока нет.'}`;
    }
    return `${header}\n${rows.join('\n')}\n\nНажмите на строку, чтобы ${plain ? 'переключить чат на эту сессию' : 'открыть её карточку статуса'}.\n`;
}

export function settingsCardText(rows: Array<{ label: string; display: string }>, where?: 'topic' | 'chat'): string {
    const lines = rows.map((row) => settingRow(row.label, row.display));
    const scope = where === 'topic'
        ? 'Значения действуют только в этом топике; Язык бота, Whisper-сервер/потоки — на весь бот.'
        : where === 'chat'
            ? 'Значения действуют только в этом чате; Язык бота, Whisper-сервер/потоки — на весь бот.'
            : 'Переопределения переживают рестарты.';
    return `${icon('gears')} <b>Настройки</b>\n${lines.join('\n')}\n\nНажмите на строку, чтобы переключить. ${scope}\n`;
}

export function stopControlText(build: boolean): string {
    const mode = build ? MODE_BUILD_LABEL : MODE_PLAN_LABEL;
    return `${rocketIcon()} Работаю · ${mode} — нажмите «Стоп», чтобы прервать и переписать задачу.`;
}

export function stopMarkup(sessionId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[
        { text: `${EMOJI.coffee} Стоп`, callback_data: `stop:${sessionId}` },
    ]] };
}
