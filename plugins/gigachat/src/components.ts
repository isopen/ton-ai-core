import { PluginContext } from '@ton-ai/core';
import * as crypto from 'crypto';

export class TokenCache {
    private accessToken: string | null = null;
    private expiresAt: number = 0;
    private readonly bufferTime: number = 60;

    setToken(token: string, expiresIn: number): void {
        this.accessToken = token;
        this.expiresAt = Date.now() + (expiresIn - this.bufferTime) * 1000;
    }

    getToken(): string | null {
        if (this.accessToken && Date.now() < this.expiresAt) {
            return this.accessToken;
        }
        return null;
    }

    isExpired(): boolean {
        return !this.accessToken || Date.now() >= this.expiresAt;
    }

    clear(): void {
        this.accessToken = null;
        this.expiresAt = 0;
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
            this.process();
        });
    }

    private async process(): Promise<void> {
        if (this.processing || this.activeCount >= this.maxConcurrent) return;

        this.processing = true;

        while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
            const task = this.queue.shift();
            if (task) {
                this.activeCount++;
                try {
                    await task();
                } catch (error) {
                    console.error('Task failed:', error);
                } finally {
                    this.activeCount--;
                }
            }
        }

        this.processing = false;

        if (this.queue.length > 0) {
            this.process();
        }
    }

    clear(): void {
        this.queue = [];
    }
}

export class MetricsCollector {
    private requestCount: number = 0;
    private tokenUsage: { prompt: number; completion: number; total: number } = {
        prompt: 0,
        completion: 0,
        total: 0
    };
    private responseTimes: number[] = [];
    private errors: Array<{ timestamp: number; error: string }> = [];
    private readonly maxErrors: number = 100;

    recordRequest(duration: number, tokens?: { prompt: number; completion: number }): void {
        this.requestCount++;
        this.responseTimes.push(duration);

        if (tokens) {
            this.tokenUsage.prompt += tokens.prompt;
            this.tokenUsage.completion += tokens.completion;
            this.tokenUsage.total += tokens.prompt + tokens.completion;
        }

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
            tokenUsage: { ...this.tokenUsage },
            avgResponseTime,
            errorCount: this.errors.length,
            recentErrors: this.errors.slice(-10)
        };
    }

    reset(): void {
        this.requestCount = 0;
        this.tokenUsage = { prompt: 0, completion: 0, total: 0 };
        this.responseTimes = [];
        this.errors = [];
    }
}

export class GigaChatComponents {
    public tokenCache: TokenCache;
    public requestQueue: RequestQueue;
    public metrics: MetricsCollector;
    private context: PluginContext;

    constructor(context: PluginContext) {
        this.context = context;
        this.tokenCache = new TokenCache();
        this.requestQueue = new RequestQueue();
        this.metrics = new MetricsCollector();
    }

    generateRqUID(): string {
        return crypto.randomUUID();
    }

    cleanup(): void {
        this.tokenCache.clear();
        this.requestQueue.clear();
        this.metrics.reset();
    }
}
