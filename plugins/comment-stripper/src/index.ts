import { BasePlugin } from '@ton-ai/core';
import * as fs from 'fs';
import { CommentStripperEngine } from './components';
import { CommentStripperSkills } from './skills';
import { CommentStripperConfig, StripOptions, StripTextResult, StripFileResult, StripBatchResult } from './types';

export * from './components';
export * from './skills';
export * from './types';

const defaultEngine = new CommentStripperEngine();

export function detectLanguage(filename: string): string | null {
    return defaultEngine.detectLanguage(filename);
}

export function stripCommentsText(text: string, lang: string, opts?: StripOptions): StripTextResult {
    return defaultEngine.stripText(text, lang, opts);
}

export function stripFile(file: string, opts?: StripOptions): StripFileResult {
    return defaultEngine.stripFile(file, opts);
}

export function stripPaths(paths: string[], opts?: StripOptions): StripBatchResult {
    return defaultEngine.stripPaths(paths, opts);
}

export function gitChangedFiles(cwd?: string): string[] {
    return defaultEngine.gitChangedFiles(cwd);
}

export class CommentStripperPlugin extends BasePlugin<CommentStripperConfig> {
    readonly metadata = {
        name: 'comment-stripper',
        version: '0.1.0',
        description: 'Universal comment stripper for any programming language',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: CommentStripperEngine;
    private skills!: CommentStripperSkills;

    protected async onInit(): Promise<void> {
        if (this.config.verbose) {
            this.logger.info('comment-stripper plugin initialized (ts/js via AST, all others via tokenizer)');
        }
        this.components = new CommentStripperEngine({ keepSingleBlank: this.config.keepSingleBlank });
        this.skills = new CommentStripperSkills(this.context, this.components, this.config);
    }

    async onActivate(): Promise<void> {
        this.events.emit('comment-stripper:ready');
    }

    async onDeactivate(): Promise<void> {
        this.events.emit('comment-stripper:deactivated');
    }

    async onConfigChange(newConfig: Record<string, any>): Promise<void> {
        this.config = { ...this.config, ...newConfig };
        this.skills?.updateConfig(newConfig);
        this.components = new CommentStripperEngine({ keepSingleBlank: this.config.keepSingleBlank });
    }

    isReady(): boolean {
        return this.skills?.isReady() || false;
    }

    stripText(text: string, lang: string, opts?: StripOptions): StripTextResult {
        return this.skills.stripText(text, lang, opts);
    }

    stripFile(file: string, opts?: StripOptions): StripFileResult {
        return this.skills.stripFile(file, opts);
    }

    stripPaths(paths: string[], opts?: StripOptions): StripBatchResult {
        return this.skills.stripPaths(paths, opts);
    }

    stripGitDirty(cwd?: string): StripBatchResult {
        return this.skills.stripGitDirty(cwd);
    }

    watch(dir: string, onStripped?: (file: string, comments: number) => void): fs.FSWatcher {
        return this.skills.watch(dir, onStripped);
    }
}
