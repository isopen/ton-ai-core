import type { PluginContext } from '@ton-ai/core';
import { getLabels as coreGetLabels, labelAt as coreLabelAt, nextLabel as coreNextLabel } from './labels.js';
import { LabelSlide, TgcloudHelloConfig } from './types.js';

export class TgcloudHelloSkills {
    private context: PluginContext;
    private config: TgcloudHelloConfig;

    constructor(context: PluginContext, config: TgcloudHelloConfig = {}) {
        this.context = context;
        this.config = config;
    }

    updateConfig(config: TgcloudHelloConfig): void {
        this.config = { ...this.config, ...config };
    }

    getLabels(): string[] {
        return coreGetLabels();
    }

    nextLabel(current: string): string {
        return coreNextLabel(current);
    }

    labelAt(index: number): string {
        return coreLabelAt(index);
    }

    currentSlide(current: string): LabelSlide {
        const labels = coreGetLabels();
        const at = labels.indexOf(current);
        const index = at === -1 ? (this.config.defaultIndex ?? 0) : at;
        const safe = ((index % labels.length) + labels.length) % labels.length;
        return { text: labels[safe], index: safe, total: labels.length };
    }
}
