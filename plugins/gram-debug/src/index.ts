import { BasePlugin } from '@ton-ai/core';
import { DebugComponents, DebugLogger, loadConfig } from './components';
import { GramDebugSkills } from './skills';
import { GramDebugConfig, LogLevel, ScopeConfig } from './types';

export * from './components';
export * from './skills';
export * from './types';

const components = new DebugComponents();

export function getLogger(scope: string): DebugLogger {
    return components.getLogger(scope);
}

export function configure(patch: Partial<GramDebugConfig>): void {
    components.configure(patch);
}

export function setScope(scope: string, patch: ScopeConfig): void {
    components.setScope(scope, patch);
}

export function subscribeScope(scope: string, cb: () => void): () => void {
    return components.subscribeScope(scope, cb);
}

export function getConfig(): GramDebugConfig {
    return components.getConfig();
}

export function loadConfigFile(file?: string): GramDebugConfig {
    return loadConfig(file);
}

export function isEnabled(scope: string, level?: LogLevel): boolean {
    if (level) return components.isAllowed(scope, level);
    return components.isScopeEnabled(scope);
}

export class GramDebugPlugin extends BasePlugin<GramDebugConfig> {
    readonly metadata = {
        name: 'gram-debug',
        version: '0.1.0',
        description: 'Centralized debug logging with per-scope flags and levels from a global config file',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: DebugComponents;
    private skills!: GramDebugSkills;

    protected async onInit(): Promise<void> {
        this.components = new DebugComponents({ ...loadConfig(), ...this.config });
        this.skills = new GramDebugSkills(this.context, this.components, this.config);
        this.logger.info('gram-debug plugin initialized (flags live in gram-debug.json)');
    }

    async onActivate(): Promise<void> {
        this.events.emit('gram-debug:ready');
    }

    async onDeactivate(): Promise<void> {
        this.events.emit('gram-debug:deactivated');
    }

    async onConfigChange(newConfig: Record<string, any>): Promise<void> {
        this.config = { ...this.config, ...newConfig };
        this.skills?.updateConfig(newConfig);
        this.components = new DebugComponents({ ...loadConfig(), ...this.config });
    }

    isReady(): boolean {
        return this.skills?.isReady() || false;
    }

    getLogger(scope: string): DebugLogger {
        return this.skills.getLogger(scope);
    }

    getConfig(): GramDebugConfig {
        return this.skills.getConfig();
    }

    reloadConfig(file?: string): GramDebugConfig {
        return this.skills.reloadConfig(file);
    }

    enable(scope: string): void {
        this.skills.enable(scope);
    }

    disable(scope: string): void {
        this.skills.disable(scope);
    }

    setLevel(scope: string, level: LogLevel): void {
        this.skills.setLevel(scope, level);
    }

    setScope(scope: string, patch: ScopeConfig): void {
        this.skills.setScope(scope, patch);
    }

    dumpConfig(): string {
        return this.skills.dumpConfig();
    }

    log(scope: string, level: LogLevel, ...args: unknown[]): void {
        this.skills.log(scope, level, ...args);
    }
}
