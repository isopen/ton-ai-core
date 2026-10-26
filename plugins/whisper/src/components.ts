import { PluginContext } from '@ton-ai/core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class AudioJobQueue {
    private queue: Array<() => Promise<unknown>> = [];
    private processing: boolean = false;
    private maxConcurrent: number;
    private activeCount: number = 0;

    constructor(maxConcurrent: number = 1) {
        this.maxConcurrent = Math.max(1, maxConcurrent);
    }

    async add<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    resolve(await task());
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

    setConcurrency(maxConcurrent: number): void {
        this.maxConcurrent = Math.max(1, maxConcurrent);
        this.drain();
    }

    get inflight(): number {
        return this.activeCount + this.queue.length;
    }

    clear(): void {
        this.queue = [];
    }
}

export class TranscriptionMetrics {
    private requestCount: number = 0;
    private charUsage: { text: number; total: number } = { text: 0, total: 0 };
    private audioSec: number = 0;
    private responseTimes: number[] = [];
    private errors: Array<{ timestamp: number; error: string }> = [];
    private readonly maxErrors: number = 100;

    recordRequest(durationMs: number, charsTranscribed: number, audioSec: number): void {
        this.requestCount++;
        this.responseTimes.push(durationMs);
        this.charUsage.text += charsTranscribed;
        this.charUsage.total += charsTranscribed;
        this.audioSec += audioSec;

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
            charUsage: { ...this.charUsage },
            audioSec: this.audioSec,
            avgResponseTime,
            errorCount: this.errors.length,
            recentErrors: this.errors.slice(-10)
        };
    }

    reset(): void {
        this.requestCount = 0;
        this.charUsage = { text: 0, total: 0 };
        this.audioSec = 0;
        this.responseTimes = [];
        this.errors = [];
    }
}

export class TempStore {
    private dirs: string[] = [];
    private context: PluginContext;

    constructor(context: PluginContext, private prefix: string = 'ton-ai-whisper') {
        this.context = context;
    }

    async createDir(): Promise<string> {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${this.prefix}-`));
        this.dirs.push(dir);
        return dir;
    }

    async writeFile(dir: string, name: string, data: Buffer | string): Promise<string> {
        const filePath = path.join(dir, name);
        await fs.promises.writeFile(filePath, data);
        return filePath;
    }

    async readJson(filePath: string): Promise<string | null> {
        try {
            return await fs.promises.readFile(filePath, 'utf8');
        } catch {
            return null;
        }
    }

    async remove(filePath: string): Promise<void> {
        try {
            await fs.promises.rm(filePath, { force: true });
        } catch (error) {
            this.context.logger.debug('TempStore remove failed:', String(error));
        }
    }

    cleanup(): void {
        for (const dir of this.dirs.splice(0)) {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch (error) {
                this.context.logger.debug('TempStore cleanup failed:', String(error));
            }
        }
    }
}

export class WhisperComponents {
    public tempStore: TempStore;
    public requestQueue: AudioJobQueue;
    public metrics: TranscriptionMetrics;
    private context: PluginContext;

    constructor(context: PluginContext, maxConcurrent: number = 1, tmpPrefix: string = 'ton-ai-whisper') {
        this.context = context;
        this.tempStore = new TempStore(context, tmpPrefix);
        this.requestQueue = new AudioJobQueue(maxConcurrent);
        this.metrics = new TranscriptionMetrics();
    }

    cleanup(): void {
        this.tempStore.cleanup();
        this.requestQueue.clear();
        this.metrics.reset();
    }
}
