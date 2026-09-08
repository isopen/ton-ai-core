import { PluginContext } from '@ton-ai/core';
import type { GramLangConfig, LangStorage } from './types';

export class PackCache {
    private memory = new Map<string, any>();
    private storage: LangStorage | null = null;

    bind(storage: LangStorage): void {
        this.storage = storage;
    }

    async get<T>(key: string): Promise<T | undefined> {
        if (this.memory.has(key)) return this.memory.get(key) as T;
        if (!this.storage) return undefined;
        try {
            const value = await this.storage.get<T>(key);
            if (value !== undefined) this.memory.set(key, value);
            return value;
        } catch {
            return undefined;
        }
    }

    async set(key: string, value: any): Promise<void> {
        this.memory.set(key, value);
        if (!this.storage) return;
        try {
            await this.storage.set(key, value);
        } catch {}
    }

    async del(key: string): Promise<void> {
        this.memory.delete(key);
        if (!this.storage) return;
        try {
            await this.storage.del(key);
        } catch {}
    }

    clear(): void {
        this.memory.clear();
    }
}

export class RequestQueue {
    private queue: Array<() => Promise<any>> = [];
    private processing: boolean = false;
    private maxConcurrent: number = 3;
    private activeCount: number = 0;

    constructor(maxConcurrent: number = 3) {
        this.maxConcurrent = maxConcurrent;
    }

    async add<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await task();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
            this.schedule();
        });
    }

    private schedule(): void {
        if (this.processing) return;
        this.processing = true;
        queueMicrotask(() => {
            this.processing = false;
            this.drain();
        });
    }

    private drain(): void {
        while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift()!;
            this.activeCount++;
            task().finally(() => {
                this.activeCount--;
                this.drain();
            });
        }
    }

    clear(): void {
        this.queue = [];
    }
}

export class MetricsCollector {
    private requestCount: number = 0;
    private responseTimes: number[] = [];
    private errors: Array<{ timestamp: number; error: string }> = [];
    private readonly maxErrors: number = 100;

    recordRequest(duration: number): void {
        this.requestCount++;
        this.responseTimes.push(duration);
        if (this.responseTimes.length > 1000) {
            this.responseTimes = this.responseTimes.slice(-1000);
        }
    }

    recordError(error: string): void {
        this.errors.push({
            timestamp: Date.now(),
            error
        });
        if (this.errors.length > this.maxErrors) {
            this.errors = this.errors.slice(-this.maxErrors);
        }
    }

    getStats() {
        const avgResponseTime = this.responseTimes.length > 0
            ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
            : 0;
        return {
            requestCount: this.requestCount,
            avgResponseTime,
            errorCount: this.errors.length,
            recentErrors: this.errors.slice(-10)
        };
    }

    reset(): void {
        this.requestCount = 0;
        this.responseTimes = [];
        this.errors = [];
    }
}

export class GramLangComponents {
    public packs: PackCache;
    public requestQueue: RequestQueue;
    public metrics: MetricsCollector;
    private context: PluginContext | undefined;
    private config: GramLangConfig | undefined;

    constructor(context?: PluginContext, config?: GramLangConfig) {
        this.context = context;
        this.config = config;
        this.packs = new PackCache();
        this.requestQueue = new RequestQueue();
        this.metrics = new MetricsCollector();
    }

    cleanup(): void {
        this.packs.clear();
        this.requestQueue.clear();
        this.metrics.reset();
    }
}
