import { BasePlugin } from '@ton-ai/core';
import { WhisperComponents } from './components';
import { WhisperSkills } from './skills';
import {
    WhisperConfig,
    WhisperFileInput,
    WhisperJobOptions,
    WhisperProbeResult,
    WhisperTranscription
} from './types';

export * from './components';
export * from './skills';
export * from './types';

export class WhisperPlugin extends BasePlugin<WhisperConfig> {
    readonly metadata = {
        name: 'whisper',
        version: '0.1.0',
        description: 'Whisper.cpp speech-to-text integration for TON AI Core',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: WhisperComponents;
    private skills!: WhisperSkills;

    protected async onInit() {
        this.logger.info('Initializing Whisper plugin...');

        if (!this.config.modelPath) {
            throw new Error('Whisper requires modelPath (a GGML model for whisper.cpp)');
        }

        this.components = new WhisperComponents(
            this.context,
            Number(this.config.maxConcurrent ?? 1),
            String(this.config.tmpPrefix ?? 'ton-ai-whisper')
        );
        this.skills = new WhisperSkills(this.context, this.components, this.config);
        this.logger.info('Whisper plugin initialized');
    }

    async onActivate() {
        this.logger.info('Whisper plugin activated');
        const probe = await this.skills.probe();
        if (!probe.ok) {
            this.logger.warn('Whisper probe failed:', (probe.errors ?? []).join('; '));
            this.logger.warn(
                'Provide a compiled whisper.cpp binary (binaryPath) and a GGML model (modelPath); ffmpeg is required for non-wav inputs.'
            );
        }
        this.events.emit('whisper:ready');
    }

    async onDeactivate() {
        this.logger.info('Whisper plugin deactivated');
        this.components.cleanup();
        this.events.emit('whisper:deactivated');
    }

    async shutdown() {
        this.logger.info('Whisper plugin shutting down...');
        this.components.cleanup();
        this.initialized = false;
    }

    async onConfigChange(newConfig: Record<string, any>) {
        this.config = { ...this.config, ...newConfig };
        this.logger.info('Whisper config updated');
        this.skills.updateConfig(this.config);
        this.events.emit('whisper:config:updated');
    }

    async applySettings(patch: Partial<WhisperConfig>): Promise<void> {
        this.checkInitialized();
        this.config = { ...this.config, ...patch };
        this.skills.updateConfig(this.config);
        this.events.emit('whisper:config:updated');
    }

    async probe(): Promise<WhisperProbeResult> {
        this.checkInitialized();
        return this.skills.probe();
    }

    async transcribeBuffer(input: WhisperFileInput, opts?: WhisperJobOptions): Promise<WhisperTranscription> {
        this.checkInitialized();
        return this.skills.transcribeBuffer(input, opts);
    }

    async transcribeFile(filePath: string, opts?: WhisperJobOptions): Promise<WhisperTranscription> {
        this.checkInitialized();
        return this.skills.transcribeFile(filePath, opts);
    }

    isReady(): boolean {
        return this.skills?.isReady() || false;
    }

    getMetrics() {
        this.checkInitialized();
        return this.components.metrics.getStats();
    }

    resetMetrics(): void {
        this.checkInitialized();
        this.components.metrics.reset();
    }
}
