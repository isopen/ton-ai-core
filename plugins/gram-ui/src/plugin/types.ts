import type { VNode } from '@ton-ai/atom/vdom';
import type { AppState } from '../types';
import type { Dispatch } from '../state';

export type { Plugin, PluginContext, EventBus } from '@ton-ai/core';

export interface SkillDef {
  id: string;
  label: string;
  icon?: () => VNode;
  render: (props: { state: AppState; dispatch: Dispatch }) => VNode;
}
