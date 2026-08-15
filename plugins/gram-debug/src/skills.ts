import { PluginContext } from '@ton-ai/core';
import { DebugComponents, DebugLogger } from './components';
import { defaultConfig } from './default-config';
import { GramDebugConfig, LogLevel, ScopeConfig } from './types';

export class GramDebugSkills {
    private context: PluginContext;
    private components: DebugComponents;
    private config: GramDebugConfig;

    constructor(context: PluginContext, components: DebugComponents, config: GramDebugConfig = {}) {
        this.context = context;
        this.components = components;
        this.config = { ...defaultConfig, ...config };
    }

    isReady(): boolean {
        return true;
    }

    updateConfig(config: Partial<GramDebugConfig>): void {
        this.config = { ...this.config, ...config };
        this.components.configure(config);
    }

    getLogger(scope: string): DebugLogger {
        return this.components.getLogger(scope);
    }

    getConfig(): GramDebugConfig {
        return this.components.getConfig();
    }

    reloadConfig(file?: string): GramDebugConfig {
        this.config = this.components.loadConfig(file);
        return this.config;
    }

    isEnabled(scope: string, level?: LogLevel): boolean {
        if (level) return this.components.isAllowed(scope, level);
        return this.components.isScopeEnabled(scope);
    }

    enable(scope: string): void {
        this.components.setScope(scope, { enabled: true });
    }

    disable(scope: string): void {
        this.components.setScope(scope, { enabled: false });
    }

    setLevel(scope: string, level: LogLevel): void {
        this.components.setScope(scope, { level });
    }

    setScope(scope: string, patch: ScopeConfig): void {
        this.components.setScope(scope, patch);
    }

    dumpConfig(): string {
        return JSON.stringify(this.components.getConfig(), null, 2);
    }

    log(scope: string, level: LogLevel, ...args: unknown[]): void {
        const logger = this.components.getLogger(scope);
        switch (level) {
            case 'trace':
                logger.trace(...args);
                break;
            case 'debug':
                logger.debug(...args);
                break;
            case 'info':
                logger.info(...args);
                break;
            case 'warn':
                logger.warn(...args);
                break;
            case 'error':
                logger.error(...args);
                break;
        }
    }
}
