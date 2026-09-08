import { BasePlugin } from '@ton-ai/core';
import { GramLangComponents } from './components';
import { GramLangSkills } from './skills';
import {
    GramLangConfig,
    RpcProvider,
    LangStorage,
    LangOption
} from './types';

export * from './components';
export * from './skills';
export * from './types';
export * from './keys';
export * from './locale';
export * from './local/en';

export class GramLangPlugin extends BasePlugin<GramLangConfig> {
    readonly metadata = {
        name: 'gram-lang',
        version: '0.1.0',
        description: 'Telegram language packs for TON AI Core',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: GramLangComponents;
    private skills!: GramLangSkills;

    protected async onInit() {
        this.logger.info('Initializing GramLang plugin...');
        this.components = new GramLangComponents(this.context, this.config);
        this.skills = new GramLangSkills(this.context, this.components, this.config);
        this.logger.info('GramLang plugin initialized');
    }

    async onActivate() {
        this.logger.info('GramLang plugin activated');
        this.skills.markReady();
        this.events.emit('gram-lang:ready');
    }

    async onDeactivate() {
        this.logger.info('GramLang plugin deactivated');
        this.components.cleanup();
        this.events.emit('gram-lang:deactivated');
    }

    async shutdown() {
        this.logger.info('GramLang plugin shutting down...');
        this.components.cleanup();
        this.initialized = false;
    }

    async onConfigChange(newConfig: Record<string, any>) {
        this.config = { ...this.config, ...newConfig };
        this.logger.info('GramLang config updated');
        this.skills.updateConfig(this.config);
        this.events.emit('gram-lang:config:updated');
    }

    bindStorage(storage: LangStorage): void {
        this.checkInitialized();
        this.skills.bindStorage(storage);
    }

    async getStrings(getRpc: () => RpcProvider | null, langCode: string, tlgKeys: string[]): Promise<Record<string, string> | null> {
        this.checkInitialized();
        return this.skills.getStrings(getRpc, langCode, tlgKeys);
    }

    async getLanguages(getRpc: () => RpcProvider | null): Promise<LangOption[]> {
        this.checkInitialized();
        return this.skills.getLanguages(getRpc);
    }

    async clearCache(storage?: LangStorage): Promise<void> {
        this.checkInitialized();
        return this.skills.clearCache(storage);
    }

    getMetrics() {
        this.checkInitialized();
        return this.skills.getMetrics();
    }

    resetMetrics(): void {
        this.checkInitialized();
        this.skills.resetMetrics();
    }

    isReady(): boolean {
        return this.skills?.isReady() || false;
    }
}

export function createStandaloneGramLang(storage?: LangStorage, config?: GramLangConfig): GramLangSkills {
    const components = new GramLangComponents(undefined, config);
    const skills = new GramLangSkills(undefined, components, config);
    if (storage) skills.bindStorage(storage);
    skills.markReady();
    return skills;
}
