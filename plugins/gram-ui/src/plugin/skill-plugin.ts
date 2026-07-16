import { BasePlugin, type BasePluginConfig, type PluginContext, type PluginMetadata } from '@ton-ai/core';
import type { VNode } from '../framework/vdom';
import type { AppState } from '../types';
import type { Dispatch } from '../state';

export interface SkillPluginConfig extends BasePluginConfig {
  id: string;
  label: string;
  icon?: () => VNode;
  render: (props: { state: AppState; dispatch: Dispatch }) => VNode;
}

export class SkillPlugin extends BasePlugin<SkillPluginConfig> {
  readonly metadata: PluginMetadata;

  constructor(config: SkillPluginConfig) {
    super();
    this.config = config as any;
    this.metadata = {
      name: config.id,
      version: '1.0.0',
      description: config.label,
    };
  }

  get id(): string { return this.config.id; }
  get label(): string { return this.config.label; }
  get icon(): (() => VNode) | undefined { return this.config.icon; }

  render(props: { state: AppState; dispatch: Dispatch }): VNode {
    return this.config.render(props);
  }

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    await this.onInit();
    this.initialized = true;
  }

  protected async onInit(): Promise<void> {
    // UI skills don't need initialization
  }
}
