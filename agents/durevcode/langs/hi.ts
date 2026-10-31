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

export const AUTO_CONTINUE_TEXT = 'जारी रखें';
export const DIGEST_PROMPT_PREFIX = 'बैकग्राउंड सबएजेंट कार्य पूरा हुआ।';
export const COULD_NOT_LOAD_MODELS = 'मॉडल लोड नहीं हो सके, फिर से कोशिश करें।';
export const NO_MODELS_AVAILABLE = 'कोई मॉडल उपलब्ध नहीं है।';
export const QUEST_DONE = 'पूर्ण';
export const NO_MODEL_YET = 'अभी कोई मॉडल नहीं चुना गया — ऊपर की सूची से चुनें।';
export const OUTDATED_ASK_AGAIN = 'पुराना हो गया, फिर से पूछें।';
export const EFFORT_NOT_OFFERED = 'यह प्रयास स्तर इस मॉडल के लिए पेश नहीं किया जाता।';
export const ALREADY_SET = 'पहले से सेट है।';
export const MODEL_SWITCH_FAILED = 'मॉडल बदला नहीं जा सका, फिर कोशिश करें।';
export const MODE_PLAN_LABEL = 'योजना';
export const MODE_BUILD_LABEL = 'बिल्ड';
export const SETTINGS_DEFAULTS_RESTORED = 'डिफ़ॉल्ट पुनर्स्थापित किए गए।';
export const ADMIN_ONLY_MODES = 'केवल फोरम एडमिन ही मोड बदल सकते हैं।';
export const ADMIN_ONLY_SESSION_CARDS = 'केवल फोरम एडमिन ही सेशन कार्ड खोल सकते हैं।';
export const ADMIN_ONLY_SETTINGS = 'केवल फोरम एडमिन ही सेटिंग्स बदल सकते हैं।';
export const ADMIN_ONLY_MODELS = 'केवल फोरम एडमिन ही मॉडल बदल सकते हैं।';
export const ACK_RATE_LIMITED = 'रेट लिमिट लगी है, थोड़ी देर में फिर कोशिश करें।';
export const ACK_ON_ITS_WAY = 'आ रहा है।';
export const ANSWER_ALL_QUESTIONS = 'पहले सभी प्रश्नों के उत्तर दें।';
export const POLL_FINISH_BUTTON = '✅ वोट समाप्त करें';
export const POLL_NO_VOTES = 'पोल बंद — कोई वोट नहीं डाला गया।';
export const POLL_AUTHOR_ONLY = 'केवल प्रश्न का लेखक ही यह वोट समाप्त कर सकता है।';
export const THOUGHT_FULL_TEXT_BUTTON = '📄 पूरा टेक्स्ट';
export const THOUGHT_DOC_FAILED = `${icon('fail')} दस्तावेज़ अपलोड असफल — पूरा टेक्स्ट संदेशों के रूप में पोस्ट किया जा रहा है।`;
export const PERMISSION_DECISION_LABELS: Record<PermissionDecision, string> = {
    always: 'हमेशा अनुमति दें',
    once: 'एक बार अनुमति दें',
    reject: 'अस्वीकृत',
};
export const SUBAGENT_FINISHED = `${checkIcon()} सबएजेंट ने कार्य पूरा किया।`;
export const SUBAGENT_STOPPED = `${icon('stop')} समानांतर कार्य रुक गया।`;
export const FANOUT_COPIED_ELSEWHERE =
    `${hourglassIcon()} वही प्रश्न किसी अन्य टॉपिक में पहले से चल रहा है — उत्तर यहाँ भी कॉपी करूँगा।`;
export const FANOUT_HOLD_TAGGED =
    `${hourglassIcon()} वही प्रश्न इसी टॉपिक में उत्तरित हो रहा है — साझा उत्तर में आपको मेंशन करूँगा।`;
export const FANOUT_HOLD_QUIET =
    `${hourglassIcon()} वही प्रश्न इसी टॉपिक में उत्तरित हो रहा है — साझा उत्तर यहाँ दिखेगा।`;
export const PROMPT_BUSY = `${hourglassIcon()} सेशन व्यस्त है, आपका प्रॉम्प्ट कतार में लग गया।`;
export const DRAIN_STALL_NOTICE =
    `${icon('fail')} सर्वर ने प्रॉम्प्ट लिया लेकिन उसे प्रोसेस नहीं कर रहा है। ` +
    'opencode serve लॉग में "Failed to drain Session" देखें।';
export const VOICE_OFF_NOTICE =
    `${icon('warn')} वॉइस ट्रांसक्रिप्शन बंद है (DUREVCODE_WHISPER_ENABLED=1 और DUREVCODE_WHISPER_MODEL सेट करें) — तब तक टेक्स्ट भेजें।`;
export const VOICE_TRANSCRIBING = `${hourglassIcon()} आवाज़ का ट्रांसक्रिप्शन हो रहा है...`;
export const VOICE_EMPTY = `${icon('fail')} वॉइस ट्रांसक्रिप्शन खाली आया।`;
export const VOICE_FAILED = `${icon('fail')} वॉइस ट्रांसक्रिप्शन असफल — इसे टेक्स्ट में भेजें।`;
export const MEDIA_TOO_LARGE = `${icon('denied')} मीडिया बहुत बड़ा है (अधिकतम 20 MB), इसे टेक्स्ट में भेजें।`;
export const FILE_DOWNLOAD_FAILED = `${icon('fail')} फ़ाइल डाउनलोड नहीं हो सकी।`;
export const FILE_STORE_FAILED = `${icon('fail')} फ़ाइल सहेजी नहीं जा सकी।`;
export const FILE_TOO_LARGE = `${icon('denied')} फ़ाइल बहुत बड़ी है, इसे टेक्स्ट में भेजें।`;
export const ONLY_TEXT_FILES = `${icon('denied')} केवल टेक्स्ट फ़ाइलें स्वीकार की जाती हैं।`;
export const CLI_SPAWN_FAILED = `${icon('fail')} CLI प्रक्रिया शुरू नहीं हो सकी, फिर कोशिश की जाएगी।`;
export const CLI_FALLBACK_NOTICE = `${icon('warn')} सर्वर ने प्रॉम्प्ट नहीं लिया, CLI फ़ॉलबैक से चलाया जा रहा है।`;
export const CONTINUE_NOTHING = `${icon('warn')} जारी रखने के लिए कुछ नहीं — पहले कोई कार्य भेजें।`;
export const CONTINUE_QUEUED = `${icon('rocket')} पिछला कार्य फिर से कतार में लग गया।`;
export const PERM_DECIDE_HINT = `${icon('warn')} हाँ या नहीं कहें — या बटन दबाएँ।`;
export const PERMISSION_NEEDED_TITLE = `${icon('question')} अनुमति चाहिए`;
export const ALREADY_RESOLVED = `${icon('warn')} पहले ही निपटा जा चुका है।`;
export const DECISION_SEND_FAILED = `${icon('fail')} निर्णय भेजा नहीं जा सका, फिर कोशिश करें।`;
export const ANSWER_SEND_FAILED = `${icon('fail')} उत्तर भेजा नहीं जा सका, फिर कोशिश करें।`;
export const QUESTION_OUTDATED = `${icon('warn')} यह प्रश्न कार्ड पुराना है — नए कार्ड पर उत्तर दें।`;
export const QUESTION_FREE_TEXT_ONLY =
    `${icon('warn')} किसी विकल्प या "पूर्ण" पर टैप करें — फ्री टेक्स्ट केवल एकल-विकल्प प्रश्नों में चलता है।`;
export const MODE_NO_AGENT_CONTROL = `${icon('fail')} मोड नहीं बदला जा सकता: एजेंट नियंत्रण उपलब्ध नहीं है।`;
export const MODE_SWITCH_FAILED = `${icon('fail')} मोड नहीं बदला जा सका, फिर कोशिश करें।`;
export const MODE_SWITCH_GONE = `${icon('fail')} मोड नहीं बदला जा सका, सेशन गायब है।`;
export const SETTINGS_RESET_ALL = `${EMOJI.gears} सब कुछ रीसेट करें`;
export const STOPPED_AGAIN = `${icon('stop')} रुक गया, कार्य दोबारा भेजें।`;
export const TOPIC_RESTORE_FAILED = `${icon('fail')} इस टॉपिक के लिए सेशन बहाल नहीं हो सका, फिर कोशिश करें।`;
export const TOPIC_SESSION_CREATE_FAILED = `${icon('fail')} इस टॉपिक के लिए सेशन नहीं बना, फिर कोशिश करें।`;
export const ADMIN_GATE_GENERIC = `${icon('denied')} यह केवल फोरम एडमिन ही बदल सकते हैं।`;
export const THINKING_LABEL = 'सोच रहा है';
export const THOUGHT_LABEL = 'विचार';
export const CHARS_LABEL = 'वर्ण';
export const PLAN_LABEL = 'योजना';
export const CMD_DESC_STOP = 'चल रहे टर्न को रोकें';
export const CMD_DESC_STATUS = 'स्टेटस कार्ड दिखाएँ';
export const CMD_DESC_MODE = 'रनिंग मोड और केवल देखें';
export const CMD_DESC_MODELS = 'मॉडल सूची या स्विच';
export const CMD_DESC_SETTINGS = 'लाइव सेटिंग्स कार्ड';
export const CMD_DESC_LANGS = 'भाषा सेटिंग्स (/lang भी)';
export const CMD_DESC_SESSIONS = 'देखे जा रहे सेशन की सूची';
export const CMD_DESC_HELP = 'बॉट क्या कर सकता है';

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
        'बाकी सब जो आप लिखते हैं वह एजेंट को प्रॉम्प्ट के रूप में जाता है। संदेश का रिप्ली करें — कोट रहेगा, @username का जिक्र करें — जवाब उसे संबोधित होगा।',
    ].join('\n');
}

export function promptLangDirective(): string {
    return 'उपयोगकर्ता किसी भी भाषा में लिखे, विचार और उत्तर हमेशा हिंदी में दें।';
}
export const SETTINGS_LABELS: Record<string, string> = {
    lang: 'बॉट भाषा',
    chatLang: 'चैट भाषा',
    watchOnly: 'केवल निगरानी',
    leadMention: '@लेखक मेंशन',
    quoteReplies: 'उत्तर के कोट',
    autoFinish: 'पूर्ण सूचनाएँ',
    answerFanout: 'साझा उत्तर',
    subagentUsers: 'सबएजेंट उपयोगकर्ता',
    newTopics: 'नए टॉपिक',
    voice: 'वॉइस ट्रांसक्रिप्शन',
    voiceLang: 'वॉइस भाषा',
    voiceServer: 'स्थायी Whisper सर्वर',
    voiceThreads: 'Whisper थ्रेड',
    twoColumns: 'दो कॉलम',
};

export function shortAgo(now: number, at: number): string {
    if (at === 0) return 'कभी नहीं';
    const sec = Math.max(1, Math.round((now - at) / 1000));
    if (sec < 60) return `${sec}s पहले`;
    if (sec < 3600) return `${Math.round(sec / 60)}m पहले`;
    if (sec < 172800) return `${Math.round(sec / 3600)}h पहले`;
    return `${Math.round(sec / 86400)}d पहले`;
}

export function subagentDigestNote(task: string, lastText: string): string {
    return (
        `${DIGEST_PROMPT_PREFIX} कार्य: ${task.slice(0, 120)}। ` +
        `परिणाम सार: ${(lastText || '(कोई टेक्स्ट नहीं)').slice(0, 400)}। ` +
        'कृपया यह परिणाम सेशन संदर्भ में दर्ज करें। कुछ भी उत्तर न दें।'
    );
}

export function subagentDispatched(parallel: number): string {
    const tail = parallel > 1 ? ` ${parallel} कार्य समानांतर में चल रहे हैं।` : '';
    return `${icon('bot')} कार्य समानांतर सबएजेंट को सौंप दिया गया — उत्तर यहाँ दिखेगा।${tail}`;
}

export function switchedTo(title: string, tag: string): string {
    return `${checkIcon()} <b>${escapeHtml(title)}</b> · ${escapeHtml(tag)} पर स्विच हो गया`;
}

export function rateLimitedRetry(waitSec: number | string): string {
    return `${hourglassIcon()} रेट लिमिट, ~${waitSec}s में फिर कोशिश — आपका प्रॉम्प्ट कतार में बना रहता है।`;
}

export function promptFailed(errText: string): string {
    return `${icon('fail')} प्रॉम्प्ट असफल: ${errText}`;
}

export function opencodeRetry(errText: string): string {
    return `${icon('warn')} opencode त्रुटि: ${escapeHtml(errText)} — फिर कोशिश कर रहा हूँ, आपका प्रॉम्प्ट कतार में बना रहता है।`;
}

export function turnStoppedByServer(reason: string): string {
    return `${icon('warn')} opencode ने यह चरण रोक दिया: ${escapeHtml(reason)}\n\nजारी रखने के लिए दोबारा लिखें।`;
}

export function opencodeModelError(text: string): string {
    return `${icon('warn')} opencode त्रुटि: ${escapeHtml(text)}`;
}

export function explainModelError(text: string): string {
    const raw = text.trim();
    const has = (pattern: RegExp): boolean => pattern.test(raw);
    if (has(/FreeTierError|free tier can only be used/i)) {
        return 'प्रदाता OpenCode क्लाइंट के बाहर से आए अनुरोधों पर फ्री-टियर मॉडल स्वीकार नहीं करता। '
            + 'एजेंट स्थानीय opencode सर्वर चलाता है, इसलिए ये मॉडल यहाँ HTTP 403 देते हैं। '
            + 'अपनी API कुंजी वाला मॉडल चुनें, या कार्य को OpenCode ऐप से चलाएँ जहाँ फ्री टियर की अनुमति है।';
    }
    if (has(/VariantUnavailableError|Variant unavailable/i)) {
        return 'सेशन उस मॉडल वेरिएंट से बंधा है जो इस मॉडल पर उपलब्ध नहीं है, इसलिए यह चरण शुरू नहीं हो सकता। '
            + 'बार-बार होने पर टॉपिक में मॉडल बदलें।';
    }
    if (has(/429|rate.?limit|too many requests/i)) {
        return 'प्रदाता इस मॉडल पर अनुरोधों को सीमित कर रहा है। कार्य सुरक्षित है; थोड़ी देर में दोबारा लिखें।';
    }
    if (has(/401|unauthor|forbidden|api key/i)) {
        return 'प्रदाता ने इस मॉडल के क्रेडेंशियल अस्वीकार कर दिए। सेशन मॉडल की API कुंजी ठीक करें।';
    }
    if (has(/context length|context_length|maximum context|too many tokens/i)) {
        return 'अनुरोध अब मॉडल की कॉन्टेक्स्ट विंडो में समाता नहीं। इस टॉपिक के लिए नया सेशन शुरू करें।';
    }
    if (has(/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|network/i)) {
        return 'प्रदाता के एंडपॉइंट तक पहुँच नहीं बन सकी। नेटवर्क और opencode सर्वर जाँचें।';
    }
    if (!raw) return 'opencode ने यह नहीं बताया कि चरण क्यों रुका।';
    return 'अज्ञात कारण से मॉडल कॉल विफल हुई।';
}

export function modelErrorNotice(text: string): string {
    const raw = text.trim();
    const explanation = explainModelError(raw);
    if (!raw) return explanation;
    return `${explanation}\n\nopencode ने कहा: ${truncate(raw, 400)}`;
}

export function mediaUnparsed(label: string): string {
    return `${icon('warn')} ${label} अभी पार्स नहीं हो सका — फोटो, वीडियो, दस्तावेज़ या टेक्स्ट भेजें।`;
}

export function cliFailed(code: number): string {
    return `${icon('fail')} CLI प्रक्रिया त्रुटि से रुक गई (कोड ${code})।`;
}

export function permissionDecisionText(decision: PermissionDecision): string {
    if (decision === 'reject') return `${icon('denied')} अस्वीकृत।`;
    return `${checkIcon()} ${decision === 'always' ? 'हमेशा के लिए अनुमति दी।' : 'एक बार के लिए अनुमति दी।'}`;
}

export function questDoneLabel(answered: number, total: number): string {
    return `पूर्ण ${answered}/${total}`;
}

export function modelSwitched(id: string): string {
    return `${icon('check')} मॉडल अब <b>${escapeHtml(id)}</b> है।`;
}

export function effortSet(variant: string, modelId: string): string {
    return `प्रयास स्तर: <b>${escapeHtml(modelId)}</b> के लिए <b>${escapeHtml(variant)}</b>।`;
}

export function modeSwitched(build: boolean, agentId: string): string {
    return (
        `मोड: <b>${build ? MODE_BUILD_LABEL : MODE_PLAN_LABEL}</b> — मॉडल अब <b>${escapeHtml(agentId)}</b> के रूप में चलता है और ` +
        `${build ? 'फ़ाइलें बदल सकता है' : 'कुछ भी संपादित नहीं करेगा'}।`
    );
}

export function watchOnlyToggleLabel(plain: boolean): string {
    return `केवल निगरानी · ${settingOnOff(plain)}`;
}

export function settingOnOff(on: boolean): string {
    return on ? 'चालू' : 'बंद';
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
        `मोड: <b>${input.build ? MODE_BUILD_LABEL : MODE_PLAN_LABEL}</b>` +
        `${current}` +
        ' — बदलने के लिए टैप करें।\n' +
        `<b>${MODE_BUILD_LABEL}</b> — मॉडल फ़ाइलें बदल सकता है।\n` +
        `<b>${MODE_PLAN_LABEL}</b> — मॉडल केवल पढ़ता और उत्तर देता है, कोई संपादन नहीं।\n` +
        (input.plain
            ? '"केवल निगरानी" चालू है — टाइप किए प्रॉम्प्ट नज़रअंदाज़ किए जाते हैं; इनपुट वापस पाने के लिए निचली पंक्ति टैप करें।'
            : '"केवल निगरानी" बंद है — निचली पंक्ति बॉट को एक दर्शक बना देती है जो कुछ भी जमा नहीं करता।')
    );
}

export function modelCardText(currentId: string, currentVariant: string, models?: ModelApiInfo[]): string {
    const current = (models ?? []).find((m) => m.id === currentId);
    const context = formatModelContext(current?.limit);
    const caps = current ? describeModelCapabilities(current) : [];
    const lines = [`मॉडल: <b>${escapeHtml(currentId || 'डिफ़ॉल्ट')}</b> — बदलने के लिए टैप करें।`];
    if (current) {
        lines.push(`कॉन्टेक्स्ट: <b>${escapeHtml(context || '—')}</b>${caps.length > 0 ? ` | ${escapeHtml(caps.join(', '))}` : ''}`);
    }
    const variants = current ? modelVariantIds(current) : [];
    lines.push(
        `प्रयास स्तर: <b>${escapeHtml(currentVariant || 'डिफ़ॉल्ट')}</b>` +
            (variants.length > 0 ? ` — विकल्प: ${escapeHtml(variants.join(', '))}` : ' — कोई वेरिएंट नहीं।'),
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
        contextLine = `${icon('inbox')} कॉन्टेक्स्ट <b>${occupancyText}${limitText ? `/${limitText} (${percent}%)` : ''}</b>`;
    } else {
        contextLine = `${icon('inbox')} कॉन्टेक्स्ट <b>—</b>${limitText ? ` · विंडो ${limitText} (इस चरण के टोकन अभी नहीं)` : ''}`;
    }
    const whisper = input.whisper;
    const whisperLine = whisper?.enabled === true
        ? whisper.autoServe === false
            ? 'CLI ट्रांसक्राइबर'
            : `स्थायी सर्वर ${whisper.serverUrl ?? ''}`
        : 'बंद';
    const lines = [
        `${icon('gears')} <b>स्थिति</b> · ${escapeHtml(input.title)} · <code>${escapeHtml(input.sessionTag)}</code>`,
        `${icon('bot')} OpenCode ${escapeHtml(opencodeSourceDisplay(input.opencodeBaseUrl))}`,
        `${icon('brain')} मॉडल <b>${escapeHtml(input.modelRefText)}</b>${input.variantText ? ` (${escapeHtml(input.variantText)})` : ''} · ${input.buildMode ? MODE_BUILD_LABEL : MODE_PLAN_LABEL} · ${escapeHtml(input.sessionAgent)}`,
        contextLine,
        `${icon('active')} ${input.turnComplete ? 'खाली' : 'चल रहा है'} · अंतिम घटना ${shortAgo(input.now, input.lastEventAt)} · अपटाइम ${shortUptime(input.now - input.bootAt)}`,
    ];
    if (input.promptQueueLength > 0) lines.push(`${icon('queued')} कतार: ${input.promptQueueLength}`);
    if (input.cost > 0) lines.push(`${icon('coin')} $${input.cost.toFixed(2)}`);
    if (input.now < input.rateLimitedUntil) {
        lines.push(`${icon('hourglass')} रेट लिमिट ${new Date(input.rateLimitedUntil).toLocaleTimeString('hi-IN')} तक`);
    }
    lines.push(`${icon('toolbox')} Whisper: ${whisperLine} (${whisper?.threads ?? 0} थ्रेड, ${whisper?.language ?? 'स्वतः'})`);
    if (input.voice) {
        lines.push(`${icon('timer')} अंतिम वॉइस ${input.voice.audioSec.toFixed(0)}s → ${(input.voice.processingMs / 1000).toFixed(1)}s (${shortAgo(input.now, input.voice.at)})`);
    }
    return `${lines.join('\n')}\n`;
}

export function statusCardMarkup(sessionId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[{ text: `${EMOJI.active} रिफ्रेश`, callback_data: `status:${sessionId}` }]] };
}

export function sessionRowLabel(title: string, running: boolean, occupancy: number, cost: number): string {
    const stateMark = running ? `${EMOJI.active} चल रहा है` : `${EMOJI.soon} खाली`;
    return `${title} · ${stateMark} · ${formatTokenShort(occupancy)} tok · $${cost.toFixed(3)}`;
}

export function sessionsCardText(rows: string[], count: number, plain: boolean): string {
    const header = `${icon('cache')} <b>सेशन</b> · ${count} ${plain ? 'उपलब्ध' : 'निगरानी में'}`;
    if (rows.length === 0) {
        return `${header}\n${plain ? 'अभी कोई सेशन उपलब्ध नहीं।' : 'अभी कोई सेशन निगरानी में नहीं।'}`;
    }
    return `${header}\n${rows.join('\n')}\n\n${plain ? 'चैट को उस सेशन पर ले जाने के लिए' : 'उसका स्थिति कार्ड खोलने के लिए'} किसी पंक्ति पर टैप करें।\n`;
}

export function settingsCardText(rows: Array<{ label: string; display: string }>, where?: 'topic' | 'chat'): string {
    const lines = rows.map((row) => settingRow(row.label, row.display));
    const scope = where === 'topic'
        ? 'ये मान केवल इसी टॉपिक पर लागू होते हैं; Whisper सर्वर/थ्रेड पूरे बॉट पर लागू होते हैं।'
        : where === 'chat'
            ? 'ये मान केवल इसी चैट पर लागू होते हैं; Whisper सर्वर/थ्रेड पूरे बॉट पर लागू होते हैं।'
            : 'ओवरराइड रीस्टार्ट के बाद भी बने रहते हैं।';
    return `${icon('gears')} <b>सेटिंग्स</b>\n${lines.join('\n')}\n\nबदलने के लिए किसी पंक्ति पर टैप करें। ${scope}\n`;
}

export function langsCardText(rows: Array<{ label: string; display: string }>, where?: 'topic' | 'chat'): string {
    const [bot, chat] = rows;
    const lines = [
        langSectionLine('bot', bot?.label ?? 'lang', bot?.display ?? '', 'ऊपर की पंक्ति'),
        langSectionLine('chat', chat?.label ?? 'chatLang', chat?.display ?? '', 'नीचे की पंक्ति'),
    ];
    const scope = where === 'topic'
        ? 'बॉट भाषा पूरे बॉट पर लागू होती है; चैट भाषा केवल इसी टॉपिक पर।'
        : where === 'chat'
            ? 'बॉट भाषा पूरे बॉट पर लागू होती है; चैट भाषा केवल इसी चैट पर।'
            : 'बॉट भाषा पूरे बॉट पर लागू होती है; चैट भाषा टॉपिक या चैट के अनुसार अलग होती है।';
    return `${icon('globe')} <b>भाषाएँ</b>\n\n${lines.join('\n')}\n\nनीचे संबंधित पंक्ति में भाषा चुनें। ${scope}\n`;
}

export function stopControlText(build: boolean): string {
    const mode = build ? MODE_BUILD_LABEL : MODE_PLAN_LABEL;
    return `${rocketIcon()} चल रहा है · ${mode} — कार्य रोकने और दोबारा लिखने के लिए "रोकें" दबाएँ।`;
}

export function stopMarkup(sessionId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[
        { text: `${EMOJI.coffee} रोकें`, callback_data: `stop:${sessionId}` },
    ]] };
}
