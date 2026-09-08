export interface GramLangConfig {
    langPack?: string;
    cacheVersion?: string;
    defaultLang?: string;
    maxRetries?: number;
}

export interface RpcProvider {
    callRpc(method: string, params: Record<string, any>): Promise<any>;
}

export interface LangStorage {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: any): Promise<void>;
    del(key: string): Promise<void>;
    keys(prefix: string): Promise<string[]>;
}

export interface LangOption {
    code: string;
    label: string;
}

export const LANG_CODE_MAP: Record<string, string> = {
    'zh': 'zh-hans',
    'zh-TW': 'zh-hant',
    'pt': 'pt-br',
    'pt-PT': 'pt-pt',
};

export const REVERSE_LANG_CODE_MAP: Record<string, string> = {
    'zh-hans': 'zh',
    'zh-hant': 'zh-TW',
    'pt-br': 'pt',
    'pt-pt': 'pt-PT',
};

export function normalizeLangCode(raw: string): string {
    const code = (raw || '').trim().replace('_', '-');
    if (!code) return 'en';
    const lower = code.toLowerCase();
    if (REVERSE_LANG_CODE_MAP[lower]) return REVERSE_LANG_CODE_MAP[lower];
    for (const k of Object.keys(LANG_CODE_MAP)) {
        if (k.toLowerCase() === lower) return k;
    }
    const base = lower.split('-')[0];
    if (base) {
        for (const k of Object.keys(LANG_CODE_MAP)) {
            if (k.toLowerCase() === base) return k;
        }
        return base;
    }
    return 'en';
}
