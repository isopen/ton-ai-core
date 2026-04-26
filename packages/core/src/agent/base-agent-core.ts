import { EventEmitter } from 'events';
import { PluginManager } from '../plugin';
import { Plugin } from '../plugin/plugin-interface';
import { AGENT_EVENTS, PLUGIN_EVENTS } from '../events';
import { Logger } from '../client/mcp-client';

const DEFAULT_LOGGER: Logger = {
    info: (m, ...a) => console.log(`[INFO] ${m}`, ...a),
    error: (m, ...a) => console.error(`[ERROR] ${m}`, ...a),
    warn: (m, ...a) => console.warn(`[WARN] ${m}`, ...a),
    debug: (m, ...a) => console.log(`[DEBUG] ${m}`, ...a),
};

export abstract class BaseAgentCore extends EventEmitter {
    public readonly id: string;
    public readonly name: string;
    protected config: any;
    protected plugins: PluginManager;
    protected isRunning: boolean = false;
    protected startTime?: Date;
    protected initialized: boolean = false;
    protected logger: Logger;

    constructor(config: any = {}) {
        super();
        this.logger = config.logger || DEFAULT_LOGGER;
        this.id = config.id || `agent-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        this.name = config.name || this.id;
        this.config = config;
        this.plugins = new PluginManager(config.mcp, config.plugins);
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.onInitialize();
            this.startTime = new Date();
            this.initialized = true;
            this.emit(AGENT_EVENTS.INITIALIZED, {
                id: this.id,
                name: this.name,
                startTime: this.startTime,
            });
        } catch (error) {
            this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    async start(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.isRunning) {
            this.isRunning = true;
            await this.onStart();
            this.emit(AGENT_EVENTS.STARTED, { id: this.id, name: this.name });
        }
    }

    async stop(): Promise<void> {
        this.isRunning = false;
        this.initialized = false;
        await this.plugins.deactivateAll();
        await this.onStop();
        this.emit(AGENT_EVENTS.STOPPED, { id: this.id, name: this.name });
        this.removeAllListeners();
    }

    async registerPlugin(plugin: Plugin, config?: Record<string, any>): Promise<void> {
        await this.plugins.registerPlugin(plugin);
        this.emit(PLUGIN_EVENTS.REGISTERED, { name: plugin.metadata.name });

        if (config) {
            await this.plugins.activatePlugin(plugin.metadata.name, config);
            this.emit(PLUGIN_EVENTS.ACTIVATED, { name: plugin.metadata.name });
        }
    }

    async unregisterPlugin(pluginName: string): Promise<void> {
        if (this.plugins.isActive(pluginName)) {
            await this.plugins.deactivatePlugin(pluginName);
            this.emit(PLUGIN_EVENTS.DEACTIVATED, { name: pluginName });
        }
        await this.plugins.unregisterPlugin(pluginName);
        this.emit(PLUGIN_EVENTS.UNREGISTERED, { name: pluginName });
    }

    async activatePlugin(pluginName: string, config?: Record<string, any>): Promise<void> {
        await this.plugins.activatePlugin(pluginName, config);
        this.emit(PLUGIN_EVENTS.ACTIVATED, { name: pluginName });
    }

    async deactivatePlugin(pluginName: string): Promise<void> {
        await this.plugins.deactivatePlugin(pluginName);
        this.emit(PLUGIN_EVENTS.DEACTIVATED, { name: pluginName });
    }

    getPlugin<T extends Plugin>(name: string): T | undefined {
        return this.plugins.getPlugin(name) as T;
    }

    isPluginActive(name: string): boolean {
        return this.plugins.isActive(name);
    }

    listPlugins() {
        return this.plugins.listPlugins();
    }

    listActivePlugins() {
        return this.plugins.listActivePlugins();
    }

    getStatus() {
        return {
            id: this.id,
            name: this.name,
            isRunning: this.isRunning,
            initialized: this.initialized,
            startTime: this.startTime,
            uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
            activePlugins: this.listActivePlugins()
        };
    }

    protected abstract onInitialize(): Promise<void>;
    protected abstract onStart(): Promise<void>;
    protected abstract onStop(): Promise<void>;
}
