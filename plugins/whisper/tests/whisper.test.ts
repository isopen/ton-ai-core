import { spawn } from 'child_process';

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WhisperPlugin } from '../src';
import { WhisperConfig } from '../src/types';

const spawnMock = spawn as unknown as jest.Mock;

const OGG_BYTES = Buffer.alloc(2048, 7);
const WAV_BYTES = Buffer.alloc(2048, 1);

const RESULT_JSON = {
    transcription_time: 0.35,
    result: { language: 'ru' },
    segments: [
        { start: 0.0, end: 2.1, text: ' Привет,' },
        { start: 2.1, end: 3.4, text: ' как дела?' }
    ]
};

interface FakeContext {
    logger: Record<string, (...args: unknown[]) => void>;
    events: { emit: (event: string, ...args: unknown[]) => boolean };
    config: Record<string, unknown>;
}

function createContext(config: Partial<WhisperConfig>): FakeContext {
    return {
        logger: {
            info: () => undefined,
            error: () => undefined,
            warn: () => undefined,
            debug: () => undefined
        },
        events: { emit: () => true },
        config: config as Record<string, unknown>
    };
}

async function makeFixture(): Promise<{ root: string; modelPath: string; binaryPath: string; inputOgg: string }> {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'whisper-test-'));
    const modelPath = path.join(root, 'ggml-model.bin');
    const binaryPath = path.join(root, 'whisper-cli');
    const inputOgg = path.join(root, 'voice.ogg');
    await fs.promises.writeFile(modelPath, OGG_BYTES);
    await fs.promises.writeFile(binaryPath, OGG_BYTES);
    await fs.promises.chmod(binaryPath, 0o755);
    await fs.promises.writeFile(inputOgg, OGG_BYTES);
    return { root, modelPath, binaryPath, inputOgg };
}

function baseConfig(fixture: { modelPath: string; binaryPath: string }, extra: Partial<WhisperConfig> = {}): WhisperConfig {
    return {
        binaryPath: fixture.binaryPath,
        modelPath: fixture.modelPath,
        ffmpegPath: 'ffmpeg',
        language: 'auto',
        threads: 2,
        gpu: false,
        translate: false,
        maxConcurrent: 1,
        timeoutMs: 30000,
        maxBytes: 25 * 1024 * 1024,
        tmpPrefix: 'whisper-test',
        ...extra
    };
}

type Listener = (...args: unknown[]) => void;

interface FakeChild {
    stdout: { on: (event: string, listener: Listener) => void };
    stderr: { on: (event: string, listener: Listener) => void };
    on: (event: string, listener: Listener) => void;
    kill: jest.Mock;
    unref: () => void;
}

interface StagePlan {
    closeCode?: number;
    stderr?: string;
    skipOutJson?: boolean;
    leaveWavEmpty?: boolean;
    delayMs?: number;
}

interface SpawnPlan {
    ffmpeg?: StagePlan;
    whisper?: StagePlan;
}

function installSpawn(plan: SpawnPlan, calls: Array<{ command: string; args: string[] }>): void {
    spawnMock.mockImplementation((command: string, args: string[]) => {
        calls.push({ command, args });
        const eventHandlers = new Map<string, Listener[]>();
        const fire = (event: string, payload?: unknown) => {
            for (const listener of [...(eventHandlers.get(event) ?? [])]) listener(payload);
        };
        const child: FakeChild = {
            stdout: { on: (event, listener) => pushListener(eventHandlers, event, listener) },
            stderr: { on: (event, listener) => pushListener(eventHandlers, event, listener) },
            on: (event, listener) => pushListener(eventHandlers, event, listener),
            kill: jest.fn(),
            unref: () => undefined
        };

        const isServer = /whisper-server/.test(path.basename(command));
        const isWhisper = /whisper/.test(path.basename(command));

        if (!isServer) {
            const act = () => {
                const stage = isWhisper ? plan.whisper ?? {} : plan.ffmpeg ?? {};
                if (!isWhisper && !stage.leaveWavEmpty) {
                    const wavPath = args[args.indexOf('-c:a') + 2];
                    fs.writeFileSync(wavPath, WAV_BYTES);
                }
                if (isWhisper && stage.skipOutJson !== true && args.includes('-of')) {
                    const outBase = args[args.indexOf('-of') + 1];
                    fs.writeFileSync(`${outBase}.json`, JSON.stringify(RESULT_JSON));
                }
                if (isWhisper && stage.stderr) fire('stderr', Buffer.from(stage.stderr));
                const finish = () => {
                    fire('close', stage.closeCode ?? 0);
                };
                if (stage.delayMs) setTimeout(finish, stage.delayMs);
                else finish();
            };
            setTimeout(act, 0);
        }
        return child as unknown as ReturnType<typeof spawn>;
    });
}

function pushListener(map: Map<string, Listener[]>, event: string, listener: Listener): void {
    const list = map.get(event) ?? [];
    list.push(listener);
    map.set(event, list);
}

let fixtures: Awaited<ReturnType<typeof makeFixture>>;

beforeAll(async () => {
    fixtures = await makeFixture();
});

afterAll(async () => {
    await fs.promises.rm(fixtures.root, { recursive: true, force: true });
});

beforeEach(() => {
    spawnMock.mockReset();
});

async function runPlugin(config: WhisperConfig): Promise<{ plugin: WhisperPlugin; context: FakeContext }> {
    const context = createContext(config);
    const plugin = new WhisperPlugin();
    await plugin.initialize(context as unknown as Parameters<WhisperPlugin['initialize']>[0]);
    await plugin.onActivate();
    return { plugin, context };
}

describe('Whisper plugin', () => {
    test('probe fails with a clear error list when the model is missing', async () => {
        const { plugin } = await runPlugin(baseConfig(fixtures, {
            modelPath: path.join(fixtures.root, 'nope.bin')
        }));
        const probe = await plugin.probe();
        expect(probe.ok).toBe(false);
        expect(probe.modelOk).toBe(false);
        expect(probe.binaryOk).toBe(true);
        expect((probe.errors ?? []).join(' ')).toContain('model');
        expect(plugin.isReady()).toBe(false);
    });

    test('serverUrl mode posts the wav to the HTTP server and skips the whisper spawn', async () => {
        const { plugin } = await runPlugin(baseConfig(fixtures, {
            serverUrl: 'http://127.0.0.1:8178'
        }));
        const calls: Array<{ command: string; args: string[] }> = [];
        installSpawn({ ffmpeg: {} }, calls);
        const SERVER_JSON = {
            text: ' Привет, как дела? ',
            language: 'ru',
            segments: [
                { start: 0.0, end: 4.1, text: ' Привет,' },
                { start: 4.1, end: 5.5, text: ' как дела?' }
            ]
        };
        const originalFetch = globalThis.fetch;
        const fetchMock = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => SERVER_JSON
        })) as unknown as jest.Mock;
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        try {
            const result = await plugin.transcribeFile(fixtures.inputOgg, {});
            expect(result.text).toBe('Привет, как дела?');
            expect(result.audioSec).toBe(5.5);
            expect(result.language).toBe('ru');
            expect(fetchMock.mock.calls.length).toBe(1);
            expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:8178/inference');
            expect(calls.filter((call) => /whisper/.test(path.basename(call.command)))).toHaveLength(0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('probe auto-starts a local whisper-server that is unreachable', async () => {
        const serverBin = path.join(fixtures.root, 'whisper-server-mock');
        fs.writeFileSync(serverBin, '#!/bin/sh\n', { mode: 0o755 });
        const { plugin } = await runPlugin(baseConfig(fixtures, {
            serverUrl: 'http://127.0.0.1:8178',
            serverBin
        }));
        const calls: Array<{ command: string; args: string[] }> = [];
        installSpawn({}, calls);
        const realFetch = globalThis.fetch;
        let reachable = false;
        globalThis.fetch = (async () => {
            if (!reachable) throw new Error('refused');
            return { ok: true, status: 200 };
        }) as unknown as typeof fetch;
        try {
            const pending = plugin.probe();
            reachable = true;
            const result = await pending;
            expect(result.ok).toBe(true);
            expect(plugin.isReady()).toBe(true);
            const serverCall = calls.find((call) => /whisper-server/.test(path.basename(call.command)));
            expect(serverCall?.args).toEqual([
                '-m', fixtures.modelPath,
                '-t', '2',
                '-l', 'auto',
                '--port', '8178'
            ]);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test('autoServe off leaves the unreachable server alone', async () => {
        const { plugin } = await runPlugin(baseConfig(fixtures, {
            serverUrl: 'http://127.0.0.1:8178',
            autoServe: false
        }));
        const calls: Array<{ command: string; args: string[] }> = [];
        installSpawn({}, calls);
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            throw new Error('refused');
        }) as unknown as typeof fetch;
        try {
            const result = await plugin.probe();
            expect(result.ok).toBe(false);
            expect(calls).toHaveLength(0);
            expect(plugin.isReady()).toBe(false);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test('transcribe falls back to CLI when the whisper-server request fails', async () => {
        const { plugin } = await runPlugin(baseConfig(fixtures, {
            serverUrl: 'http://127.0.0.1:8178'
        }));
        const calls: Array<{ command: string; args: string[] }> = [];
        installSpawn({ ffmpeg: {}, whisper: {} }, calls);
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            throw new Error('refused');
        }) as unknown as typeof fetch;
        try {
            const result = await plugin.transcribeFile(fixtures.inputOgg, {});
            expect(result.text).toBe('Привет, как дела?');
            expect(result.language).toBe('ru');
            expect(calls.filter((call) => /whisper/.test(path.basename(call.command)))).toHaveLength(1);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    test('transcribeBuffer converts, runs the binary and returns parsed text', async () => {
        const calls: Array<{ command: string; args: string[] }> = [];
        installSpawn({ whisper: {} }, calls);
        const { plugin } = await runPlugin(baseConfig(fixtures));

        const result = await plugin.transcribeBuffer({ buffer: OGG_BYTES, filename: 'voice message.ogg' });

        expect(result.text).toBe('Привет, как дела?');
        expect(result.language).toBe('ru');
        expect(result.audioSec).toBeCloseTo(3.4, 5);
        expect(result.model).toBe('ggml-model.bin');

        expect(calls).toHaveLength(2);
        expect(path.basename(calls[0].command)).toBe('ffmpeg');
        expect(calls[0].args).toEqual(expect.arrayContaining(['-ar', '16000', '-ac', '1']));
        const whisperArgs = calls[1].args;
        expect(calls[1].args[0]).toBe('-m');
        expect(calls[1].args[1]).toBe(fixtures.modelPath);
        expect(whisperArgs).toEqual(expect.arrayContaining(['-oj', '-nt']));
        expect(whisperArgs).not.toEqual(expect.arrayContaining(['-ngl']));
        expect(plugin.getMetrics().requestCount).toBe(1);
        expect(plugin.getMetrics().charUsage.total).toBe(result.text.length);
    });

    test('gpu flag offloads layers and translate and language overrides reach the binary', async () => {
        const calls: Array<{ command: string; args: string[] }> = [];
        installSpawn({ whisper: {} }, calls);
        const { plugin } = await runPlugin(baseConfig(fixtures, { gpu: true, translate: true, language: 'ru' }));

        await plugin.transcribeBuffer({ buffer: OGG_BYTES }, { language: 'en' });

        const whisperArgs = calls[1].args;
        expect(whisperArgs).toEqual(expect.arrayContaining(['-ngl', '99']));
        expect(whisperArgs).toEqual(expect.arrayContaining(['--translate']));
        expect(whisperArgs).toEqual(expect.arrayContaining(['-l', 'en']));
    });

    test('whisper failure surfaces the stderr tail', async () => {
        installSpawn({ whisper: { closeCode: 1, stderr: 'wtf_loadback' } }, []);
        const { plugin } = await runPlugin(baseConfig(fixtures));
        await expect(plugin.transcribeBuffer({ buffer: OGG_BYTES })).rejects.toThrow('whisper failed');
        expect(plugin.getMetrics().errorCount).toBe(1);
    });

    test('a runaway process is killed on timeout', async () => {
        const children: Array<{ kill: jest.Mock }> = [];
        spawnMock.mockImplementation((_command: string, _args: string[]) => {
            const listeners = new Map<string, Listener[]>();
            const child: FakeChild = {
                stdout: { on: (event, listener) => pushListener(listeners, event, listener) },
                stderr: { on: (event, listener) => pushListener(listeners, event, listener) },
                on: (event, listener) => pushListener(listeners, event, listener),
                kill: jest.fn()
            };
            children.push(child);
            return child as unknown as ReturnType<typeof spawn>;
        });
        const { plugin } = await runPlugin(baseConfig(fixtures, { timeoutMs: 40 }));
        await expect(plugin.transcribeBuffer({ buffer: OGG_BYTES })).rejects.toThrow('timed out');
        expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    test('ffmpeg failure prevents the whisper run', async () => {
        installSpawn({ ffmpeg: { closeCode: 3, stderr: 'Invalid data found' } }, []);
        const { plugin } = await runPlugin(baseConfig(fixtures));
        await expect(plugin.transcribeFile(fixtures.inputOgg)).rejects.toThrow('ffmpeg conversion failed');
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    test('jobs run sequentially with maxConcurrent 1', async () => {
        const calls: Array<{ command: string; args: string[] }> = [];
        installSpawn({ whisper: { delayMs: 10 } }, calls);
        const { plugin } = await runPlugin(baseConfig(fixtures, { maxConcurrent: 1 }));

        const first = plugin.transcribeBuffer({ buffer: OGG_BYTES, filename: 'a.ogg' });
        const second = plugin.transcribeBuffer({ buffer: OGG_BYTES, filename: 'b.ogg' });
        const results = await Promise.all([first, second]);

        expect(results).toHaveLength(2);
        expect(results[0].text).toBe('Привет, как дела?');
        expect(calls).toHaveLength(4);
        const kinds = calls.map((call) => (/whisper/.test(path.basename(call.command)) ? 'whisper' : 'ffmpeg'));
        expect(kinds.join(' ')).toBe('ffmpeg whisper ffmpeg whisper');
    });
});
