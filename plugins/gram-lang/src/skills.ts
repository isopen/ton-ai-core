import { PluginContext } from '@ton-ai/core';
import { getLogger } from '@ton-ai/gram-debug';
import { GramLangComponents } from './components';
import {
    GramLangConfig,
    RpcProvider,
    LangStorage,
    LangOption,
    LANG_CODE_MAP,
    REVERSE_LANG_CODE_MAP
} from './types';
import { BUILTIN_STRINGS } from './local/en';

const DEFAULT_LANG_PACK = 'tdesktop';
const DEFAULT_CACHE_VERSION = 'v3';
const DEFAULT_LANG = 'en';
const DEFAULT_MAX_RETRIES = 3;

const log = getLogger('gram-lang');

export class GramLangSkills {
    private context: PluginContext | undefined;
    private components: GramLangComponents;
    private config: GramLangConfig;
    private ready: boolean = false;
    private readyWaiters: Array<() => void> = [];

    constructor(context: PluginContext | undefined, components: GramLangComponents, config?: GramLangConfig) {
        this.context = context;
        this.components = components;
        this.config = {
            langPack: DEFAULT_LANG_PACK,
            cacheVersion: DEFAULT_CACHE_VERSION,
            defaultLang: DEFAULT_LANG,
            maxRetries: DEFAULT_MAX_RETRIES,
            ...config
        };
    }

    isReady(): boolean {
        return this.ready;
    }

    markReady(): void {
        this.ready = true;
        const waiters = this.readyWaiters.splice(0);
        for (const w of waiters) w();
    }

    async waitForReady(timeout: number = 10000): Promise<void> {
        if (this.isReady()) return;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.readyWaiters.indexOf(onReady);
                if (idx !== -1) this.readyWaiters.splice(idx, 1);
                reject(new Error('GramLang plugin not ready'));
            }, timeout);
            const onReady = () => {
                clearTimeout(timer);
                resolve();
            };
            this.readyWaiters.push(onReady);
        });
    }

    updateConfig(config: Partial<GramLangConfig>): void {
        this.config = { ...this.config, ...config };
    }

    bindStorage(storage: LangStorage): void {
        this.components.packs.bind(storage);
    }

    stringsKey(langCode: string): string {
        return 'langStrings_' + (this.config.cacheVersion || DEFAULT_CACHE_VERSION) + '_' + langCode;
    }

    optionsKey(): string {
        return 'langOptions_' + (this.config.cacheVersion || DEFAULT_CACHE_VERSION);
    }

    resolveServerCode(langCode: string): string {
        return LANG_CODE_MAP[langCode] || langCode;
    }

    resolveLocalCode(serverCode: string): string {
        return REVERSE_LANG_CODE_MAP[serverCode] || serverCode;
    }

    private async waitForRpc(getRpc: () => RpcProvider | null): Promise<RpcProvider | null> {
        for (let attempt = 0; attempt < 6; attempt++) {
            const rpc = getRpc();
            if (rpc) return rpc;
            await new Promise(r => setTimeout(r, 300));
        }
        return getRpc();
    }

    private async callWithRetry(getRpc: () => RpcProvider | null, method: string, params: Record<string, any>): Promise<any> {
        const rpc = await this.waitForRpc(getRpc);
        if (!rpc) throw new Error('not connected');
        const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES;
        let lastError: any = null;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await rpc.callRpc(method, params);
            } catch (e: any) {
                lastError = e;
                const msg = String(e?.message || '');
                if (msg.includes('not connected') && attempt + 1 < maxRetries) {
                    await new Promise(r => setTimeout(r, 600 + attempt * 400));
                    continue;
                }
                throw e;
            }
        }
        throw lastError || new Error('RPC call failed');
    }

    async getStrings(getRpc: () => RpcProvider | null, langCode: string, tlgKeys: string[]): Promise<Record<string, string> | null> {
        const cacheKey = this.stringsKey(langCode);
        try {
            const cached = await this.components.packs.get<Record<string, string>>(cacheKey);
            if (cached && Object.keys(cached).length > 0) return cached;
        } catch {}
        const startTime = Date.now();
        return this.components.requestQueue.add(async () => {
            try {
                const rawData = await this.callWithRetry(getRpc, 'langpack.getStrings', {
                    lang_pack: this.config.langPack || DEFAULT_LANG_PACK,
                    lang_code: this.resolveServerCode(langCode),
                    keys: tlgKeys,
                });
                const items: any[] = Array.isArray(rawData) ? rawData
                    : rawData?.items ? rawData.items
                    : rawData?.result?.items ? rawData.result.items
                    : [];
                const raw: Record<string, string> = {};
                for (const item of items) {
                    if (item && item.key) {
                        const val = item.value || item.other_value;
                        if (val) raw[item.key] = val;
                    }
                }
                const mapped: Record<string, string> = {};
                for (const key of tlgKeys) {
                    if (raw[key] !== undefined) mapped[key] = raw[key];
                }
                if (Object.keys(mapped).length > 0) {
                    await this.components.packs.set(cacheKey, mapped);
                    this.components.metrics.recordRequest(Date.now() - startTime);
                    return mapped;
                }
                return null;
            } catch (e: any) {
                this.components.metrics.recordError('getStrings failed: ' + String(e?.message || e));
                throw e;
            }
        });
    }

    async getLanguages(getRpc: () => RpcProvider | null): Promise<LangOption[]> {
        const cacheKey = this.optionsKey();
        try {
            const cached = await this.components.packs.get<LangOption[]>(cacheKey);
            if (cached && cached.length > 0 && cached.some(o => o && o.code)) return cached;
        } catch {}
        const startTime = Date.now();
        return this.components.requestQueue.add(async () => {
            try {
                const raw = await this.callWithRetry(getRpc, 'langpack.getLanguages', {
                    lang_pack: this.config.langPack || DEFAULT_LANG_PACK,
                });
                const langs: any[] = Array.isArray(raw) ? raw : raw?.items || raw?.result?.items || [];
                const seen = new Set<string>();
                const result: LangOption[] = [];
                for (const l of langs) {
                    const code = this.resolveLocalCode(l.lang_code);
                    if (!code || seen.has(code)) continue;
                    seen.add(code);
                    result.push({ code, label: l.native_name || l.name || l.lang_code });
                }
                await this.components.packs.set(cacheKey, result);
                this.components.metrics.recordRequest(Date.now() - startTime);
                return result;
            } catch (e: any) {
                this.components.metrics.recordError('getLanguages failed: ' + String(e?.message || e));
                log.info('[gram-lang] getLanguages error:', e?.message);
                return [];
            }
        });
    }

    getBuiltinStrings(langCode: string): Record<string, string> | null {
        const pack = (BUILTIN_STRINGS as Record<string, Record<string, string>>)[langCode];
        if (!pack) return null;
        return { ...pack };
    }

    async clearCache(storage?: LangStorage): Promise<void> {
        this.components.packs.clear();
        if (!storage) return;
        for (const prefix of ['langStrings_', 'langOptions_']) {
            try {
                const keys = await storage.keys(prefix);
                for (const k of keys) {
                    try { await storage.del(k); } catch {}
                }
            } catch {}
        }
    }

    getMetrics() {
        return this.components.metrics.getStats();
    }

    resetMetrics(): void {
        this.components.metrics.reset();
    }
}
