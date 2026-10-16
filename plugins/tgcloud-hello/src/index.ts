import { BasePlugin, EventBus, PluginContext } from '@ton-ai/core';
import { TgcloudHelloSkills } from './skills.js';
import { LabelSlide, TgcloudHelloConfig } from './types.js';

export * from './labels.js';
export * from './skills.js';
export * from './types.js';

const SILENT_EVENTS: EventBus = {
    on: () => SILENT_EVENTS,
    once: () => SILENT_EVENTS,
    off: () => SILENT_EVENTS,
    emit: () => false,
    removeAllListeners: () => SILENT_EVENTS,
};

const CANNED_LOGGER: PluginContext['logger'] = console;

export class TgcloudHelloPlugin extends BasePlugin<TgcloudHelloConfig> {
    readonly metadata = {
        name: 'tgcloud-hello',
        version: '0.1.0',
        description: 'Demo labels for the tgcloud Mini App agent',
        author: 'TON AI Core Team',
        dependencies: [] as string[],
    };

    private skills!: TgcloudHelloSkills;
    private static armedInstance?: TgcloudHelloPlugin;

    static async armed(context: Partial<PluginContext> = {}): Promise<TgcloudHelloPlugin> {
        if (!TgcloudHelloPlugin.armedInstance) {
            const instance = new TgcloudHelloPlugin();
            await instance.initialize({
                events: context.events ?? SILENT_EVENTS,
                logger: context.logger ?? CANNED_LOGGER,
                config: context.config ?? {},
            });
            await instance.onActivate?.();
            TgcloudHelloPlugin.armedInstance = instance;
        }
        return TgcloudHelloPlugin.armedInstance;
    }

    protected async onInit(): Promise<void> {
        this.skills = new TgcloudHelloSkills(this.context, this.config);
    }

    async onActivate(): Promise<void> {
        this.events.emit('tgcloud-hello:ready');
    }

    getLabels(): string[] {
        this.checkInitialized();
        return this.skills.getLabels();
    }

    nextLabel(current: string): string {
        this.checkInitialized();
        return this.skills.nextLabel(current);
    }

    labelAt(index: number): string {
        this.checkInitialized();
        return this.skills.labelAt(index);
    }

    currentSlide(current: string): LabelSlide {
        this.checkInitialized();
        return this.skills.currentSlide(current);
    }
}
