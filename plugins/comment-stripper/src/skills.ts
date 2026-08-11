import { PluginContext } from '@ton-ai/core';
import * as fs from 'fs';
import * as path from 'path';
import { CommentStripperEngine } from './components';
import { CommentStripperConfig, StripOptions, StripTextResult, StripFileResult, StripBatchResult } from './types';

export class CommentStripperSkills {
    private context: PluginContext;
    private engine: CommentStripperEngine;
    private config: CommentStripperConfig;

    constructor(context: PluginContext, engine: CommentStripperEngine, config: CommentStripperConfig = {}) {
        this.context = context;
        this.engine = engine;
        this.config = config;
    }

    isReady(): boolean {
        return true;
    }

    updateConfig(config: Partial<CommentStripperConfig>): void {
        this.config = { ...this.config, ...config };
    }

    stripText(text: string, lang: string, opts?: StripOptions): StripTextResult {
        return this.engine.stripText(text, lang, { ...opts, keepSingleBlank: this.config.keepSingleBlank ?? opts?.keepSingleBlank });
    }

    stripFile(file: string, opts?: StripOptions): StripFileResult {
        const result = this.engine.stripFile(file, opts);
        if (this.config.verbose && result.changed) {
            this.context.logger.info(`stripped ${result.comments} comments from ${file} (${result.lang})`);
        }
        return result;
    }

    stripPaths(paths: string[], opts?: StripOptions): StripBatchResult {
        const result = this.engine.stripPaths(paths, opts);
        if (this.config.verbose) {
            this.context.logger.info(`files: ${result.files.length}, comments removed: ${result.totalComments}`);
        }
        return result;
    }

    stripGitDirty(cwd?: string): StripBatchResult {
        const files = this.engine.gitChangedFiles(cwd);
        if (files.length === 0) {
            this.context.logger.info('no changed files since HEAD');
            return { files: [], errors: [], totalComments: 0 };
        }
        return this.stripPaths(files);
    }

    watch(dir: string, onStripped?: (file: string, comments: number) => void): fs.FSWatcher {
        const target = path.resolve(dir);
        const timers = new Map<string, NodeJS.Timeout>();
        const handle: fs.WatchListener<string | Buffer> = (eventType: string, changedFile) => {
            if (typeof changedFile !== 'string' || !changedFile) return;
            const full = path.resolve(target, changedFile);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(full);
            } catch {
                return;
            }
            if (!stat.isFile()) return;
            if (full.includes('/node_modules/') || full.includes('/dist/') || full.includes('/.git/')) return;
            const existing = timers.get(full);
            if (existing) clearTimeout(existing);
            timers.set(full, setTimeout(() => {
                timers.delete(full);
                try {
                    const r = this.engine.stripFile(full);
                    if (r.changed) {
                        this.context.logger.info(`[watch] stripped ${r.comments} comments from ${path.relative(target, full)} (${r.lang})`);
                        onStripped?.(full, r.comments);
                    }
                } catch (e) {
                    this.context.logger.error(`[watch] failed ${full}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }, 400));
        };
        const watcher = fs.watch(target, { recursive: true }, handle);
        this.context.logger.info(`watching ${target} — stripping comments on every save (Ctrl+C to stop)`);
        return watcher;
    }
}
