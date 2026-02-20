import { PluginContext } from '@ton-ai/core';
import {
    Model,
    ChatHistory,
    ApiKey,
    Guardrail,
    Provider,
    ActivityItem,
    GenerationInfo,
    OpenResponsesNonStreamingResponse,
    AnthropicMessagesResponse
} from './types';

export class ResponseCache {
    private responses: Map<string, OpenResponsesNonStreamingResponse> = new Map();
    private anthropicResponses: Map<string, AnthropicMessagesResponse> = new Map();
    private maxEntries: number = 100;

    constructor(maxEntries: number = 100) {
        this.maxEntries = maxEntries;
    }

    setResponse(id: string, response: OpenResponsesNonStreamingResponse): void {
        this.responses.set(id, response);
        this.pruneCache(this.responses);
    }

    getResponse(id: string): OpenResponsesNonStreamingResponse | undefined {
        return this.responses.get(id);
    }

    setAnthropicResponse(id: string, response: AnthropicMessagesResponse): void {
        this.anthropicResponses.set(id, response);
        this.pruneCache(this.anthropicResponses);
    }

    getAnthropicResponse(id: string): AnthropicMessagesResponse | undefined {
        return this.anthropicResponses.get(id);
    }

    private pruneCache<K, V>(cache: Map<K, V>): void {
        if (cache.size > this.maxEntries) {
            const keysToDelete = Array.from(cache.keys()).slice(0, cache.size - this.maxEntries);
            for (const key of keysToDelete) {
                cache.delete(key);
            }
        }
    }

    clear(): void {
        this.responses.clear();
        this.anthropicResponses.clear();
    }
}

export class ModelCache {
    private models: Model[] = [];
    private modelsMap: Map<string, Model> = new Map();
    private lastUpdated: number = 0;
    private maxAge: number = 3600000;

    constructor(maxAge?: number) {
        if (maxAge) this.maxAge = maxAge;
    }

    setModels(models: Model[]): void {
        this.models = models;
        this.modelsMap.clear();
        for (const model of models) {
            this.modelsMap.set(model.id, model);
            if (model.canonical_slug) {
                this.modelsMap.set(model.canonical_slug, model);
            }
        }
        this.lastUpdated = Date.now();
    }

    getModels(): Model[] | null {
        if (this.isExpired()) return null;
        return this.models;
    }

    getModel(id: string): Model | null {
        if (this.isExpired()) return null;
        return this.modelsMap.get(id) || null;
    }

    isExpired(): boolean {
        return Date.now() - this.lastUpdated > this.maxAge;
    }

    clear(): void {
        this.models = [];
        this.modelsMap.clear();
        this.lastUpdated = 0;
    }
}

export class ChatHistoryManager {
    private histories: ChatHistory[] = [];
    private historyMap: Map<string, ChatHistory> = new Map();
    private maxHistory: number = 100;

    constructor(maxHistory: number = 100) {
        this.maxHistory = maxHistory;
    }

    addHistory(history: ChatHistory): void {
        this.histories.unshift(history);
        this.historyMap.set(history.id, history);

        if (this.histories.length > this.maxHistory) {
            const removed = this.histories.pop();
            if (removed) {
                this.historyMap.delete(removed.id);
            }
        }
    }

    getHistory(id: string): ChatHistory | undefined {
        return this.historyMap.get(id);
    }

    getRecentHistories(limit: number = 10): ChatHistory[] {
        return this.histories.slice(0, limit);
    }

    getHistoriesByModel(model: string, limit: number = 10): ChatHistory[] {
        return this.histories
            .filter(h => h.model === model)
            .slice(0, limit);
    }

    getStats(): {
        total: number;
        totalTokens: number;
        models: Record<string, number>;
    } {
        const stats = {
            total: this.histories.length,
            totalTokens: 0,
            models: {} as Record<string, number>
        };

        for (const h of this.histories) {
            stats.totalTokens += h.usage?.total_tokens || 0;
            stats.models[h.model] = (stats.models[h.model] || 0) + 1;
        }

        return stats;
    }

    clearHistory(): void {
        this.histories = [];
        this.historyMap.clear();
    }
}

export class ApiKeyManager {
    private currentKey: string = '';
    private keys: Map<string, ApiKey> = new Map();
    private lastFetch: number = 0;
    private maxAge: number = 300000;

    setCurrentKey(key: string): void {
        this.currentKey = key;
    }

    getCurrentKey(): string {
        return this.currentKey;
    }

    setKeys(keys: ApiKey[]): void {
        this.keys.clear();
        for (const key of keys) {
            this.keys.set(key.hash, key);
        }
        this.lastFetch = Date.now();
    }

    getKey(hash: string): ApiKey | undefined {
        if (Date.now() - this.lastFetch > this.maxAge) {
            return undefined;
        }
        return this.keys.get(hash);
    }

    getAllKeys(): ApiKey[] {
        if (Date.now() - this.lastFetch > this.maxAge) {
            return [];
        }
        return Array.from(this.keys.values());
    }

    clear(): void {
        this.keys.clear();
        this.lastFetch = 0;
    }
}

export class GenerationCache {
    private generations: Map<string, GenerationInfo> = new Map();
    private maxEntries: number = 50;

    constructor(maxEntries: number = 50) {
        this.maxEntries = maxEntries;
    }

    setGeneration(id: string, info: GenerationInfo): void {
        this.generations.set(id, info);
        if (this.generations.size > this.maxEntries) {
            const keysToDelete = Array.from(this.generations.keys()).slice(0, this.generations.size - this.maxEntries);
            for (const key of keysToDelete) {
                this.generations.delete(key);
            }
        }
    }

    getGeneration(id: string): GenerationInfo | undefined {
        return this.generations.get(id);
    }

    clear(): void {
        this.generations.clear();
    }
}

export class ActivityCache {
    private activities: Map<string, ActivityItem[]> = new Map();
    private maxAge: number = 3600000;

    setActivities(date: string, items: ActivityItem[]): void {
        this.activities.set(date, items);
    }

    getActivities(date: string): ActivityItem[] | undefined {
        return this.activities.get(date);
    }

    clear(): void {
        this.activities.clear();
    }
}

export class GuardrailCache {
    private guardrails: Map<string, Guardrail> = new Map();
    private lastFetch: number = 0;
    private maxAge: number = 300000;

    setGuardrails(guardrails: Guardrail[]): void {
        this.guardrails.clear();
        for (const g of guardrails) {
            this.guardrails.set(g.id, g);
        }
        this.lastFetch = Date.now();
    }

    getGuardrail(id: string): Guardrail | undefined {
        if (Date.now() - this.lastFetch > this.maxAge) {
            return undefined;
        }
        return this.guardrails.get(id);
    }

    getAllGuardrails(): Guardrail[] {
        if (Date.now() - this.lastFetch > this.maxAge) {
            return [];
        }
        return Array.from(this.guardrails.values());
    }

    clear(): void {
        this.guardrails.clear();
        this.lastFetch = 0;
    }
}

export class ProviderCache {
    private providers: Provider[] = [];
    private lastFetch: number = 0;
    private maxAge: number = 86400000;

    setProviders(providers: Provider[]): void {
        this.providers = providers;
        this.lastFetch = Date.now();
    }

    getProviders(): Provider[] | null {
        if (Date.now() - this.lastFetch > this.maxAge) return null;
        return this.providers;
    }

    clear(): void {
        this.providers = [];
        this.lastFetch = 0;
    }
}

export class StreamManager {
    private streams: Map<string, AbortController> = new Map();

    createStream(id: string): AbortController {
        const controller = new AbortController();
        this.streams.set(id, controller);
        return controller;
    }

    cancelStream(id: string): boolean {
        const controller = this.streams.get(id);
        if (controller) {
            controller.abort();
            this.streams.delete(id);
            return true;
        }
        return false;
    }

    cancelAllStreams(): void {
        for (const [id, controller] of this.streams) {
            controller.abort();
            this.streams.delete(id);
        }
    }

    hasStream(id: string): boolean {
        return this.streams.has(id);
    }

    getStreamIds(): string[] {
        return Array.from(this.streams.keys());
    }
}

export class OpenRouterComponents {
    public responses: ResponseCache;
    public models: ModelCache;
    public history: ChatHistoryManager;
    public apiKeys: ApiKeyManager;
    public generations: GenerationCache;
    public activities: ActivityCache;
    public guardrails: GuardrailCache;
    public providers: ProviderCache;
    public streams: StreamManager;
    private context: PluginContext;
    private config: any;
    private intervals: Map<string, NodeJS.Timeout> = new Map();

    constructor(context: PluginContext, config: any) {
        this.context = context;
        this.config = config;

        this.responses = new ResponseCache();
        this.models = new ModelCache(3600000);
        this.history = new ChatHistoryManager(config.maxHistory || 100);
        this.apiKeys = new ApiKeyManager();
        this.generations = new GenerationCache();
        this.activities = new ActivityCache();
        this.guardrails = new GuardrailCache();
        this.providers = new ProviderCache();
        this.streams = new StreamManager();
    }

    updateConfig(newConfig: any): void {
        this.config = { ...this.config, ...newConfig };
    }

    startInterval(name: string, callback: () => Promise<void>, intervalMs: number): void {
        if (this.intervals.has(name)) {
            this.stopInterval(name);
        }

        const interval = setInterval(async () => {
            try {
                await callback();
            } catch (error) {
                this.context.logger.error(`Error in interval ${name}:`, error);
            }
        }, intervalMs);

        this.intervals.set(name, interval);
    }

    stopInterval(name: string): void {
        const interval = this.intervals.get(name);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(name);
        }
    }

    stopAllIntervals(): void {
        for (const [name, interval] of this.intervals) {
            clearInterval(interval);
            this.intervals.delete(name);
        }
    }

    cleanup(): void {
        this.stopAllIntervals();
        this.streams.cancelAllStreams();
        this.responses.clear();
        this.models.clear();
        this.history.clearHistory();
        this.apiKeys.clear();
        this.generations.clear();
        this.activities.clear();
        this.guardrails.clear();
        this.providers.clear();
    }
}
