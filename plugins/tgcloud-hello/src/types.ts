import type { BasePluginConfig } from '@ton-ai/core';

export interface TgcloudHelloConfig extends BasePluginConfig {
    defaultIndex?: number;
}

export interface LabelSlide {
    text: string;
    index: number;
    total: number;
}
