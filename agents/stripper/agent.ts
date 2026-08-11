import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import { CommentStripperPlugin, CommentStripperConfig, StripBatchResult } from '@ton-ai/comment-stripper';
import * as fs from 'fs';

export interface StripperAgentConfig extends SimpleAgentConfig {
    commentStripper?: CommentStripperConfig;
    rootDir?: string;
    verbose?: boolean;
}

const PLUGIN_NAME = 'comment-stripper';

export class StripperAgent extends BaseAgentSimple {
    private verbose: boolean;

    constructor(config: StripperAgentConfig = {}) {
        super({ name: config.name || 'stripper', ...config, mcp: undefined });
        this.verbose = config.verbose ?? false;
    }

    protected async onInitialize(): Promise<void> {
        this.plugins.on('plugin:activated', ({ name }: { name: string }) => {
            if (name === PLUGIN_NAME && this.verbose) {
                this.logger.info('comment-stripper plugin activated (skills ready)');
            }
        });
        const plugin = new CommentStripperPlugin();
        await this.registerPlugin(plugin, { verbose: this.verbose });
    }

    protected async onStart(): Promise<void> {}

    protected async onStop(): Promise<void> {}

    private plugin(): CommentStripperPlugin {
        const plugin = this.getPlugin<CommentStripperPlugin>(PLUGIN_NAME);
        if (!plugin) throw new Error('comment-stripper plugin not available');
        return plugin;
    }

    async strip(targets: string[]): Promise<StripBatchResult> {
        const result = this.plugin().stripPaths(targets);
        this.report(result);
        return result;
    }

    async stripGitDirty(cwd?: string): Promise<StripBatchResult> {
        const result = this.plugin().stripGitDirty(cwd);
        this.report(result);
        return result;
    }

    watch(dir: string, onStripped?: (file: string, comments: number) => void): fs.FSWatcher {
        return this.plugin().watch(dir, onStripped);
    }

    private report(result: StripBatchResult): void {
        const changed = result.files.filter((f) => f.changed);
        this.logger.info(`files: ${result.files.length}, changed: ${changed.length}, comments removed: ${result.totalComments}`);
        for (const f of changed) {
            this.logger.info(`  ${f.file} (${f.lang}): -${f.comments} comments`);
        }
        for (const e of result.errors) this.logger.error('  error: ' + e);
    }
}
