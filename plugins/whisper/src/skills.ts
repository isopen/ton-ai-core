import { PluginContext } from '@ton-ai/core';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WhisperComponents } from './components';
import { isLoopback, parseServeTarget, serveArgs, ServeTarget } from './serve';
import {
    WhisperConfig,
    WhisperFileInput,
    WhisperJobOptions,
    WhisperProbeResult,
    WhisperTranscription
} from './types';

const DEFAULT_BINARY_PATH = 'whisper-cli';
const DEFAULT_FFMPEG_PATH = 'ffmpeg';
const DEFAULT_LANGUAGE = 'auto';
const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TMP_PREFIX = 'ton-ai-whisper';
const SERVER_LOG_NAME = 'whisper-server.log';
const SERVER_START_TIMEOUT_MS = 60000;
const SERVER_RESTART_COOLDOWN_MS = 10000;
const GPU_LAYERS_ARG = ['-ngl', '99'];
const STDOUT_TRIM_LIMIT = 20 * 1024 * 1024;

interface SpawnOutput {
    code: number | null;
    stdout: string;
    stderr: string;
}

interface WhisperJson {
    transcription_time?: number;
    result?: { language?: string };
    segments?: Array<{ start?: number; end?: number; text?: string }>;
}

interface ResolvedConfig {
    modelPath: string;
    binaryPath: string;
    ffmpegPath: string;
    language: string;
    threads: number;
    gpu: boolean;
    translate: boolean;
    prompt?: string;
    extraArgs: string[];
    maxConcurrent: number;
    timeoutMs: number;
    maxBytes: number;
    tmpPrefix: string;
    serverUrl?: string;
    serverBin?: string;
    autoServe: boolean;
}

export class WhisperSkills {
    private context: PluginContext;
    private components: WhisperComponents;
    private config: WhisperConfig;
    private resolved: ResolvedConfig;
    private ready: boolean = false;
    private readyWaiters: Array<() => void> = [];
    private serverProcess: childProcess.ChildProcess | null = null;
    private serverError: string | null = null;
    private serverExitCode: number | null = null;
    private ensureInFlight: Promise<boolean> | null = null;
    private lastServerStartAt = 0;

    constructor(context: PluginContext, components: WhisperComponents, config: WhisperConfig) {
        this.context = context;
        this.components = components;
        this.config = config;
        this.resolved = resolveConfig(config);
        this.components.requestQueue.setConcurrency(this.resolved.maxConcurrent);
    }

    isReady(): boolean {
        return this.ready && !!this.resolved.modelPath;
    }

    async waitForReady(timeout: number = 15000): Promise<void> {
        if (this.isReady()) return;

        try {
            await this.probe();
        } catch {
            this.ready = false;
        }

        if (this.isReady()) return;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.readyWaiters.indexOf(onReady);
                if (idx !== -1) this.readyWaiters.splice(idx, 1);
                reject(new Error('Whisper plugin not ready'));
            }, timeout);

            const onReady = () => {
                clearTimeout(timer);
                resolve();
            };
            this.readyWaiters.push(onReady);
        });
    }

    private notifyReady(): void {
        const waiters = this.readyWaiters.splice(0);
        for (const w of waiters) w();
    }

    updateConfig(config: WhisperConfig): void {
        const prevSources = `${this.resolved.binaryPath}|${this.resolved.modelPath}`;
        this.config = config;
        this.resolved = resolveConfig(config);
        this.components.requestQueue.setConcurrency(this.resolved.maxConcurrent);
        if (prevSources !== `${this.resolved.binaryPath}|${this.resolved.modelPath}`) {
            this.probe().catch((error) => {
                this.ready = false;
                this.context.logger.debug('Whisper re-probe failed:', errorText(error));
            });
        }
    }

    async probe(): Promise<WhisperProbeResult> {
        if (this.resolved.serverUrl) {
            const serverUrl = this.resolved.serverUrl;
            const ok = await this.ensureServer();
            if (ok && !this.ready) {
                this.ready = true;
                this.notifyReady();
            }
            if (!ok) {
                this.ready = false;
            }
            return {
                ok,
                binaryOk: ok,
                modelOk: ok,
                modelSizeBytes: 0,
                errors: ok ? undefined : [`whisper-server ${serverUrl} is not reachable`]
            };
        }
        const errors: string[] = [];
        let binaryOk = false;
        let modelOk = false;
        let modelSizeBytes = 0;

        try {
            await fs.promises.access(this.resolved.binaryPath, fs.constants.X_OK);
            binaryOk = true;
        } catch (error) {
            errors.push(`binary "${this.resolved.binaryPath}" is missing or not executable: ${errorText(error)}`);
        }

        try {
            const stat = await fs.promises.stat(this.resolved.modelPath);
            if (stat.size <= 0) {
                errors.push(`model "${this.resolved.modelPath}" is empty`);
            } else {
                modelOk = true;
                modelSizeBytes = stat.size;
            }
        } catch (error) {
            errors.push(`model "${this.resolved.modelPath}" is missing: ${errorText(error)}`);
        }

        const ok = binaryOk && modelOk;
        if (ok && !this.ready) {
            this.ready = true;
            this.notifyReady();
        }
        if (!ok) {
            this.ready = false;
        }

        return { ok, binaryOk, modelOk, modelSizeBytes, errors: ok ? undefined : errors };
    }

    async transcribeBuffer(input: WhisperFileInput, opts: WhisperJobOptions = {}): Promise<WhisperTranscription> {
        if (input.buffer.byteLength > this.resolved.maxBytes) {
            throw new Error(`audio input is too large: ${input.buffer.byteLength} bytes > max ${this.resolved.maxBytes}`);
        }
        if (input.buffer.byteLength <= 128) {
            throw new Error('audio input is empty or corrupted');
        }

        return this.components.requestQueue.add(async () => {
            const dir = await this.components.tempStore.createDir();
            const fileName = sanitizeFileName(input.filename) || extensionForMime(input.mime);
            const inputPath = await this.components.tempStore.writeFile(dir, fileName, input.buffer);
            return this.transcribePath(inputPath, opts, dir);
        });
    }

    async transcribeFile(filePath: string, opts: WhisperJobOptions = {}): Promise<WhisperTranscription> {
        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (!stat || stat.size <= 0) {
            throw new Error(`audio file is missing or empty: ${filePath}`);
        }
        if (stat.size > this.resolved.maxBytes) {
            throw new Error(`audio file is too large: ${stat.size} bytes > max ${this.resolved.maxBytes}`);
        }

        return this.components.requestQueue.add(() => this.transcribePath(filePath, opts, undefined));
    }

    private async transcribePath(
        inputPath: string,
        opts: WhisperJobOptions,
        ownDir?: string,
    ): Promise<WhisperTranscription> {
        const startedAt = Date.now();
        const dir = ownDir ?? (await this.components.tempStore.createDir());
        const baseName = (path.basename(inputPath).replace(/\.[^.]+$/, '') || 'audio').slice(0, 64);
        const wavPath = path.join(dir, `${baseName}_16k.wav`);
        const outBase = path.join(dir, `${baseName}_out`);
        const jsonPath = `${outBase}.json`;
        try {
            await this.convertToWav(inputPath, wavPath);
            const parsed = this.resolved.serverUrl
                ? await this.requestServer(wavPath, opts).catch(async (error) => {
                    this.context.logger.warn(
                        'whisper-server transcribe failed, falling back to CLI:',
                        error instanceof Error ? error.message : error,
                    );
                    const run = await this.runWhisper(wavPath, outBase, opts);
                    return this.readResult(jsonPath, run.stdout, opts);
                })
                : await (async () => {
                    const run = await this.runWhisper(wavPath, outBase, opts);
                    return this.readResult(jsonPath, run.stdout, opts);
                })();
            const text = parsed.text;
            const audioSec = parsed.audioSec;
            const processingMs = Date.now() - startedAt;
            this.components.metrics.recordRequest(processingMs, text.length, audioSec);
            return {
                text,
                language: parsed.language,
                audioSec,
                processingMs,
                model: path.basename(this.resolved.modelPath)
            };
        } catch (error) {
            this.components.metrics.recordError(errorText(error));
            throw error;
        } finally {
            await this.components.tempStore.remove(wavPath);
            await this.components.tempStore.remove(jsonPath);
            if (!ownDir) await this.components.tempStore.remove(dir);
        }
    }

    private async convertToWav(inputPath: string, wavPath: string): Promise<void> {
        const args = [
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            '-i', inputPath,
            '-ar', '16000',
            '-ac', '1',
            '-c:a', 'pcm_s16le',
            wavPath
        ];
        const run = await this.spawnProcess(this.resolved.ffmpegPath, args, this.resolved.timeoutMs);
        if (run.code !== 0) {
            throw new Error(`ffmpeg conversion failed (code ${run.code}): ${tail(run.stderr, 400)}`);
        }
        const wavStat = await fs.promises.stat(wavPath).catch(() => null);
        if (!wavStat || wavStat.size <= 44) {
            throw new Error(`ffmpeg produced an empty wav for ${path.basename(inputPath)}`);
        }
    }

    private async runWhisper(
        wavPath: string,
        outBase: string,
        opts: WhisperJobOptions,
    ): Promise<SpawnOutput> {
        const args: string[] = [
            '-m', this.resolved.modelPath,
            '-f', wavPath,
            '-l', opts.language ?? this.resolved.language,
            '-t', String(this.resolved.threads),
            ...((opts.translate ?? this.resolved.translate) ? ['--translate'] : []),
            ...((opts.prompt ?? this.resolved.prompt) ? ['--prompt', (opts.prompt ?? this.resolved.prompt) as string] : []),
            ...this.resolved.extraArgs,
            ...(opts.extraArgs ?? []),
            ...(this.resolved.gpu ? GPU_LAYERS_ARG : []),
            '-nt',
            '-oj',
            '-of', outBase
        ];
        const run = await this.spawnProcess(this.resolved.binaryPath, args, this.resolved.timeoutMs);
        if (run.code !== 0) {
            throw new Error(`whisper failed (code ${run.code}): ${tail(run.stderr, 400)}`);
        }
        return run;
    }

    private async readResult(
        jsonPath: string,
        stdout: string,
        opts: WhisperJobOptions,
    ): Promise<{ text: string; language: string; audioSec: number }> {
        const raw = await this.components.tempStore.readJson(jsonPath).catch(() => null);
        if (raw) {
            try {
                const json = JSON.parse(raw) as WhisperJson;
                const text = (json.segments ?? [])
                    .map((segment) => segment.text ?? '')
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (text.length > 0) {
                    return {
                        text,
                        language: json.result?.language ?? this.fallbackLanguage(opts),
                        audioSec: json.segments?.length ? Number(json.segments[json.segments.length - 1].end ?? 0) : 0
                    };
                }
            } catch {
                this.context.logger.debug('Whisper result json is malformed, falling back to stdout');
            }
        }
        const text = fallbackText(stdout);
        if (text.length === 0) {
            throw new Error('whisper produced no transcript');
        }
        return { text, language: this.fallbackLanguage(opts), audioSec: 0 };
    }

    private fallbackLanguage(opts: WhisperJobOptions): string {
        const language = opts.language ?? this.resolved.language;
        return language === 'auto' ? 'unknown' : language;
    }

    async ensureServer(startTimeoutMs: number = SERVER_START_TIMEOUT_MS): Promise<boolean> {
        if (this.ensureInFlight) return this.ensureInFlight;
        const run = this.ensureServerInternal(startTimeoutMs);
        this.ensureInFlight = run;
        try {
            return await run;
        } finally {
            this.ensureInFlight = null;
        }
    }

    private async serverReachable(timeoutMs: number = 2000): Promise<boolean> {
        const serverUrl = this.resolved.serverUrl;
        if (!serverUrl) return false;
        try {
            await fetch(serverUrl, { signal: AbortSignal.timeout(timeoutMs) });
            return true;
        } catch {
            return false;
        }
    }

    private async ensureServerInternal(startTimeoutMs: number): Promise<boolean> {
        const serverUrl = this.resolved.serverUrl;
        if (!serverUrl) return false;
        if (await this.serverReachable()) return true;
        if (!this.resolved.autoServe) {
            this.context.logger.warn(
                `whisper-server ${serverUrl} is unreachable and auto-start is off (DUREVCODE_WHISPER_AUTO_SERVE)`,
            );
            return false;
        }
        if (Date.now() - this.lastServerStartAt < SERVER_RESTART_COOLDOWN_MS) {
            this.context.logger.warn(`whisper-server ${serverUrl} was (re)started recently, waiting for the next probe`);
            return false;
        }
        const target = parseServeTarget(serverUrl);
        if (!target || !isLoopback(target.hostname)) {
            this.context.logger.warn(`whisper-server ${serverUrl} is not a local address, auto-start is skipped; start it manually`);
            return false;
        }
        const binPath = this.serverBinPath();
        if (!binPath) return false;
        if (!fs.existsSync(this.resolved.modelPath)) {
            this.context.logger.warn(`whisper model "${this.resolved.modelPath}" is missing, cannot auto-start whisper-server`);
            return false;
        }
        try {
            this.startServer(binPath, target);
        } catch (error) {
            this.context.logger.warn('whisper-server failed to start:', error instanceof Error ? error.message : error);
            return false;
        }
        const deadline = Date.now() + startTimeoutMs;
        while (Date.now() < deadline) {
            if (await this.serverReachable()) {
                this.context.logger.info(`whisper-server started at ${serverUrl} (resident, log ${this.serverLogPath()})`);
                return true;
            }
            if (this.serverError !== null || this.serverExitCode !== null) break;
            await delay(500);
        }
        this.context.logger.warn(
            `whisper-server did not respond at ${serverUrl}` +
            (this.serverError ? `: ${this.serverError}` : '') +
            (this.serverExitCode !== null ? ` (exit ${this.serverExitCode})` : ''),
        );
        return false;
    }

    private serverBinPath(): string | null {
        const binPath = this.resolved.serverBin
            ?? path.join(path.dirname(this.resolved.binaryPath), 'whisper-server');
        try {
            fs.accessSync(binPath, fs.constants.X_OK);
        } catch {
            this.context.logger.warn(
                `whisper-server binary "${binPath}" is missing or not executable; set DUREVCODE_WHISPER_SERVER_BIN or start it manually`,
            );
            return null;
        }
        return binPath;
    }

    private serverLogPath(): string {
        return path.join(path.dirname(this.resolved.modelPath), SERVER_LOG_NAME);
    }

    private startServer(binPath: string, target: ServeTarget): void {
        this.serverProcess = null;
        this.serverError = null;
        this.serverExitCode = null;
        const args = serveArgs(target, {
            modelPath: this.resolved.modelPath,
            threads: this.resolved.threads,
            language: this.resolved.language,
        });
        const logPath = this.serverLogPath();
        this.context.logger.info(`starting whisper-server: ${binPath} ${args.join(' ')}`);
        let logFd: number;
        try {
            logFd = fs.openSync(logPath, 'a');
        } catch {
            logFd = fs.openSync(os.devNull, 'a');
        }
        try {
            const child = childProcess.spawn(binPath, args, { detached: true, stdio: ['ignore', logFd, logFd] });
            child.on('error', (cause: unknown) => {
                this.serverError = cause instanceof Error ? cause.message : String(cause);
            });
            child.on('exit', (code: unknown) => {
                this.serverExitCode = typeof code === 'number' ? code : 0;
            });
            child.unref();
            this.serverProcess = child;
            this.lastServerStartAt = Date.now();
        } finally {
            fs.closeSync(logFd);
        }
    }

    private async requestServer(
        wavPath: string,
        opts: WhisperJobOptions,
    ): Promise<{ text: string; language: string; audioSec: number }> {
        const url = `${this.resolved.serverUrl}/inference`;
        const formData = new FormData();
        formData.append('file', new Blob([await fs.promises.readFile(wavPath)], { type: 'audio/wav' }), 'audio.wav');
        formData.append('response_format', 'verbose_json');
        const language = opts.language ?? this.resolved.language;
        formData.append('language', language);
        let body: unknown;
        try {
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                signal: AbortSignal.timeout(this.resolved.timeoutMs),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            body = await response.json();
        } catch (error) {
            throw new Error(`whisper-server request failed: ${errorText(error)}`);
        }
        const serverJson = body as { text?: unknown; language?: unknown; segments?: Array<{ text?: unknown; end?: unknown }> };
        let text = typeof serverJson.text === 'string' ? serverJson.text : '';
        if (typeof text !== 'string' || text.trim().length === 0) {
            text = (serverJson.segments ?? [])
                .map((segment) => typeof segment.text === 'string' ? segment.text : '')
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
        let audioSec = 0;
        for (const segment of serverJson.segments ?? []) {
            if (typeof segment.end === 'number') audioSec = Math.max(audioSec, segment.end);
        }
        if (text.trim().length === 0) {
            throw new Error('whisper-server produced no transcript');
        }
        return {
            text: text.trim(),
            language: typeof serverJson.language === 'string' ? serverJson.language : this.fallbackLanguage(opts),
            audioSec
        };
    }

    private spawnProcess(command: string, args: string[], timeoutMs: number): Promise<SpawnOutput> {
        return new Promise((resolve, reject) => {
            const child = childProcess.spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            let settled = false;

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                child.kill('SIGTERM');
                reject(new Error(`process "${path.basename(command)}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            child.stdout?.on('data', (chunk: Buffer | string) => {
                if (stdout.length < STDOUT_TRIM_LIMIT) stdout += chunk.toString();
            });
            child.stderr?.on('data', (chunk: Buffer | string) => {
                if (stderr.length < STDOUT_TRIM_LIMIT) stderr += chunk.toString();
            });
            child.on('error', (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(new Error(`spawn "${path.basename(command)}" failed: ${errorText(error)}`));
            });
            child.on('close', (code) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ code, stdout, stderr });
            });
        });
    }
}

function resolveConfig(config: WhisperConfig): ResolvedConfig {
    return {
        modelPath: config.modelPath,
        binaryPath: config.binaryPath ?? DEFAULT_BINARY_PATH,
        ffmpegPath: config.ffmpegPath ?? DEFAULT_FFMPEG_PATH,
        language: config.language ?? DEFAULT_LANGUAGE,
        threads: config.threads ?? whisperThreadDefault(),
        gpu: config.gpu ?? false,
        translate: config.translate ?? false,
        prompt: config.prompt,
        extraArgs: config.extraArgs ?? [],
        maxConcurrent: config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
        timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBytes: config.maxBytes ?? DEFAULT_MAX_BYTES,
        tmpPrefix: config.tmpPrefix ?? DEFAULT_TMP_PREFIX,
        serverUrl: config.serverUrl ? config.serverUrl.replace(/\/+$/, '') : undefined,
        serverBin: config.serverBin,
        autoServe: config.autoServe !== false
    };
}

function whisperThreadDefault(): number {
    const cpus = os.cpus().length;
    return Math.max(1, Math.min(8, cpus - 2));
}

function sanitizeFileName(raw?: string): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    return trimmed.replace(/[^\w.\-]+/g, '_').slice(0, 80);
}

function extensionForMime(mime?: string): string {
    if (!mime) return 'voice.ogg';
    if (mime.includes('ogg') || mime.includes('opus')) return 'voice.ogg';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'voice.mp3';
    if (mime.includes('wav') || mime.includes('wave')) return 'voice.wav';
    if (mime.includes('flac')) return 'voice.flac';
    if (mime.includes('mp4') || mime.includes('m4a')) return 'voice.m4a';
    return 'voice.ogg';
}

function fallbackText(stdout: string): string {
    const lines = stdout
        .split('\n')
        .map((line) => line.replace(/\[(?:\d+:)?\d{2}:\d{2}(?:[.,]\d+)? *--> *(?:\d+:)?\d{2}:\d{2}(?:[.,]\d+)?\] */g, ''))
        .filter((line) => {
            const trimmed = line.trim();
            return trimmed.length > 0
                && !trimmed.startsWith('whisper_')
                && !trimmed.startsWith('system_info')
                && !trimmed.includes('main : processing');
        });
    return lines.join('\n').replace(/\s+/g, ' ').trim();
}

function tail(raw: string, limit: number): string {
    return raw.length > limit ? raw.slice(-limit) : raw;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (typeof timer.unref === 'function') timer.unref();
    });
}
