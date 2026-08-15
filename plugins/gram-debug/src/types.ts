export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'off';

export const LOG_LEVELS: Record<LogLevel, number> = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
    off: 5
};

export interface ScopeConfig {
    enabled?: boolean;
    level?: LogLevel;
    file?: string;
}

export interface GramDebugConfig {
    enabled?: boolean;
    level?: LogLevel;
    scopes?: Record<string, ScopeConfig>;
}
