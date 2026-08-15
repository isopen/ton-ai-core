import * as path from 'path';
import { defaultConfig } from './default-config';
import { GramDebugConfig, LogLevel, LOG_LEVELS, ScopeConfig } from './types';

function hasNodeFs(): boolean {
    return typeof process !== 'undefined' && !!process.versions?.node;
}

function tryReadJson(file: string): GramDebugConfig | null {
    try {
        const fs = require('fs');
        if (fs.existsSync(file)) {
            const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (raw && typeof raw === 'object') {
                return raw as GramDebugConfig;
            }
        }
    } catch {
        // fall through — file missing or unreadable
    }
    return null;
}

export function resolveConfigFile(): string | null {
    try {
        const candidates = [
            path.join(__dirname, 'gram-debug.json'),
            path.resolve(__dirname, '../gram-debug.json')
        ];
        for (const candidate of candidates) {
            if (tryReadJson(candidate)) {
                return candidate;
            }
        }
    } catch {
        // fs/path unavailable (browser bundle, worker) — fall back to embedded defaults
    }
    return null;
}

export function loadConfig(file?: string): GramDebugConfig {
    const fromFile = file
        ? tryReadJson(file)
        : tryReadJson(resolveConfigFile() || '');
    return fromFile || { ...defaultConfig };
}

export class DebugLogger {
    readonly scope: string;
    private components: DebugComponents;

    constructor(scope: string, components: DebugComponents) {
        this.scope = scope;
        this.components = components;
    }

    get enabled(): boolean {
        return this.components.isScopeEnabled(this.scope);
    }

    get level(): LogLevel {
        return this.components.resolveLevel(this.scope);
    }

    trace(...args: unknown[]): void {
        this.write('trace', args);
    }

    debug(...args: unknown[]): void {
        this.write('debug', args);
    }

    info(...args: unknown[]): void {
        this.write('info', args);
    }

    warn(...args: unknown[]): void {
        this.write('warn', args);
    }

    error(...args: unknown[]): void {
        this.write('error', args);
    }

    private write(level: LogLevel, args: unknown[]): void {
        this.components.write(this.scope, level, args);
    }
}

export class DebugComponents {
    private config: GramDebugConfig;
    private loggers: Map<string, DebugLogger> = new Map();

    constructor(config?: GramDebugConfig) {
        this.config = config || loadConfig();
    }

    configure(patch: Partial<GramDebugConfig>): void {
        this.config = {
            ...this.config,
            ...patch,
            scopes: { ...(this.config.scopes || {}), ...(patch.scopes || {}) }
        };
    }

    setScope(scope: string, patch: ScopeConfig): void {
        const scopes = { ...(this.config.scopes || {}) };
        scopes[scope] = { ...(scopes[scope] || {}), ...patch };
        this.config = { ...this.config, scopes };
    }

    getConfig(): GramDebugConfig {
        return this.config;
    }

    loadConfig(file?: string): GramDebugConfig {
        this.config = loadConfig(file);
        return this.config;
    }

    resolveLevel(scope: string): LogLevel {
        const scopeLevel = this.config.scopes?.[scope]?.level;
        if (scopeLevel) return scopeLevel;
        return this.config.level || 'info';
    }

    isScopeEnabled(scope: string): boolean {
        const scopeEnabled = this.config.scopes?.[scope]?.enabled;
        if (typeof scopeEnabled === 'boolean') return scopeEnabled;
        return this.config.enabled !== false;
    }

    isAllowed(scope: string, level: LogLevel): boolean {
        if (level === 'off') return false;
        if (!this.isScopeEnabled(scope)) return false;
        const scopeLevel = this.resolveLevel(scope);
        if (scopeLevel === 'off') return false;
        return LOG_LEVELS[level] >= LOG_LEVELS[scopeLevel];
    }

    getLogger(scope: string): DebugLogger {
        let logger = this.loggers.get(scope);
        if (!logger) {
            logger = new DebugLogger(scope, this);
            this.loggers.set(scope, logger);
        }
        return logger;
    }

    write(scope: string, level: LogLevel, args: unknown[]): void {
        if (!this.isAllowed(scope, level)) return;
        const scopeConfig = this.config.scopes?.[scope];
        if (scopeConfig?.file) {
            this.writeFile(scope, level, args, scopeConfig.file);
            return;
        }
        this.writeConsole(scope, level, args);
    }

    private writeConsole(scope: string, level: LogLevel, args: unknown[]): void {
        const prefix = `[${scope}] ${level.toUpperCase()}`;
        switch (level) {
            case 'error':
                console.error(prefix, ...args);
                break;
            case 'warn':
                console.warn(prefix, ...args);
                break;
            case 'trace':
                console.trace(prefix, ...args);
                break;
            default:
                console.log(prefix, ...args);
                break;
        }
    }

    private writeFile(scope: string, level: LogLevel, args: unknown[], file: string): void {
        if (!hasNodeFs()) {
            this.writeConsole(scope, level, args);
            return;
        }
        try {
            const fs = require('fs');
            const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
            fs.appendFileSync(file, `[${new Date().toISOString()}] [${scope}] ${level.toUpperCase()} ${line}\n`);
        } catch {
            this.writeConsole(scope, level, args);
        }
    }
}
